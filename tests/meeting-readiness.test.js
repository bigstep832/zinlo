import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createApp } from '../server/app.js';

const initialTime = '2026-11-15T12:00:00.000Z';
const slots = [{ day: 2, start: '19:00' }, { day: 4, start: '19:00' }];
const meetUrl = 'https://meet.google.com/abc-defg-hij';
const validAdapter = async () => ({ url: meetUrl, spaceName: 'spaces/test-meeting' });

async function fixture(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'learning-squads-readiness-'));
  const dbPath = join(directory, 'test.sqlite');
  let time = new Date(initialTime);
  let app;
  let base;
  const adapter = Object.hasOwn(options, 'meetAdapter') ? options.meetAdapter : validAdapter;
  async function start() {
    app = createApp({ dbPath, now: () => new Date(time), aiAdapter: null, meetAdapter: adapter });
    app.server.listen(0, '127.0.0.1');
    await once(app.server, 'listening');
    base = `http://127.0.0.1:${app.server.address().port}`;
  }
  async function stop() {
    if (!app) return;
    app.server.closeAllConnections();
    await app.close();
    app = undefined;
  }
  await start();
  t.after(async () => { await stop(); await rm(directory, { recursive: true, force: true }); });
  function client() {
    let cookie = '';
    return {
      async request(path, method = 'GET', data) {
        const response = await fetch(base + path, {
          method, signal: AbortSignal.timeout(8000),
          headers: { origin: base, ...(cookie ? { cookie } : {}), ...(data === undefined ? {} : { 'content-type': 'application/json' }) },
          ...(data === undefined ? {} : { body: JSON.stringify(data) }),
        });
        const setCookie = response.headers.getSetCookie();
        if (setCookie.length) cookie = setCookie[0].split(';')[0];
        const raw = await response.text();
        let body;
        try { body = JSON.parse(raw); } catch { assert.fail(`Non-JSON response ${response.status}: ${raw.slice(0, 200)}`); }
        return { status: response.status, body };
      },
      async ok(path, method = 'GET', data) {
        const response = await this.request(path, method, data);
        assert.ok(response.status >= 200 && response.status < 300, `${method} ${path}: ${response.status} ${JSON.stringify(response.body)}`);
        return response.body;
      },
    };
  }
  async function guest(name) {
    const person = client();
    await person.ok('/api/session', 'POST', {});
    await person.ok('/api/profile', 'PUT', {
      name, trackId: 'python', level: 'beginner', timezone: 'UTC',
      availability: slots.map(({ day }) => ({ day, start: '19:00', end: '22:00' })),
    });
    return person;
  }
  return { client, guest, setTime: value => { time = new Date(value); }, restart: async () => { await stop(); await start(); } };
}

const dashboard = (person, id) => person.ok(`/api/squads/${id}`);
const meetingPath = (id, meetingId) => `/api/squads/${id}/meetings/${meetingId}`;
const ready = (person, id, meetingId, value = true) => person.ok(`${meetingPath(id, meetingId)}/readiness`, 'PUT', { ready: value });
const launch = (person, id, meetingId) => person.request(`${meetingPath(id, meetingId)}/launch`, 'POST', {});
const getMeeting = (detail, meetingId) => detail.meetings.find(meeting => meeting.id === meetingId);
const denied = response => assert.ok([401, 403, 404].includes(response.status), JSON.stringify(response));
const rejected = response => assert.ok(response.status >= 400 && response.status < 500, JSON.stringify(response));
async function team(f, size = 3) {
  const people = await Promise.all(Array.from({ length: size }, (_, index) => f.guest(`Learner ${index + 1}`)));
  const { squadId: id } = await people[0].ok('/api/squads', 'POST', { slots });
  for (const person of people.slice(1)) await person.ok(`/api/squads/${id}/join`, 'POST', {});
  const detail = await dashboard(people[0], id);
  return { people, id, detail, meetingId: detail.meetings[0].id };
}
async function readyAll(people, id, meetingId) {
  for (const person of people) await ready(person, id, meetingId);
}
function noUpcomingUrl(detail, meetingId) {
  assert.ok(!getMeeting(detail, meetingId).meetUrl, 'The conference URL must remain hidden until every current member is ready');
}
async function providerEntered(promise) {
  let timer;
  try {
    await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Meet provider was not called')), 4000); })]);
  } finally { clearTimeout(timer); }
}

