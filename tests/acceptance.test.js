import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createApp } from '../server/app.js';

const initialTime = '2026-11-14T12:00:00.000Z';
const slots = [{ day: 2, start: '19:00' }, { day: 4, start: '19:00' }];
const availability = slots.map(({ day }) => ({ day, start: '19:00', end: '22:00' }));
const profile = (name, extra = {}) => ({ name, trackId: 'python', level: 'beginner', timezone: 'UTC', availability, ...extra });

async function fixture(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'learning-squads-test-'));
  const dbPath = join(directory, 'test.sqlite');
  let time = new Date(options.time ?? initialTime);
  let app;
  let base;
  async function start() {
    app = createApp({ dbPath, now: () => new Date(time), aiAdapter: options.aiAdapter });
    app.server.listen(0, '127.0.0.1');
    await once(app.server, 'listening');
    base = `http://127.0.0.1:${app.server.address().port}`;
  }
  async function stop() {
    if (!app) return;
    if (app.server.listening) {
      app.server.closeAllConnections();
      await new Promise((resolve, reject) => app.server.close(error => error ? reject(error) : resolve()));
    }
    await app.close();
    app = undefined;
  }
  await start();
  t.after(async () => { await stop(); await rm(directory, { recursive: true, force: true }); });
  function client() {
    let cookie = '';
    return {
      get cookie() { return cookie; },
      async request(path, method = 'GET', data, extraHeaders = {}) {
        const response = await fetch(base + path, {
          method,
          headers: { ...(cookie ? { cookie } : {}), origin: base, ...(data === undefined ? {} : { 'content-type': 'application/json' }), ...extraHeaders },
          ...(data === undefined ? {} : { body: JSON.stringify(data) }),
        });
        const setCookie = response.headers.getSetCookie();
        if (setCookie.length) cookie = setCookie[0].split(';')[0];
        const text = await response.text();
        let body;
        try { body = JSON.parse(text); } catch { assert.fail(`Non-JSON API response ${response.status}: ${text.slice(0, 500)}`); }
        return { status: response.status, body, headers: response.headers };
      },
      async ok(path, method = 'GET', data) {
        const result = await this.request(path, method, data);
        assert.ok(result.status >= 200 && result.status < 300, `${method} ${path}: ${result.status} ${JSON.stringify(result.body)}`);
        return result.body;
      },
    };
  }
  async function guest(name, extra) {
    const person = client();
    await person.ok('/api/session', 'POST', {});
    await person.ok('/api/profile', 'PUT', profile(name, extra));
    return person;
  }
  return { client, guest, setTime: value => { time = new Date(value); }, restart: async () => { await stop(); await start(); } };
}

async function createSquad(person, customSlots = slots) {
  const result = await person.ok('/api/squads', 'POST', { slots: customSlots });
  assert.ok(result.squadId);
  return result.squadId;
}
const dashboard = (person, id) => person.ok(`/api/squads/${id}`);
const joinSquad = (person, id) => person.ok(`/api/squads/${id}/join`, 'POST', {});
function denied(result) { assert.ok([401, 403, 404].includes(result.status), JSON.stringify(result)); }
function invalid(result) { assert.ok([400, 422].includes(result.status), JSON.stringify(result)); }
function conflict(result) { assert.equal(result.status, 409, JSON.stringify(result.body)); }

