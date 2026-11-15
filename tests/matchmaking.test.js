import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../server/app.js';
import { basePlan } from '../server/curricula.js';

const initialTime = '2026-11-15T12:00:00.000Z';
const slots = [{ day: 2, start: '19:00' }, { day: 4, start: '19:00' }];
const availability = slots.map(({ day }) => ({ day, start: '19:00', end: '20:00' }));
const profile = (name, extra = {}) => ({ name, trackId: 'python', level: 'beginner', timezone: 'UTC', availability, ...extra });
const windows = days => days.map(day => ({ day, start: '19:00', end: '20:00' }));

async function fixture(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'learning-squads-matchmaking-'));
  const dbPath = join(directory, 'test.sqlite');
  if (options.seed) await options.seed(dbPath);
  let time = new Date(options.time ?? initialTime);
  let app;
  let base;
  async function startServer() {
    app = createApp({ dbPath, now: () => new Date(time), aiAdapter: null });
    app.server.listen(0, '127.0.0.1');
    await once(app.server, 'listening');
    base = `http://127.0.0.1:${app.server.address().port}`;
  }
  async function stopServer() {
    if (!app) return;
    if (app.server.listening) {
      app.server.closeAllConnections();
      await new Promise((resolve, reject) => app.server.close(error => error ? reject(error) : resolve()));
    }
    await app.close();
    app = undefined;
  }
  await startServer();
  t.after(async () => { await stopServer(); await rm(directory, { recursive: true, force: true }); });
  function client(initialCookie = '') {
    let cookie = initialCookie;
    return {
      async request(path, method = 'GET', data) {
        const response = await fetch(base + path, {
          method,
          headers: { origin: base, ...(cookie ? { cookie } : {}), ...(data === undefined ? {} : { 'content-type': 'application/json' }) },
          ...(data === undefined ? {} : { body: JSON.stringify(data) }),
        });
        const setCookie = response.headers.getSetCookie();
        if (setCookie.length) cookie = setCookie[0].split(';')[0];
        const text = await response.text();
        let body;
        try { body = JSON.parse(text); } catch { assert.fail(`Non-JSON response ${response.status}: ${text.slice(0, 300)}`); }
        return { status: response.status, body };
      },
      async ok(path, method = 'GET', data) {
        const response = await this.request(path, method, data);
        assert.ok(response.status >= 200 && response.status < 300, `${method} ${path}: ${response.status} ${JSON.stringify(response.body)}`);
        return response.body;
      },
    };
  }
  async function guest(name, extra) {
    const person = client();
    await person.ok('/api/session', 'POST', {});
    await person.ok('/api/profile', 'PUT', profile(name, extra));
    return person;
  }
  return {
    client, guest,
    advance: ms => { time = new Date(time.getTime() + ms); },
    restart: async () => { await stopServer(); await startServer(); },
  };
}

const start = person => person.ok('/api/matchmaking', 'POST', {});
const poll = person => person.ok('/api/matchmaking/poll', 'POST', {});
const state = person => person.ok('/api/matchmaking');
const cancel = person => person.ok('/api/matchmaking', 'DELETE', {});
const dashboard = (person, id) => person.ok(`/api/squads/${id}`);
async function manualSquad(person, name = 'Custom names must be ignored') {
  return (await person.ok('/api/squads', 'POST', { slots, name })).squadId;
}
function assertMatched(result, expectedId) {
  assert.equal(result.status, 'matched', JSON.stringify(result));
  assert.ok(result.squadId);
  if (expectedId) assert.equal(result.squadId, expectedId);
  assert.equal(result.squad.id, result.squadId);
  assert.equal(result.squad.meetings.length, 8);
  assert.ok(result.squad.memberCount >= 3 && result.squad.memberCount <= 4);
  return result.squadId;
}