test('readiness is explicit, strictly boolean, private to the caller, and idempotent', async t => {
  const f = await fixture(t);
  const { people: [a, b], id, meetingId, detail } = await team(f);
  const first = getMeeting(detail, meetingId).readiness;
  assert.equal(first.eligible, true);
  assert.equal(first.readyCount, 0);
  assert.equal(first.totalCount, 3);
  assert.equal(first.selfReady, false);
  for (const value of ['true', 1, null, {}, []]) rejected(await a.request(`${meetingPath(id, meetingId)}/readiness`, 'PUT', { ready: value }));
  rejected(await a.request(`${meetingPath(id, meetingId)}/readiness`, 'PUT', {}));
  const bId = (await b.ok('/api/bootstrap')).user.id;
  await a.ok(`${meetingPath(id, meetingId)}/readiness`, 'PUT', { ready: true, userId: bId });
  await ready(a, id, meetingId);
  const aState = getMeeting(await dashboard(a, id), meetingId).readiness;
  const bState = getMeeting(await dashboard(b, id), meetingId).readiness;
  assert.equal(aState.readyCount, 1);
  assert.equal(aState.selfReady, true);
  assert.equal(bState.selfReady, false);
  assert.equal(bState.members.find(member => member.id === bId).ready, false);
  assert.equal(aState.allReady, false);
  const cancelled = await ready(a, id, meetingId, false);
  assert.equal(getMeeting(cancelled, meetingId).readiness.readyCount, 0);
});

test('launch waits for every member, then persists one common URL without GET side effects', async t => {
  const calls = [];
  const f = await fixture(t, { meetAdapter: async input => { calls.push(input); return validAdapter(); } });
  const { people, id, meetingId } = await team(f);
  await readyAll(people.slice(0, 2), id, meetingId);
  await launch(people[0], id, meetingId);
  assert.equal(calls.length, 0);
  noUpcomingUrl(await dashboard(people[0], id), meetingId);
  await ready(people[2], id, meetingId);
  assert.equal(calls.length, 0, 'Readiness mutation and GET must not create a conference');
  const launched = await launch(people[2], id, meetingId);
  assert.equal(launched.status, 200, JSON.stringify(launched.body));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].meetingId, meetingId);
  assert.equal(calls[0].squadId, id);
  assert.ok(calls[0].organizerId);
  const launchIds = new Set();
  for (const person of people) {
    const meeting = getMeeting(await dashboard(person, id), meetingId);
    assert.equal(meeting.meetUrl, meetUrl);
    assert.equal(meeting.readiness.status, 'ready');
    assert.equal(meeting.readiness.allReady, true);
    assert.equal(meeting.readiness.selfReady, true);
    assert.ok(meeting.readiness.launchId);
    launchIds.add(meeting.readiness.launchId);
    await launch(person, id, meetingId);
  }
  assert.equal(launchIds.size, 1);
  assert.equal(calls.length, 1, 'Repeated requests must reuse the saved conference');
});

test('concurrent launch requests create only one provider conference', { timeout: 12000 }, async t => {
  const entered = Promise.withResolvers();
  const released = Promise.withResolvers();
  let calls = 0;
  const f = await fixture(t, { meetAdapter: async () => { calls++; entered.resolve(); await released.promise; return validAdapter(); } });
  const { people, id, meetingId } = await team(f);
  await readyAll(people, id, meetingId);
  const first = launch(people[0], id, meetingId);
  try {
    await providerEntered(entered.promise);
    const others = people.map(person => launch(person, id, meetingId));
    const pending = getMeeting(await dashboard(people[1], id), meetingId);
    assert.equal(pending.readiness.status, 'creating');
    assert.ok(!pending.meetUrl);
    released.resolve();
    const results = await Promise.all([first, ...others]);
    assert.ok(results.every(result => result.status === 200 || result.status === 409), JSON.stringify(results));
    assert.equal(calls, 1);
    assert.equal(getMeeting(await dashboard(people[0], id), meetingId).meetUrl, meetUrl);
  } finally { released.resolve(); await first; }
});