test('guests complete the real creation, matching, joining and persisted-progress flow', async t => {
  const f = await fixture(t);
  const anonymous = f.client();
  assert.equal((await anonymous.ok('/api/bootstrap')).user, null);
  const a = await f.guest('Alice');
  const b = await f.guest('Bob');
  const c = await f.guest('Casey');
  assert.notEqual(a.cookie, b.cookie);
  assert.equal((await a.ok('/api/matches')).squads.length, 0);
  const preview = await a.ok('/api/squads/preview', 'POST', { slots });
  assert.equal(preview.meetings.length, 8);
  assert.equal(new Set(preview.meetings.map(meeting => meeting.startsAt)).size, 8);
  for (const meeting of preview.meetings) {
    assert.equal(new Date(meeting.endsAt) - new Date(meeting.startsAt), 50 * 60_000);
    assert.equal(new Date(meeting.windowEndsAt) - new Date(meeting.startsAt), 60 * 60_000);
  }
  const id = await createSquad(a);
  assert.equal((await dashboard(a, id)).squad.status, 'forming');
  assert.equal((await b.ok('/api/matches')).squads[0].id, id);
  await joinSquad(b, id);
  await joinSquad(c, id);
  const ready = await dashboard(a, id);
  assert.equal(ready.squad.status, 'ready');
  assert.equal(ready.squad.memberCount, 3);
  assert.equal(ready.plan.weeks.length, 4);
  const tasks = ready.plan.weeks.flatMap(week => week.tasks);
  assert.equal(tasks.length, 8);
  await a.ok(`/api/squads/${id}/progress/${tasks[0].id}`, 'PUT', { status: 'done', note: 'Added my first habit without a GitHub account.', url: '' });
  const meetingId = ready.meetings[0].id;
  await b.ok(`/api/squads/${id}/meetings/${meetingId}`, 'PUT', { url: 'https://meet.google.com/abc-defg-hij' });
  await f.restart();
  assert.equal((await a.ok('/api/bootstrap')).currentSquadId, id);
  const persisted = await dashboard(a, id);
  assert.equal(persisted.progress.find(item => item.taskId === tasks[0].id).status, 'done');
  assert.equal(persisted.progress.find(item => item.taskId === tasks[0].id).note, 'Added my first habit without a GitHub account.');
  assert.equal(persisted.meetings.find(item => item.id === meetingId).meetUrl, 'https://meet.google.com/abc-defg-hij');
  assert.deepEqual(persisted.plan, ready.plan);
  assert.ok(!(await dashboard(b, id)).progress.some(item => item.status === 'done'));
});

test('double joins are idempotent and concurrent final-seat joins cannot exceed four', async t => {
  const f = await fixture(t);
  const people = await Promise.all(['A', 'B', 'C', 'D', 'E'].map(name => f.guest(name)));
  const id = await createSquad(people[0]);
  await Promise.all([joinSquad(people[1], id), joinSquad(people[1], id)]);
  assert.equal((await dashboard(people[0], id)).squad.memberCount, 2);
  await joinSquad(people[2], id);
  const results = await Promise.all(people.slice(3).map(person => person.request(`/api/squads/${id}/join`, 'POST', {})));
  assert.equal(results.filter(result => result.status >= 200 && result.status < 300).length, 1);
  assert.equal(results.filter(result => result.status === 409).length, 1);
  const full = await dashboard(people[0], id);
  assert.equal(full.squad.memberCount, 4);
  assert.equal(new Set(full.members.filter(member => member.active).map(member => member.id)).size, 4);
});

test('one person cannot join two unfinished squads even with simultaneous requests', async t => {
  const f = await fixture(t);
  const [a, b, c] = await Promise.all(['A', 'B', 'C'].map(name => f.guest(name)));
  const ids = await Promise.all([createSquad(a), createSquad(b)]);
  const results = await Promise.all(ids.map(id => c.request(`/api/squads/${id}/join`, 'POST', {})));
  assert.equal(results.filter(result => result.status >= 200 && result.status < 300).length, 1);
  assert.equal(results.filter(result => result.status === 409).length, 1);
  const counts = await Promise.all([dashboard(a, ids[0]), dashboard(b, ids[1])]);
  assert.equal(counts.reduce((sum, item) => sum + item.squad.memberCount, 0), 3);
  conflict(await c.request('/api/squads', 'POST', { slots }));
});

