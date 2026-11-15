import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { EventEmitter } from 'node:events';
import { randomBytes, createHash } from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';
import { createGoogleMeetService, MEET_SCOPE } from '../server/google-meet.js';

function fixture(t, hooks = {}) {
  const db = new DatabaseSync(':memory:');
  db.exec("PRAGMA foreign_keys=ON; CREATE TABLE users(id TEXT PRIMARY KEY); CREATE TABLE squads(id TEXT PRIMARY KEY); INSERT INTO users VALUES ('owner'),('other'); INSERT INTO squads VALUES ('squad');");
  t.after(() => db.close());
  const config = { clientId: 'test-client', clientSecret: 'test-client-secret', redirectUri: 'https://app.example/api/google-meet/callback', encryptionKey: randomBytes(32).toString('base64') };
  let now = new Date('2026-11-15T00:00:00Z');
  const calls = [];
  class FakeOAuth extends EventEmitter {
    generateAuthUrl(options) { return new OAuth2Client(config.clientId, config.clientSecret, config.redirectUri).generateAuthUrl(options); }
    async getToken(options) { calls.push({ token: options }); if (hooks.getToken) return hooks.getToken(options); return { tokens: { refresh_token: 'private-refresh-token', access_token: 'private-access-token', expiry_date: now.getTime() + 3600000, scope: MEET_SCOPE } }; }
    setCredentials(value) { this.credentials = value; }
    async request(options) { calls.push({ request: options }); if (hooks.request) return hooks.request(this, options); return { data: { meetingUri: 'https://meet.google.com/abc-defg-hij', name: 'spaces/example' } }; }
    async revokeToken(value) { calls.push({ revoked: value }); }
  }
  const service = createGoogleMeetService({ db, now: () => now, config, oauthClientFactory: () => new FakeOAuth() });
  const start = async () => new URL((await service.begin('owner', 'squad')).authorizationUrl);
  const finish = (startUrl, userId = 'owner', authorize = () => {}) => service.callback(new URL(`${config.redirectUri}?state=${startUrl.searchParams.get('state')}&code=authorized-code`), userId, authorize);
  return { db, config, service, start, finish, calls, advance: milliseconds => { now = new Date(now.getTime() + milliseconds); } };
}

test('Google OAuth requests only Meet-created scope with PKCE and stores encrypted credentials', async t => {
  const f = fixture(t), url = await f.start();
  assert.equal(url.origin, 'https://accounts.google.com');
  assert.equal(url.searchParams.get('scope'), MEET_SCOPE);
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('access_type'), 'offline');
  assert.equal((await f.finish(url)).connected, true);
  assert.equal(f.service.connected('owner'), true);
  assert.equal(createHash('sha256').update(f.calls[0].token.codeVerifier).digest('base64url'), url.searchParams.get('code_challenge'));
  const stored = f.db.prepare('SELECT credentials FROM google_meet_connections').get().credentials;
  assert.ok(!stored.includes('private-refresh-token'));
  assert.ok(!stored.includes('private-access-token'));
  const restored = createGoogleMeetService({ db: f.db, config: f.config });
  assert.equal(restored.connected('owner'), true);
  assert.equal((await f.service.createMeeting('owner')).url, 'https://meet.google.com/abc-defg-hij');
  assert.equal(f.calls.at(-1).request.url, 'https://meet.googleapis.com/v2/spaces');
  assert.equal(f.calls.at(-1).request.retry, false);
});

test('OAuth state is guest-bound, single-use, expires and does not expose credentials', async t => {
  const f = fixture(t), url = await f.start();
  assert.deepEqual(await f.finish(url, 'other'), { squadId: null, connected: false });
  assert.equal(f.calls.length, 0);
  assert.equal((await f.finish(url)).connected, true);
  assert.deepEqual(await f.finish(url), { squadId: null, connected: false });
  const expired = await f.start(); f.advance(600001);
  assert.equal((await f.finish(expired)).connected, false);
  assert.equal(f.calls.filter(call => call.token).length, 1);
});

test('OAuth callback rechecks membership after token exchange and refuses revoked scope', async t => {
  const f = fixture(t), url = await f.start();
  let authorizations = 0;
  assert.equal((await f.finish(url, 'owner', () => { if (++authorizations === 2) throw new Error('Left squad'); })).connected, false);
  assert.equal(f.service.connected('owner'), false);
  const missingScope = fixture(t, { getToken: async () => ({ tokens: { refresh_token: 'secret', scope: 'unrelated' } }) });
  assert.equal((await missingScope.finish(await missingScope.start())).connected, false);
});

test('disconnect removes credentials, revokes token, and invalidates pending OAuth callbacks', async t => {
  const f = fixture(t);
  await f.finish(await f.start());
  const pending = await f.start();
  await f.service.disconnect('owner');
  assert.equal(f.service.connected('owner'), false);
  assert.equal(f.calls.at(-1).revoked, 'private-refresh-token');
  assert.equal((await f.finish(pending)).connected, false);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM google_meet_connections').get().n, 0);
});

test('disconnect during callback token exchange cannot resurrect the connection', async t => {
  let release;
  const deferred = new Promise(resolve => { release = resolve; });
  const f = fixture(t, { getToken: async () => { await deferred; return { tokens: { refresh_token: 'secret', scope: MEET_SCOPE } }; } });
  const callback = f.finish(await f.start());
  await f.service.disconnect('owner');
  release();
  assert.equal((await callback).connected, false);
  assert.equal(f.service.connected('owner'), false);
});

test('refresh token events cannot resurrect a connection removed during creation', async t => {
  let f;
  f = fixture(t, { request: async auth => {
    await f.service.disconnect('owner');
    auth.emit('tokens', { access_token: 'refreshed-secret' });
    return { data: { meetingUri: 'https://meet.google.com/abc-defg-hij' } };
  } });
  await f.finish(await f.start());
  await f.service.createMeeting('owner');
  assert.equal(f.service.connected('owner'), false);
});

test('missing configuration and tampered encrypted credentials stay unavailable', async t => {
  const f = fixture(t);
  assert.equal(createGoogleMeetService({ db: f.db, config: null }).configured, false);
  assert.equal(createGoogleMeetService({ db: f.db, config: { ...f.config, redirectUri: 'http://public.example/api/google-meet/callback' } }).configured, false);
  await f.finish(await f.start());
  f.db.prepare("UPDATE google_meet_connections SET credentials='corrupted'").run();
  assert.equal(f.service.connected('owner'), false);
  await assert.rejects(f.service.createMeeting('owner'), /could not be connected/);
});