test('provider errors remain truthful and private, with an explicit successful retry', async t => {
  let calls = 0;
  const f = await fixture(t, { meetAdapter: async () => { if (++calls === 1) throw new Error('provider secret-token-do-not-disclose'); return validAdapter(); } });
  const { people, id, meetingId } = await team(f);
  await readyAll(people, id, meetingId);
  const failure = await launch(people[0], id, meetingId);
  assert.ok(!JSON.stringify(failure.body).includes('secret-token-do-not-disclose'));
  const failed = await dashboard(people[0], id);
  assert.equal(getMeeting(failed, meetingId).readiness.status, 'error');
  noUpcomingUrl(failed, meetingId);
  for (const person of people) await dashboard(person, id);
  assert.equal(calls, 1, 'Polling must not repeatedly call a failing provider');
  assert.equal((await launch(people[0], id, meetingId)).status, 200);
  assert.equal(calls, 2);
  assert.equal(getMeeting(await dashboard(people[0], id), meetingId).meetUrl, meetUrl);
});

test('unsafe URLs returned by a provider are never exposed as conference links', async t => {
  const f = await fixture(t, { meetAdapter: async () => ({ url: 'https://meet.google.com.evil.example/abc-defg-hij' }) });
  const { people, id, meetingId } = await team(f);
  await readyAll(people, id, meetingId);
  await launch(people[0], id, meetingId);
  const detail = await dashboard(people[0], id);
  assert.equal(getMeeting(detail, meetingId).readiness.status, 'error');
  noUpcomingUrl(detail, meetingId);
  assert.ok(!JSON.stringify(detail).includes('evil.example'));
});

test('anonymous, outside and departed members cannot mark ready or launch', async t => {
  const f = await fixture(t);
  const { people, id, meetingId } = await team(f, 4);
  const outsider = await f.guest('Outside');
  const anonymous = f.client();
  for (const person of [outsider, anonymous]) {
    denied(await person.request(`${meetingPath(id, meetingId)}/readiness`, 'PUT', { ready: true }));
    denied(await launch(person, id, meetingId));
  }
  await ready(people[3], id, meetingId);
  await people[3].ok(`/api/squads/${id}/leave`, 'POST', {});
  denied(await people[3].request(`${meetingPath(id, meetingId)}/readiness`, 'PUT', { ready: true }));
  denied(await launch(people[3], id, meetingId));
  const state = getMeeting(await dashboard(people[0], id), meetingId).readiness;
  assert.equal(state.totalCount, 3);
  assert.equal(state.readyCount, 0, 'Departed readiness must not count');
  const former = getMeeting(await dashboard(people[3], id), meetingId).readiness;
  assert.equal(former.eligible, false);
  assert.equal(former.selfReady, false);
});

test('only the nearest not-ended meeting is eligible, and readiness never carries into the next meeting', async t => {
  const f = await fixture(t);
  const { people, id, detail, meetingId } = await team(f);
  const nextId = detail.meetings[1].id;
  rejected(await people[0].request(`${meetingPath(id, nextId)}/readiness`, 'PUT', { ready: true }));
  rejected(await launch(people[0], id, nextId));
  await readyAll(people, id, meetingId);
  f.setTime(detail.meetings[0].endsAt);
  const moved = await dashboard(people[0], id);
  assert.equal(getMeeting(moved, meetingId).readiness.eligible, false);
  assert.equal(getMeeting(moved, nextId).readiness.eligible, true);
  assert.equal(getMeeting(moved, nextId).readiness.readyCount, 0);
  rejected(await people[0].request(`${meetingPath(id, meetingId)}/readiness`, 'PUT', { ready: true }));
  rejected(await launch(people[0], id, meetingId));
  await ready(people[0], id, nextId);
  f.setTime(new Date(new Date(detail.squad.endDate).getTime() + 1));
  const completed = await dashboard(people[0], id);
  assert.equal(completed.squad.status, 'completed');
  assert.ok(completed.meetings.every(meeting => !meeting.readiness.eligible));
  rejected(await people[0].request(`${meetingPath(id, nextId)}/readiness`, 'PUT', { ready: false }));
  rejected(await launch(people[0], id, nextId));
});