test('outsiders cannot read or mutate private squad data, and body userId cannot edit others', async t => {
  const f = await fixture(t);
  const [a, b, outsider] = await Promise.all(['A', 'B', 'Outside'].map(name => f.guest(name)));
  const id = await createSquad(a);
  await joinSquad(b, id);
  const detail = await dashboard(a, id);
  const task = detail.plan.weeks[0].tasks[0].id;
  const meeting = detail.meetings[0].id;
  denied(await outsider.request(`/api/squads/${id}`));
  denied(await outsider.request(`/api/squads/${id}/progress/${task}`, 'PUT', { status: 'done', note: '', url: '' }));
  denied(await outsider.request(`/api/squads/${id}/meetings/${meeting}`, 'PUT', { url: 'https://meet.google.com/abc-defg-hij' }));
  denied(await outsider.request(`/api/squads/${id}/adapt`, 'POST', {}));
  const bId = (await b.ok('/api/bootstrap')).user.id;
  const attempt = await a.request(`/api/squads/${id}/progress/${task}`, 'PUT', { userId: bId, status: 'done', note: 'Trying another owner', url: '' });
  assert.ok(attempt.status < 500);
  assert.ok(!(await dashboard(b, id)).progress.some(item => item.status === 'done'));
  const publicMatches = (await outsider.ok('/api/matches')).squads;
  assert.equal(publicMatches[0].teamProgress, undefined);
  assert.ok(publicMatches[0].meetings.every(item => !item.meetUrl));
});

test('unsafe Meet links, unsafe result URLs and invalid task states are rejected', async t => {
  const f = await fixture(t);
  const a = await f.guest('A');
  const id = await createSquad(a);
  const detail = await dashboard(a, id);
  const meetingPath = `/api/squads/${id}/meetings/${detail.meetings[0].id}`;
  for (const url of ['javascript:alert(1)', 'https://meet.google.com.evil.example/abc-defg-hij', 'http://meet.google.com/abc-defg-hij', 'https://evil.example/?meet.google.com']) {
    invalid(await a.request(meetingPath, 'PUT', { url }));
  }
  const taskPath = `/api/squads/${id}/progress/${detail.plan.weeks[0].tasks[0].id}`;
  for (const url of ['javascript:alert(1)', 'data:text/html,test', 'file:///secret']) {
    invalid(await a.request(taskPath, 'PUT', { status: 'done', note: '', url }));
  }
  invalid(await a.request(taskPath, 'PUT', { status: 'certified', note: '', url: '' }));
  await a.ok(taskPath, 'PUT', { status: 'in_progress', note: 'Working', url: 'https://example.com/project' });
  await a.ok(meetingPath, 'PUT', { url: 'https://meet.google.com/abc-defg-hij' });
  await a.ok(meetingPath, 'PUT', { url: '' });
  assert.ok(!(await dashboard(a, id)).meetings[0].meetUrl);
});

test('matching enforces track, level and entire one-hour windows', async t => {
  const f = await fixture(t);
  const owner = await f.guest('Owner');
  const id = await createSquad(owner);
  const incompatible = [
    { trackId: 'javascript' },
    { level: 'basics' },
    { availability: [{ day: 2, start: '19:30', end: '21:00' }, { day: 4, start: '19:00', end: '21:00' }] },
    { availability: [{ day: 2, start: '19:00', end: '21:00' }, { day: 5, start: '19:00', end: '21:00' }] },
  ];
  for (let index = 0; index < incompatible.length; index++) {
    const person = await f.guest(`Mismatch ${index}`, incompatible[index]);
    assert.equal((await person.ok('/api/matches')).squads.length, 0);
    conflict(await person.request(`/api/squads/${id}/join`, 'POST', {}));
  }
  const adjacent = await f.guest('Adjacent intervals', { availability: [
    { day: 2, start: '19:00', end: '19:30' }, { day: 2, start: '19:30', end: '20:00' },
    { day: 4, start: '19:00', end: '19:30' }, { day: 4, start: '19:30', end: '20:00' },
  ] });
  assert.equal((await adjacent.ok('/api/matches')).squads[0].id, id);
  const halfHourZone = await f.guest('India, next local day', { timezone: 'Asia/Kolkata', availability: [
    { day: 3, start: '00:30', end: '01:30' }, { day: 5, start: '00:30', end: '01:30' },
  ] });
  assert.equal((await halfHourZone.ok('/api/matches')).squads[0].id, id);
});

