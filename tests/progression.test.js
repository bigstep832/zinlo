import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createApp } from '../server/app.js';
import { basePlan, trackById } from '../server/curricula.js';

const initialTime = '2027-02-26T12:00:00.000Z';
const slots = [{ day: 2, start: '19:00' }, { day: 4, start: '19:00' }];
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'learning-squads-progression-'));
  let time = new Date(initialTime);
  const app = createApp({ dbPath: join(directory, 'test.sqlite'), now: () => new Date(time), aiAdapter: null, meetAdapter: null, googleMeetConfig: null });
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  const base = `http://127.0.0.1:${app.server.address().port}`;
  t.after(async () => { app.server.closeAllConnections(); await app.close(); await rm(directory, { recursive: true, force: true }); });
  function client() {
    let cookie = '';
    return {
      async request(path, method = 'GET', data) {
        const response = await fetch(base + path, { method, headers: { origin: base, ...(cookie ? { cookie } : {}), ...(data === undefined ? {} : { 'content-type': 'application/json' }) }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
        if (response.headers.getSetCookie().length) cookie = response.headers.getSetCookie()[0].split(';')[0];
        return { status: response.status, body: await response.json() };
      },
      async ok(path, method = 'GET', data) { const result = await this.request(path, method, data); assert.ok(result.status < 300, `${path}: ${JSON.stringify(result)}`); return result.body; },
    };
  }
  async function guest(name, trackId = 'python') {
    const person = client(); await person.ok('/api/session', 'POST', {});
    await person.ok('/api/profile', 'PUT', { name, trackId, level: 'beginner', timezone: 'America/New_York', availability: slots.map(slot => ({ ...slot, end: '22:00' })) });
    return person;
  }
  async function team(trackId = 'python') {
    const people = await Promise.all(['Owner', 'Second learner', 'Third learner'].map(name => guest(name, trackId)));
    const id = (await people[0].ok('/api/squads', 'POST', { slots })).squadId;
    for (const person of people.slice(1)) await person.ok(`/api/squads/${id}/join`, 'POST', {});
    return { people, id };
  }
  return { client, guest, team, db: app.db, setTime: value => { time = new Date(value); } };
}
const view = (person, id) => person.ok(`/api/squads/${id}`);
const lesson = (detail, taskId) => detail.plan.weeks.flatMap(week => week.tasks).find(task => task.id === taskId);
const save = (person, id, taskId, status = 'done', note = '') => person.request(`/api/squads/${id}/progress/${taskId}`, 'PUT', { status, note, url: '' });
async function done(person, id, taskId) { const result = await save(person, id, taskId); assert.equal(result.status, 200, JSON.stringify(result)); }
function lockedMaterial(task) {
  assert.equal(task.access.unlocked, false);
  assert.deepEqual(Object.keys(task).sort(), ['access', 'id', 'title', 'week']);
}

test('public and authenticated bootstrap provide only previews, with no lesson materials through alternate preview APIs', async t => {
  const f = await fixture(t), anonymous = f.client();
  const first = await anonymous.ok('/api/bootstrap');
  for (const course of [...first.tracks, ...first.archivedTracks]) {
    for (const week of course.weeks) assert.deepEqual(Object.keys(week).sort(), ['lessonCount', 'title', 'week']);
  }
  const owner = await f.guest('Private learner');
  const authenticated = await owner.ok('/api/bootstrap');
  assert.deepEqual(authenticated.tracks, first.tracks);
  const preview = await owner.ok('/api/squads/preview', 'POST', { slots });
  const knownMaterial = trackById('python').weeks[3].tasks[1].description;
  assert.ok(!JSON.stringify(first).includes(knownMaterial));
  assert.ok(!JSON.stringify(authenticated).includes(knownMaterial));
  assert.ok(!JSON.stringify(preview).includes(knownMaterial));
});

test('week one preparation opens immediately but sequential skips are blocked in content and write API', async t => {
  const f = await fixture(t), { people: [a, b], id } = await f.team();
  const before = await view(a, id);
  assert.ok(Date.parse(before.meetings[0].startsAt) > Date.parse(initialTime));
  assert.equal(lesson(before, 'week-1-task-1').access.unlocked, true);
  assert.ok(lesson(before, 'week-1-task-1').lesson.sections.length);
  assert.equal(before.plan.weeks[0].access.releaseAt, initialTime);
  assert.ok(before.plan.weeks[0].preparation);
  lockedMaterial(lesson(before, 'week-1-task-2'));
  assert.equal(lesson(before, 'week-1-task-2').access.reason, 'previous_lesson_incomplete');
  assert.equal(before.plan.weeks[1].preparation, undefined);
  for (const taskId of ['week-1-task-2', 'week-2-task-1', 'week-4-task-2']) {
    const attempted = await save(a, id, taskId, 'done', 'Skipping through a handcrafted API request');
    assert.equal(attempted.status, 409);
    assert.equal(attempted.body.code, 'lesson_locked');
  }
  assert.equal((await view(a, id)).learningProgress.done, 0);
  await done(a, id, 'week-1-task-1');
  const after = await view(a, id);
  assert.equal(lesson(after, 'week-1-task-2').access.unlocked, true);
  assert.equal(after.learningProgress.nextAvailableTaskId, 'week-1-task-2');
  assert.equal(after.learningProgress.done, 1);
  lockedMaterial(lesson(await view(b, id), 'week-1-task-2'));
});

test('existing matching task content gains lessons in the view without rewriting saved plans or reusing old task identities', async t => {
  const f = await fixture(t), { people: [a], id } = await f.team();
  const expectedLesson = basePlan('python', 'beginner').weeks[0].tasks[0].lesson;
  assert.ok(expectedLesson?.exercise?.sampleAnswer);
  const saved = basePlan('python', 'beginner');
  for (const week of saved.weeks) for (const task of week.tasks) delete task.lesson;
  const encoded = JSON.stringify(saved);
  f.db.prepare('UPDATE sprints SET plan=? WHERE squad_id=?').run(encoded, id);
  const enriched = await view(a, id);
  assert.deepEqual(lesson(enriched, 'week-1-task-1').lesson, expectedLesson);
  lockedMaterial(lesson(enriched, 'week-1-task-2'));
  assert.equal(f.db.prepare('SELECT plan FROM sprints WHERE squad_id=?').get(id).plan, encoded);

  saved.weeks[0].tasks[0].description = 'A previous curriculum with a different project and the same task id.';
  const oldEncoded = JSON.stringify(saved);
  f.db.prepare('UPDATE sprints SET plan=? WHERE squad_id=?').run(oldEncoded, id);
  const old = await view(a, id);
  assert.equal(lesson(old, 'week-1-task-1').lesson, undefined);
  assert.equal(lesson(old, 'week-1-task-1').description, saved.weeks[0].tasks[0].description);
  assert.equal(f.db.prepare('SELECT plan FROM sprints WHERE squad_id=?').get(id).plan, oldEncoded);
});

test('scheduled release uses exact meeting instants across DST and still requires previous weeks completed', async t => {
  const f = await fixture(t), { people: [a, b], id } = await f.team();
  await done(a, id, 'week-1-task-1'); await done(a, id, 'week-1-task-2');
  const initial = await view(a, id);
  const week2 = initial.meetings.find(meeting => meeting.week === 2).startsAt;
  const week3 = initial.meetings.find(meeting => meeting.week === 3).startsAt;
  assert.equal(new Date(week2).toISOString(), '2027-03-10T00:00:00.000Z');
  assert.equal(new Date(week3).toISOString(), '2027-03-16T23:00:00.000Z');
  f.setTime(Date.parse(week2) - 1);
  assert.equal(lesson(await view(a, id), 'week-2-task-1').access.reason, 'week_not_released');
  assert.equal((await save(a, id, 'week-2-task-1')).status, 409);
  f.setTime(week2);
  assert.equal(lesson(await view(a, id), 'week-2-task-1').access.unlocked, true);
  const bLocked = lesson(await view(b, id), 'week-2-task-1');
  assert.equal(bLocked.access.reason, 'previous_lesson_incomplete');
  assert.equal(bLocked.access.previousTaskId, 'week-1-task-1');
  await done(a, id, 'week-2-task-1'); await done(a, id, 'week-2-task-2');
  f.setTime(Date.parse(week3) - 1); lockedMaterial(lesson(await view(a, id), 'week-3-task-1'));
  f.setTime(week3); assert.equal(lesson(await view(a, id), 'week-3-task-1').access.unlocked, true);
  // A missed first lesson remains available after later weeks have opened.
  assert.equal(lesson(await view(b, id), 'week-1-task-1').access.unlocked, true);
  assert.equal((await save(b, id, 'week-3-task-1')).status, 409);
});

test('reopening a predecessor preserves already earned lesson results while blocking untouched later lessons', async t => {
  const f = await fixture(t), { people: [a], id } = await f.team();
  await done(a, id, 'week-1-task-1'); await done(a, id, 'week-1-task-2');
  assert.equal((await save(a, id, 'week-1-task-1', 'not_started')).status, 200);
  assert.equal((await save(a, id, 'week-1-task-2', 'done', 'Keep my earned result')).status, 200);
  let detail = await view(a, id);
  assert.equal(lesson(detail, 'week-1-task-2').access.unlocked, true);
  assert.equal(detail.progress.find(result => result.taskId === 'week-1-task-2').note, 'Keep my earned result');
  f.setTime(detail.meetings.find(meeting => meeting.week === 2).startsAt);
  detail = await view(a, id);
  assert.equal(lesson(detail, 'week-2-task-1').access.reason, 'previous_lesson_incomplete');
  assert.equal((await save(a, id, 'week-2-task-1')).status, 409);
  await done(a, id, 'week-1-task-1');
  assert.equal(lesson(await view(a, id), 'week-2-task-1').access.unlocked, true);
});

test('leaving or closing a squad cannot unlock future material, while saved work stays readable', async t => {
  const f = await fixture(t), { people, id } = await f.team();
  const a = people[0]; await done(a, id, 'week-1-task-1');
  for (const person of people) await person.ok(`/api/squads/${id}/leave`, 'POST', {});
  const history = await view(a, id);
  assert.equal(history.squad.status, 'closed');
  assert.equal(history.canEdit, false);
  assert.equal(lesson(history, 'week-1-task-1').access.unlocked, true);
  assert.equal(lesson(history, 'week-1-task-1').access.canEdit, false);
  lockedMaterial(lesson(history, 'week-2-task-1'));
  assert.equal((await save(a, id, 'week-1-task-1')).status, 403);
});

test('legacy saved future work is preserved and teammates cannot use shared results to bypass their locks', async t => {
  const f = await fixture(t), { people: [a, b], id } = await f.team();
  const userId = (await a.ok('/api/bootstrap')).user.id;
  const sprint = f.db.prepare('SELECT * FROM sprints WHERE squad_id=?').get(id);
  const savedPlan = sprint.plan;
  f.db.prepare('INSERT INTO progress VALUES (?,?,?,?,?,?)').run(sprint.id, userId, 'week-4-task-2', 'done', 'Private future solution from before the release policy', 'https://example.com/saved-future-result');
  const own = await view(a, id);
  assert.equal(lesson(own, 'week-4-task-2').access.unlocked, true);
  assert.equal(own.progress.find(result => result.taskId === 'week-4-task-2').status, 'done');
  const teammate = await view(b, id);
  const shared = teammate.teamProgress.find(member => member.userId === userId);
  assert.equal(shared.done, 1);
  const lockedResult = shared.results.find(result => result.taskId === 'week-4-task-2');
  assert.equal(lockedResult.locked, true); assert.equal(lockedResult.note, ''); assert.equal(lockedResult.url, '');
  assert.ok(!JSON.stringify(teammate).includes('Private future solution'));
  assert.equal(f.db.prepare('SELECT plan FROM sprints WHERE squad_id=?').get(id).plan, savedPlan);
});

test('completed legacy sprint remains readable without changing its stored plan or allowing writes', async t => {
  const f = await fixture(t), { people: [a], id } = await f.team();
  const legacy = basePlan('ai', 'basics'); delete legacy.level;
  const encoded = JSON.stringify(legacy);
  f.db.prepare("UPDATE squads SET track_id='ai',level='basics' WHERE id=?").run(id);
  f.db.prepare('UPDATE sprints SET plan=? WHERE squad_id=?').run(encoded, id);
  const initial = await view(a, id);
  lockedMaterial(lesson(initial, 'week-4-task-2'));
  f.setTime(Date.parse(initial.squad.endDate) + 1);
  const complete = await view(a, id);
  assert.equal(complete.squad.status, 'completed');
  for (const week of complete.plan.weeks) for (const task of week.tasks) {
    assert.equal(task.access.unlocked, true); assert.equal(task.access.canEdit, false);
    assert.ok(task.description); assert.equal(task.lesson, undefined);
  }
  assert.equal((await save(a, id, 'week-4-task-2')).status, 403);
  assert.equal(f.db.prepare('SELECT plan FROM sprints WHERE squad_id=?').get(id).plan, encoded);
});