test('forming squads cannot launch, and readiness excludes meetings belonging to another squad', async t => {
  let calls = 0;
  const f = await fixture(t, { meetAdapter: async () => { calls++; return validAdapter(); } });
  const a = await f.guest('Solo');
  const { squadId: soloId } = await a.ok('/api/squads', 'POST', { slots });
  const soloMeeting = (await dashboard(a, soloId)).meetings[0];
  assert.equal(soloMeeting.readiness.eligible, false);
  rejected(await a.request(`${meetingPath(soloId, soloMeeting.id)}/readiness`, 'PUT', { ready: true }));
  rejected(await launch(a, soloId, soloMeeting.id));
  const { people, id, meetingId } = await team(f);
  rejected(await people[0].request(`${meetingPath(id, soloMeeting.id)}/readiness`, 'PUT', { ready: true }));
  rejected(await launch(people[0], id, soloMeeting.id));
  await readyAll(people, id, meetingId);
  assert.equal(calls, 0);
});

test('manually provided Meet links obey readiness gating and require no automatic provider', async t => {
  const f = await fixture(t, { meetAdapter: null });
  const { people, id, meetingId } = await team(f);
  await people[0].ok(meetingPath(id, meetingId), 'PUT', { url: meetUrl });
  for (const person of people) noUpcomingUrl(await dashboard(person, id), meetingId);
  await readyAll(people, id, meetingId);
  await launch(people[0], id, meetingId);
  for (const person of people) {
    const meeting = getMeeting(await dashboard(person, id), meetingId);
    assert.equal(meeting.meetUrl, meetUrl);
    assert.equal(meeting.readiness.status, 'ready');
  }
});

test('missing Google configuration never fabricates a conference or reports successful launch', async t => {
  const f = await fixture(t, { meetAdapter: null });
  const { people, id, meetingId } = await team(f);
  await readyAll(people, id, meetingId);
  await launch(people[0], id, meetingId);
  const detail = await dashboard(people[0], id);
  assert.equal(detail.googleMeet.configured, false);
  assert.equal(detail.googleMeet.connected, false);
  assert.equal(getMeeting(detail, meetingId).readiness.status, 'setup_required');
  noUpcomingUrl(detail, meetingId);
});

test('readiness and created URLs survive restart without calling the provider again', async t => {
  let calls = 0;
  const f = await fixture(t, { meetAdapter: async () => { calls++; return validAdapter(); } });
  const { people, id, meetingId } = await team(f);
  await ready(people[0], id, meetingId);
  await f.restart();
  assert.equal(getMeeting(await dashboard(people[0], id), meetingId).readiness.selfReady, true);
  assert.equal(getMeeting(await dashboard(people[1], id), meetingId).readiness.selfReady, false);
  await readyAll(people.slice(1), id, meetingId);
  await launch(people[0], id, meetingId);
  const before = getMeeting(await dashboard(people[0], id), meetingId);
  await f.restart();
  for (const person of people) {
    const after = getMeeting(await dashboard(person, id), meetingId);
    assert.equal(after.meetUrl, before.meetUrl);
    assert.equal(after.readiness.launchId, before.readiness.launchId);
    await launch(person, id, meetingId);
  }
  assert.equal(calls, 1);
});

test('withdrawing readiness during provider creation prevents premature URL disclosure', { timeout: 12000 }, async t => {
  const entered = Promise.withResolvers();
  const released = Promise.withResolvers();
  let calls = 0;
  const f = await fixture(t, { meetAdapter: async () => { calls++; entered.resolve(); await released.promise; return validAdapter(); } });
  const { people, id, meetingId } = await team(f);
  await readyAll(people, id, meetingId);
  const pending = launch(people[0], id, meetingId);
  try {
    await providerEntered(entered.promise);
    await ready(people[1], id, meetingId, false);
    released.resolve();
    const result = await pending;
    if (result.body.meetings) noUpcomingUrl(result.body, meetingId);
    for (const person of people) {
      const detail = await dashboard(person, id);
      noUpcomingUrl(detail, meetingId);
      assert.equal(getMeeting(detail, meetingId).readiness.allReady, false);
    }
    assert.equal(calls, 1);
  } finally { released.resolve(); await pending; }
});