test('all eight concrete meetings are checked across a US daylight-saving change', async t => {
  const f = await fixture(t, { time: '2027-02-27T12:00:00.000Z' });
  const owner = await f.guest('New York', { timezone: 'America/New_York' });
  const id = await createSquad(owner);
  const detail = await dashboard(owner, id);
  assert.equal(new Date(detail.meetings[0].startsAt).toISOString(), '2027-03-03T00:00:00.000Z');
  assert.equal(new Date(detail.meetings[4].startsAt).toISOString(), '2027-03-16T23:00:00.000Z');
  const limited = await f.guest('UTC first-week only', { availability: [
    { day: 3, start: '00:00', end: '01:00' }, { day: 5, start: '00:00', end: '01:00' },
  ] });
  assert.equal((await limited.ok('/api/matches')).squads.length, 0);
  conflict(await limited.request(`/api/squads/${id}/join`, 'POST', {}));
  const sameZone = await f.guest('Same local recurrence', { timezone: 'America/New_York' });
  assert.equal((await sameZone.ok('/api/matches')).squads[0].id, id);
});

test('profile validation prevents invalid schedules and enforces AI prerequisites', async t => {
  const f = await fixture(t);
  const person = f.client();
  await person.ok('/api/session', 'POST', {});
  for (const extra of [
    { timezone: 'Fake/Nowhere' },
    { availability: [{ day: 2, start: '19:00', end: '22:00' }] },
    { availability: [{ day: 2, start: '19:15', end: '20:15' }, { day: 4, start: '19:00', end: '20:00' }] },
    { availability: [{ day: 2, start: '22:00', end: '19:00' }, { day: 4, start: '19:00', end: '20:00' }] },
    { trackId: 'ai', level: 'beginner' },
    { trackId: 'not-a-track' },
  ]) invalid(await person.request('/api/profile', 'PUT', profile('Invalid', extra)));
  await person.ok('/api/profile', 'PUT', profile('AI learner', { trackId: 'ai', level: 'basics' }));
});

test('matching prioritizes squads needing a third member and returns at most three', async t => {
  const f = await fixture(t);
  const owners = await Promise.all(['Owner 1', 'Owner 2', 'Owner 3', 'Owner 4'].map(name => f.guest(name)));
  const ids = [];
  for (const owner of owners) ids.push(await createSquad(owner));
  const helper = await f.guest('Second member');
  await joinSquad(helper, ids[2]);
  const seeker = await f.guest('Seeker');
  const matches = (await seeker.ok('/api/matches')).squads;
  assert.equal(matches.length, 3);
  assert.equal(matches[0].id, ids[2]);
  assert.equal(matches[0].memberCount, 2);
});

test('squad creation rejects duplicate days and nonexistent DST clock times', async t => {
  const f = await fixture(t, { time: '2027-02-27T12:00:00.000Z' });
  const a = await f.guest('DST creator', { timezone: 'America/New_York', availability: [
    { day: 2, start: '02:00', end: '04:00' }, { day: 7, start: '02:00', end: '04:00' },
  ] });
  invalid(await a.request('/api/squads/preview', 'POST', { slots: [{ day: 2, start: '02:00' }, { day: 2, start: '03:00' }] }));
  const springGap = [{ day: 2, start: '02:00' }, { day: 7, start: '02:00' }];
  invalid(await a.request('/api/squads/preview', 'POST', { slots: springGap }));
  invalid(await a.request('/api/squads', 'POST', { slots: springGap }));
  assert.equal((await a.ok('/api/bootstrap')).currentSquadId, null);
});

test('changing availability reports conflicts and requires confirmation without rescheduling', async t => {
  const f = await fixture(t);
  const a = await f.guest('A');
  const id = await createSquad(a);
  const before = await dashboard(a, id);
  const changed = profile('A', { availability: [{ day: 1, start: '10:00', end: '12:00' }, { day: 3, start: '10:00', end: '12:00' }] });
  const result = await a.request('/api/profile', 'PUT', changed);
  conflict(result);
  assert.equal(result.body.code, 'schedule_conflict');
  await a.ok('/api/profile', 'PUT', { ...changed, confirmConflict: true });
  assert.deepEqual((await dashboard(a, id)).meetings.map(item => item.startsAt), before.meetings.map(item => item.startsAt));
  const changedTrack = await a.request('/api/profile', 'PUT', { ...changed, trackId: 'javascript', confirmConflict: true });
  assert.ok([400, 409, 422].includes(changedTrack.status));
});