test('two people wait and a third search automatically assigns the same real ready squad to all', async t => {
  const f = await fixture(t);
  const [a, b, c] = await Promise.all(['Alice', 'Bob', 'Casey'].map(name => f.guest(name)));
  assert.equal((await state(a)).status, 'idle');
  assert.equal((await start(a)).status, 'waiting');
  assert.equal((await start(b)).status, 'waiting');
  assert.equal((await a.ok('/api/bootstrap')).currentSquadId, null);
  assert.equal((await a.ok('/api/bootstrap')).matchmaking.status, 'waiting');
  const third = await start(c);
  const id = assertMatched(third);
  assert.equal(third.squad.name, 'Python Foundations #001');
  assert.equal(third.squad.status, 'ready');
  assert.deepEqual(third.squad.members.map(member => member.name).sort(), ['Alice', 'Bob', 'Casey']);
  for (const person of [a, b, c]) {
    assertMatched(await state(person), id);
    assert.equal((await person.ok('/api/bootstrap')).currentSquadId, id);
    assert.equal((await dashboard(person, id)).canEdit, true);
  }
  for (const meeting of third.squad.meetings) {
    assert.equal(new Date(meeting.windowEndsAt) - new Date(meeting.startsAt), 60 * 60_000);
    assert.equal(new Date(meeting.endsAt) - new Date(meeting.startsAt), 50 * 60_000);
    assert.equal(new Date(meeting.startsAt).getUTCHours(), 19);
  }
  assert.equal((await cancel(a)).status, 'matched', 'Cancel must not silently leave an assigned squad');
});

test('a fourth fills an automatic squad and the fifth remains searching without overfilling', async t => {
  const f = await fixture(t);
  const people = await Promise.all(['One', 'Two', 'Three', 'Four', 'Five'].map(name => f.guest(name)));
  await start(people[0]);
  await start(people[1]);
  const id = assertMatched(await start(people[2]));
  assertMatched(await start(people[3]), id);
  assert.equal((await start(people[4])).status, 'waiting');
  assert.equal((await poll(people[4])).status, 'waiting');
  const detail = await dashboard(people[0], id);
  assert.equal(detail.squad.memberCount, 4);
  assert.equal(new Set(detail.members.map(member => member.id)).size, 4);
  assert.equal((await people[4].ok('/api/bootstrap')).currentSquadId, null);
});

test('a fourth learner must have meetings on different local days, just like the initial group', async t => {
  const f = await fixture(t);
  const nearMidnight = [{ day: 1, start: '23:00', end: '24:00' }, { day: 2, start: '00:00', end: '01:00' }];
  const people = await Promise.all(['UTC A', 'UTC B', 'UTC C'].map(name => f.guest(name, { availability: nearMidnight })));
  await start(people[0]);
  await start(people[1]);
  const matched = await start(people[2]);
  const id = assertMatched(matched);
  const newYork = await f.guest('Both meetings on Monday', { timezone: 'America/New_York', availability: [
    { day: 1, start: '18:00', end: '20:00' }, { day: 4, start: '18:00', end: '19:00' },
  ] });
  assert.equal((await start(newYork)).status, 'waiting');
  assert.equal((await poll(newYork)).status, 'waiting');
  assert.equal((await dashboard(people[0], id)).squad.memberCount, 3);
});

test('concurrent repeated starts and polls cannot duplicate memberships or squads', async t => {
  const f = await fixture(t);
  const people = await Promise.all(Array.from({ length: 8 }, (_, i) => f.guest(`Concurrent ${i + 1}`)));
  await Promise.all(people.flatMap(person => [start(person), start(person), poll(person)]));
  const results = await Promise.all(people.map(state));
  const squadIds = new Set(results.map(result => assertMatched(result)));
  assert.equal(squadIds.size, 2);
  for (const id of squadIds) {
    const members = results.filter(result => result.squadId === id);
    assert.equal(members.length, 4);
    assert.equal(members[0].squad.memberCount, 4);
    assert.equal(new Set(members[0].squad.members.map(member => member.id)).size, 4);
  }
  for (const person of people) assert.equal((await person.ok('/api/bootstrap')).history.length, 0);
});

test('heartbeat renews a persisted search but reads do not, and expiration needs an explicit restart', async t => {
  const f = await fixture(t);
  const a = await f.guest('Waiting');
  assert.equal((await poll(a)).status, 'idle');
  const first = await start(a);
  assert.equal(new Date(first.expiresAt) - new Date(first.waitingSince), 120_000);
  f.advance(30_000);
  const repeated = await start(a);
  assert.equal(repeated.waitingSince, first.waitingSince);
  f.advance(60_000);
  const renewed = await poll(a);
  assert.equal(renewed.waitingSince, first.waitingSince);
  assert.equal(new Date(renewed.expiresAt).getTime(), new Date(initialTime).getTime() + 210_000);
  f.advance(110_000);
  assert.equal((await state(a)).status, 'waiting');
  await f.restart();
  const restored = await state(a);
  assert.equal(restored.waitingSince, first.waitingSince);
  assert.equal(restored.expiresAt, renewed.expiresAt);
  f.advance(11_000);
  assert.equal((await state(a)).status, 'expired');
  assert.equal((await poll(a)).status, 'expired');
  assert.equal((await a.ok('/api/bootstrap')).currentSquadId, null);
  const restarted = await start(a);
  assert.equal(restarted.status, 'waiting');
  assert.notEqual(restarted.waitingSince, first.waitingSince);
  assert.equal((await cancel(a)).status, 'idle');
  assert.equal((await cancel(a)).status, 'idle');
  assert.equal((await poll(a)).status, 'idle');
});