test('a new member joining during creation is included before any conference URL is released', { timeout: 12000 }, async t => {
  const entered = Promise.withResolvers();
  const released = Promise.withResolvers();
  const f = await fixture(t, { meetAdapter: async () => { entered.resolve(); await released.promise; return validAdapter(); } });
  const { people, id, meetingId } = await team(f);
  const newcomer = await f.guest('New fourth member');
  await readyAll(people, id, meetingId);
  const pending = launch(people[0], id, meetingId);
  try {
    await providerEntered(entered.promise);
    await newcomer.ok(`/api/squads/${id}/join`, 'POST', {});
    released.resolve();
    const result = await pending;
    if (result.body.meetings) noUpcomingUrl(result.body, meetingId);
    for (const person of [...people, newcomer]) {
      const detail = await dashboard(person, id);
      noUpcomingUrl(detail, meetingId);
      const state = getMeeting(detail, meetingId).readiness;
      assert.equal(state.totalCount, 4);
      assert.equal(state.readyCount, 3);
      assert.equal(state.allReady, false);
    }
  } finally { released.resolve(); await pending; }
});

test('a launching member who leaves during creation cannot receive the generated private URL', { timeout: 12000 }, async t => {
  const entered = Promise.withResolvers();
  const released = Promise.withResolvers();
  const f = await fixture(t, { meetAdapter: async () => { entered.resolve(); await released.promise; return validAdapter(); } });
  const { people, id, meetingId } = await team(f, 4);
  await readyAll(people, id, meetingId);
  const pending = launch(people[0], id, meetingId);
  try {
    await providerEntered(entered.promise);
    await people[0].ok(`/api/squads/${id}/leave`, 'POST', {});
    released.resolve();
    const result = await pending;
    assert.ok(!JSON.stringify(result.body).includes(meetUrl), 'An in-flight response must recheck that its caller is still a member');
    if (result.body.meetings) assert.equal(getMeeting(result.body, meetingId).readiness.eligible, false);
    const remaining = getMeeting(await dashboard(people[1], id), meetingId).readiness;
    assert.equal(remaining.totalCount, 3);
  } finally { released.resolve(); await pending; }
});

test('an organizer leaving during creation hides that space from everyone until retry chooses a current organizer', { timeout: 12000 }, async t => {
  const entered = Promise.withResolvers();
  const released = Promise.withResolvers();
  const calls = [];
  const replacementUrl = 'https://meet.google.com/klm-nopq-rst';
  const f = await fixture(t, { meetAdapter: async input => {
    calls.push(input);
    if (calls.length === 1) {
      entered.resolve(input.organizerId);
      await released.promise;
      return validAdapter();
    }
    return { url: replacementUrl, spaceName: 'spaces/replacement-organizer' };
  } });
  const { people, id, meetingId } = await team(f, 4);
  const identities = await Promise.all(people.map(async person => ({ person, id: (await person.ok('/api/bootstrap')).user.id })));
  await readyAll(people, id, meetingId);
  const pending = launch(people[0], id, meetingId);
  try {
    await providerEntered(entered.promise);
    const organizerId = await entered.promise;
    const organizer = identities.find(identity => identity.id === organizerId);
    assert.ok(organizer, 'The provider must use an active squad member as organizer');
    await organizer.person.ok(`/api/squads/${id}/leave`, 'POST', {});
    released.resolve();
    const result = await pending;
    assert.ok(!JSON.stringify(result.body).includes(meetUrl));
    const remaining = identities.filter(identity => identity.id !== organizerId);
    for (const { person } of remaining) {
      const detail = await dashboard(person, id);
      noUpcomingUrl(detail, meetingId);
      const state = getMeeting(detail, meetingId).readiness;
      assert.equal(state.totalCount, 3);
      assert.equal(state.allReady, true);
      assert.equal(state.status, 'error');
    }
    assert.equal(calls.length, 1, 'Polling must not silently create a replacement conference');
    assert.equal((await launch(remaining[0].person, id, meetingId)).status, 200);
    assert.equal(calls.length, 2);
    assert.notEqual(calls[1].organizerId, organizerId);
    for (const { person } of remaining) {
      const meeting = getMeeting(await dashboard(person, id), meetingId);
      assert.equal(meeting.meetUrl, replacementUrl);
      assert.equal(meeting.readiness.status, 'ready');
    }
  } finally { released.resolve(); await pending; }
});