test('leaving before start updates readiness, retains history and removes write access', async t => {
  const f = await fixture(t);
  const [a, b, c] = await Promise.all(['A', 'B', 'C'].map(name => f.guest(name)));
  const id = await createSquad(a);
  await joinSquad(b, id);
  await joinSquad(c, id);
  const taskId = (await dashboard(c, id)).plan.weeks[0].tasks[0].id;
  await c.ok(`/api/squads/${id}/progress/${taskId}`, 'PUT', { status: 'done', note: 'Before leaving', url: '' });
  await c.ok(`/api/squads/${id}/leave`, 'POST', {});
  assert.equal((await dashboard(a, id)).squad.status, 'forming');
  assert.equal((await c.ok('/api/bootstrap')).currentSquadId, null);
  const archive = await dashboard(c, id);
  assert.equal(archive.canEdit, false);
  assert.equal(archive.progress.find(item => item.taskId === taskId).status, 'done');
  denied(await c.request(`/api/squads/${id}/progress/${taskId}`, 'PUT', { status: 'not_started', note: '', url: '' }));
});

test('time closes undersubscribed squads and releases users to create another cohort', async t => {
  const f = await fixture(t);
  const a = await f.guest('A');
  const id = await createSquad(a);
  const before = await dashboard(a, id);
  f.setTime(new Date(new Date(before.meetings[0].startsAt).getTime() + 1_000));
  assert.equal((await dashboard(a, id)).squad.status, 'closed');
  assert.equal((await a.ok('/api/bootstrap')).currentSquadId, null);
  assert.notEqual(await createSquad(a), id);
});

test('ready squads become active, remain active after a departure, then complete without inventing progress', async t => {
  const f = await fixture(t);
  const [a, b, c, outsider] = await Promise.all(['A', 'B', 'C', 'D'].map(name => f.guest(name)));
  const id = await createSquad(a);
  await joinSquad(b, id);
  await joinSquad(c, id);
  const before = await dashboard(a, id);
  f.setTime(new Date(new Date(before.meetings[0].startsAt).getTime() + 1_000));
  assert.equal((await dashboard(a, id)).squad.status, 'active');
  conflict(await outsider.request(`/api/squads/${id}/join`, 'POST', {}));
  await c.ok(`/api/squads/${id}/leave`, 'POST', {});
  assert.equal((await dashboard(a, id)).squad.status, 'active');
  f.setTime(new Date(new Date(before.squad.endDate).getTime() + 86_400_000));
  const completed = await dashboard(a, id);
  assert.equal(completed.squad.status, 'completed');
  assert.ok(completed.progress.every(item => item.status !== 'done'));
  assert.equal((await a.ok('/api/bootstrap')).currentSquadId, null);
});

test('unavailable AI preserves the base plan and leaves core progress usable', async t => {
  const f = await fixture(t, { aiAdapter: async () => { throw new Error('Simulated provider outage'); } });
  const a = await f.guest('A');
  const id = await createSquad(a);
  const before = await dashboard(a, id);
  const result = await a.request(`/api/squads/${id}/adapt`, 'POST', {});
  assert.ok(result.status < 500, JSON.stringify(result.body));
  const after = await dashboard(a, id);
  assert.equal(after.plan.source, 'base');
  assert.deepEqual(after.plan.weeks, before.plan.weeks);
  await a.ok(`/api/squads/${id}/progress/${after.plan.weeks[0].tasks[0].id}`, 'PUT', { status: 'done', note: 'Still usable', url: '' });
});

test('successful AI adaptation is persisted, labelled accurately and performed only once', async t => {
  let calls = 0;
  const f = await fixture(t, { aiAdapter: async input => {
    calls++;
    assert.equal(input.trackId, 'python');
    assert.equal(input.durationWeeks, 4);
    assert.equal(input.name, undefined);
    return { weeks: input.weeks.map(week => ({ ...week, title: `Adapted: ${week.title}` })) };
  } });
  const a = await f.guest('Private learner name');
  const id = await createSquad(a);
  const initial = await dashboard(a, id);
  assert.equal((await a.ok(`/api/squads/${id}/adapt`, 'POST', {})).source, 'ai');
  await a.ok(`/api/squads/${id}/adapt`, 'POST', {});
  assert.equal(calls, 1);
  await f.restart();
  const adapted = await dashboard(a, id);
  assert.equal(adapted.plan.source, 'ai');
  assert.ok(adapted.plan.weeks.every(week => week.title.startsWith('Adapted: ')));
  assert.deepEqual(adapted.plan.weeks.flatMap(week => week.tasks.map(task => task.id)), initial.plan.weeks.flatMap(week => week.tasks.map(task => task.id)));
  await a.ok(`/api/squads/${id}/adapt`, 'POST', {});
  assert.equal(calls, 1);
});