test('expired searchers are excluded when fresh compatible people form a team', async t => {
  const f = await fixture(t);
  const [expired, b, c, d] = await Promise.all(['Expired', 'B', 'C', 'D'].map(name => f.guest(name)));
  await start(expired);
  f.advance(60_000);
  await start(b);
  f.advance(61_000);
  assert.equal((await start(c)).status, 'waiting');
  const result = await start(d);
  assertMatched(result);
  assert.deepEqual(result.squad.members.map(member => member.name).sort(), ['B', 'C', 'D']);
  assert.equal((await state(expired)).status, 'expired');
});

test('saving preferences cancels the pending search and old preferences cannot be enrolled', async t => {
  const f = await fixture(t);
  const [a, b, c, d] = await Promise.all(['A', 'B', 'C', 'D'].map(name => f.guest(name)));
  await start(a);
  await start(b);
  const invalid = await a.request('/api/profile', 'PUT', profile(''));
  assert.equal(invalid.status, 400);
  assert.equal((await state(a)).status, 'waiting', 'A rejected save must not silently cancel a search');
  await a.ok('/api/profile', 'PUT', profile('A updated', { availability: windows([1, 3]) }));
  assert.equal((await state(a)).status, 'idle');
  assert.equal((await poll(a)).status, 'idle');
  assert.equal((await start(c)).status, 'waiting');
  const result = await start(d);
  assertMatched(result);
  assert.deepEqual(result.squad.members.map(member => member.name).sort(), ['B', 'C', 'D']);
  assert.equal((await a.ok('/api/bootstrap')).currentSquadId, null);
});

test('manual creation and joining remove pending searches, and manual squads are never auto-filled', async t => {
  const f = await fixture(t);
  const [owner, joiner, a, b, c] = await Promise.all(['Manual owner', 'Manual joiner', 'A', 'B', 'C'].map(name => f.guest(name)));
  await start(owner);
  const manualId = await manualSquad(owner);
  assert.equal((await state(owner)).status, 'matched');
  await start(joiner);
  assert.equal((await state(joiner)).status, 'waiting', 'Queue must not auto-join a manual squad');
  await joiner.ok(`/api/squads/${manualId}/join`, 'POST', {});
  assert.equal((await state(joiner)).squadId, manualId);
  assert.equal((await start(a)).status, 'waiting');
  assert.equal((await start(b)).status, 'waiting');
  const automatic = await start(c);
  assertMatched(automatic);
  assert.notEqual(automatic.squadId, manualId);
  assert.equal((await dashboard(owner, manualId)).squad.memberCount, 2);
  assert.equal(automatic.squad.memberCount, 3);
  await joiner.ok(`/api/squads/${manualId}/leave`, 'POST', {});
  assert.equal((await state(joiner)).status, 'idle');
  assert.equal((await poll(joiner)).status, 'idle', 'Leaving must not restart a previous search');
});

test('cancellation racing the third search either cancels safely or returns the complete match', async t => {
  const f = await fixture(t);
  const [a, b, c] = await Promise.all(['A', 'B', 'C'].map(name => f.guest(name)));
  await start(a);
  await start(b);
  const [cancelled] = await Promise.all([cancel(a), start(c)]);
  const final = await state(a);
  if (final.status === 'matched') {
    const id = assertMatched(final);
    assert.equal(cancelled.status, 'matched');
    assertMatched(await state(b), id);
    assertMatched(await state(c), id);
  } else {
    assert.equal(cancelled.status, 'idle');
    assert.equal(final.status, 'idle');
    assert.equal((await poll(a)).status, 'idle');
    assert.equal((await state(b)).status, 'waiting');
    assert.equal((await state(c)).status, 'waiting');
  }
});

test('pairwise compatibility does not create a squad without two windows shared by the whole group', async t => {
  const f = await fixture(t);
  const a = await f.guest('A', { availability: windows([1, 2, 3, 4]) });
  const b = await f.guest('B', { availability: windows([1, 2, 5, 6]) });
  const c = await f.guest('C', { availability: windows([3, 4, 5, 6]) });
  for (const person of [a, b, c]) assert.equal((await start(person)).status, 'waiting');
  for (const person of [a, b, c]) {
    assert.equal((await poll(person)).status, 'waiting');
    assert.equal((await person.ok('/api/bootstrap')).currentSquadId, null);
  }
});

test('incompatible older searchers do not block an available compatible subset', async t => {
  const f = await fixture(t);
  const old = await f.guest('Earlier incompatible schedule', { availability: windows([1, 3]) });
  const differentTrack = await f.guest('JavaScript waiting', { trackId: 'javascript' });
  const differentLevel = await f.guest('Basics waiting', { level: 'basics' });
  for (const person of [old, differentTrack, differentLevel]) { await start(person); f.advance(1_000); }
  const people = await Promise.all(['Compatible A', 'Compatible B', 'Compatible C'].map(name => f.guest(name)));
  await start(people[0]);
  f.advance(1_000);
  await start(people[1]);
  f.advance(1_000);
  const result = await start(people[2]);
  assertMatched(result);
  assert.deepEqual(result.squad.members.map(member => member.name).sort(), ['Compatible A', 'Compatible B', 'Compatible C']);
  for (const person of [old, differentTrack, differentLevel]) assert.equal((await state(person)).status, 'waiting');
});

test('a real timezone/DST-compatible subset matches while first-week-only availability stays waiting', async t => {
  const f = await fixture(t, { time: '2027-02-27T12:00:00.000Z' });
  const limited = await f.guest('Only first week in UTC', { availability: [
    { day: 3, start: '00:00', end: '01:00' }, { day: 5, start: '00:00', end: '01:00' },
  ] });
  const ny = await f.guest('New York', { timezone: 'America/New_York' });
  const la = await f.guest('Los Angeles', { timezone: 'America/Los_Angeles', availability: [
    { day: 2, start: '16:00', end: '17:00' }, { day: 4, start: '16:00', end: '17:00' },
  ] });
  const utc = await f.guest('Both UTC offsets', { availability: [
    { day: 2, start: '23:00', end: '24:00' }, { day: 4, start: '23:00', end: '24:00' },
    { day: 3, start: '00:00', end: '01:00' }, { day: 5, start: '00:00', end: '01:00' },
  ] });
  for (const person of [limited, ny, la]) { assert.equal((await start(person)).status, 'waiting'); f.advance(1_000); }
  const matched = await start(utc);
  assertMatched(matched);
  assert.deepEqual(matched.squad.members.map(member => member.name).sort(), ['Both UTC offsets', 'Los Angeles', 'New York']);
  assert.equal((await state(limited)).status, 'waiting');
  assert.equal(new Date(matched.squad.meetings[0].startsAt).toISOString(), '2027-03-03T00:00:00.000Z');
  assert.equal(new Date(matched.squad.meetings[4].startsAt).toISOString(), '2027-03-16T23:00:00.000Z');
});

test('queue endpoints expose only own status and cannot cancel another person by supplying userId', async t => {
  const f = await fixture(t);
  const anonymous = f.client();
  assert.equal((await anonymous.request('/api/matchmaking')).status, 401);
  assert.equal((await anonymous.request('/api/matchmaking', 'POST', {})).status, 401);
  const [a, b, c, d] = await Promise.all(['Private waiting name', 'Outsider', 'C', 'D'].map(name => f.guest(name)));
  await start(a);
  const aid = (await a.ok('/api/bootstrap')).user.id;
  const bWaiting = await start(b);
  assert.equal(bWaiting.status, 'waiting');
  assert.ok(!JSON.stringify(bWaiting).includes('Private waiting name'));
  assert.ok(!JSON.stringify(bWaiting).includes(aid));
  await b.ok('/api/matchmaking', 'DELETE', { userId: aid });
  assert.equal((await state(a)).status, 'waiting');
  assert.equal((await b.ok(`/api/matchmaking?userId=${aid}`)).status, 'idle');
  await start(c);
  const matched = await start(d);
  const id = assertMatched(matched);
  assert.equal((await b.request(`/api/squads/${id}`)).status, 403);
  assert.equal((await state(b)).status, 'idle');
  assert.ok(matched.squad.meetings.every(meeting => !('meetUrl' in meeting)));
  assert.equal(matched.squad.teamProgress, undefined);
});