test('AI cannot rewrite a plan once a participant has started work', async t => {
  let calls = 0;
  const f = await fixture(t, { aiAdapter: async input => { calls++; return { weeks: input.weeks }; } });
  const [a, b] = await Promise.all(['A', 'B'].map(name => f.guest(name)));
  const id = await createSquad(a);
  await joinSquad(b, id);
  const before = await dashboard(a, id);
  const taskId = before.plan.weeks[0].tasks[0].id;
  await b.ok(`/api/squads/${id}/progress/${taskId}`, 'PUT', { status: 'in_progress', note: 'Already working', url: '' });
  const response = await a.request(`/api/squads/${id}/adapt`, 'POST', {});
  assert.ok(response.status < 500);
  assert.equal(calls, 0);
  assert.deepEqual((await dashboard(a, id)).plan.weeks, before.plan.weeks);
  assert.equal((await dashboard(b, id)).progress.find(item => item.taskId === taskId).note, 'Already working');
});

test('malformed AI output is never accepted as an adapted curriculum', async t => {
  const f = await fixture(t, { aiAdapter: async () => ({ weeks: [{ week: 1, title: 'Incomplete', tasks: [] }] }) });
  const a = await f.guest('A');
  const id = await createSquad(a);
  const before = await dashboard(a, id);
  const response = await a.request(`/api/squads/${id}/adapt`, 'POST', {});
  assert.ok(response.status < 500);
  const after = await dashboard(a, id);
  assert.equal(after.plan.source, 'base');
  assert.deepEqual(after.plan.weeks, before.plan.weeks);
});

test('progress saved while AI is pending wins without losing work or rewriting its plan', async t => {
  let signalEntered;
  let release;
  const entered = new Promise(resolve => { signalEntered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const f = await fixture(t, { aiAdapter: async input => {
    signalEntered();
    await gate;
    return { weeks: input.weeks.map(week => ({ ...week, title: `Changed: ${week.title}` })) };
  } });
  const [a, b] = await Promise.all(['A', 'B'].map(name => f.guest(name)));
  const id = await createSquad(a);
  await joinSquad(b, id);
  const before = await dashboard(a, id);
  const pending = a.request(`/api/squads/${id}/adapt`, 'POST', {});
  let watchdog;
  try {
    await Promise.race([entered, new Promise((_, reject) => { watchdog = setTimeout(() => reject(new Error('AI adapter did not start')), 3000); })]);
    const taskId = before.plan.weeks[0].tasks[0].id;
    await b.ok(`/api/squads/${id}/progress/${taskId}`, 'PUT', { status: 'done', note: 'Saved during adaptation', url: '' });
    release();
    const result = await pending;
    conflict(result);
    assert.equal(result.body.code, 'plan_locked');
    const after = await dashboard(b, id);
    assert.equal(after.plan.source, 'base');
    assert.deepEqual(after.plan.weeks, before.plan.weeks);
    assert.equal(after.progress.find(item => item.taskId === taskId).status, 'done');
    assert.equal(after.progress.find(item => item.taskId === taskId).note, 'Saved during adaptation');
  } finally {
    clearTimeout(watchdog);
    release();
    await pending;
  }
});

test('cross-origin mutations are rejected before changing a guest profile', async t => {
  const f = await fixture(t);
  const a = await f.guest('Original name');
  for (const headers of [{ origin: 'https://attacker.example' }, { 'sec-fetch-site': 'cross-site' }]) {
    const result = await a.request('/api/profile', 'PUT', profile('Unwanted change'), headers);
    assert.equal(result.status, 403);
    assert.equal(result.body.code, 'invalid_origin');
    assert.equal((await a.ok('/api/bootstrap')).user.name, 'Original name');
  }
});