test('display numbers are stable, unique across courses, and ignore incoming custom names', async t => {
  const f = await fixture(t);
  const python = await f.guest('Python');
  const javascript = await f.guest('JavaScript', { trackId: 'javascript' });
  const pyId = await manualSquad(python, 'Please use this forbidden custom name');
  const jsId = await manualSquad(javascript, 'Another custom name');
  assert.equal((await dashboard(python, pyId)).squad.name, 'Python Foundations #001');
  assert.equal((await dashboard(javascript, jsId)).squad.name, 'JavaScript Foundations #002');
  await f.restart();
  assert.equal((await dashboard(python, pyId)).squad.name, 'Python Foundations #001');
  const ai = await f.guest('AI', { trackId: 'ai', level: 'basics' });
  const aiId = await manualSquad(ai);
  assert.equal((await dashboard(ai, aiId)).squad.name, 'AI Apps with Python #003');
});

test('legacy squads receive stable display numbers without losing UUID routes, sessions or saved work', async t => {
  const token = 'a'.repeat(64);
  const legacyId = 'legacy-squad-uuid';
  const legacySprint = 'legacy-sprint-uuid';
  const legacyUser = 'legacy-user-uuid';
  const legacyPlan = basePlan('python', 'beginner');
  const legacyTask = legacyPlan.weeks[0].tasks[0].id;
  const f = await fixture(t, { seed: dbPath => {
    const db = new DatabaseSync(dbPath);
    try {
      db.exec(`
        CREATE TABLE users (id TEXT PRIMARY KEY, profile TEXT NOT NULL, created_at TEXT NOT NULL);
        CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires_at TEXT NOT NULL);
        CREATE TABLE squads (id TEXT PRIMARY KEY, name TEXT NOT NULL, track_id TEXT NOT NULL, level TEXT NOT NULL, created_at TEXT NOT NULL);
        CREATE TABLE sprints (id TEXT PRIMARY KEY, squad_id TEXT UNIQUE NOT NULL REFERENCES squads(id), status TEXT NOT NULL, starts_at TEXT NOT NULL, ends_at TEXT NOT NULL, timezone TEXT NOT NULL, plan TEXT NOT NULL);
        CREATE TABLE memberships (squad_id TEXT NOT NULL REFERENCES squads(id), user_id TEXT NOT NULL REFERENCES users(id), active INTEGER NOT NULL DEFAULT 1, joined_at TEXT NOT NULL, left_at TEXT, PRIMARY KEY(squad_id,user_id));
        CREATE TABLE progress (sprint_id TEXT NOT NULL REFERENCES sprints(id), user_id TEXT NOT NULL REFERENCES users(id), task_id TEXT NOT NULL, status TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', url TEXT NOT NULL DEFAULT '', PRIMARY KEY(sprint_id,user_id,task_id));
      `);
      db.prepare('INSERT INTO users VALUES (?,?,?)').run(legacyUser, JSON.stringify(profile('Legacy learner')), '2026-09-01T12:00:00.000Z');
      db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(createHash('sha256').update(token).digest('hex'), legacyUser, '2027-09-01T12:00:00.000Z');
      db.prepare('INSERT INTO squads VALUES (?,?,?,?,?)').run(legacyId, 'My old custom squad', 'python', 'beginner', '2026-09-01T12:00:00.000Z');
      db.prepare('INSERT INTO sprints VALUES (?,?,?,?,?,?,?)').run(legacySprint, legacyId, 'completed', '2026-09-08T19:00:00.000Z', '2026-10-06T19:00:00.000Z', 'UTC', JSON.stringify(legacyPlan));
      db.prepare('INSERT INTO memberships VALUES (?,?,?,?,?)').run(legacyId, legacyUser, 1, '2026-09-01T12:00:00.000Z', null);
      db.prepare('INSERT INTO progress VALUES (?,?,?,?,?,?)').run(legacySprint, legacyUser, legacyTask, 'done', 'Preserve my pre-migration result', 'https://example.com/legacy');
    } finally { db.close(); }
  } });
  const learner = f.client(`ls_session=${token}`);
  const boot = await learner.ok('/api/bootstrap');
  assert.equal(boot.user.id, legacyUser);
  assert.equal(boot.history[0].id, legacyId);
  assert.equal(boot.history[0].name, 'Python Foundations #001');
  const old = await dashboard(learner, legacyId);
  assert.deepEqual(old.plan, legacyPlan);
  assert.equal(old.progress.find(item => item.taskId === legacyTask).note, 'Preserve my pre-migration result');
  const next = await manualSquad(learner);
  assert.equal((await dashboard(learner, next)).squad.name, 'Python Foundations #002');
  await f.restart();
  assert.equal((await dashboard(learner, legacyId)).squad.name, 'Python Foundations #001');
  assert.equal((await dashboard(learner, next)).squad.name, 'Python Foundations #002');
});
