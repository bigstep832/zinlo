import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../server/app.js';
import { basePlan, trackById } from '../server/curricula.js';

const slots = [{ day: 2, start: '19:00' }, { day: 4, start: '19:00' }];
const profile = (name, trackId = 'python', level = 'beginner') => ({ name, trackId, level, timezone: 'UTC', availability: slots.map(slot => ({ ...slot, end: '22:00' })) });
async function fixture(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'learning-squads-catalog-'));
  const dbPath = join(directory, 'test.sqlite');
  let app, base;
  async function start() {
    app = createApp({ dbPath, now: () => new Date('2026-11-15T12:00:00Z'), aiAdapter: options.aiAdapter ?? null, meetAdapter: null, googleMeetConfig: null });
    app.server.listen(0, '127.0.0.1');
    await once(app.server, 'listening');
    base = `http://127.0.0.1:${app.server.address().port}`;
  }
  async function stop() { if (app) { app.server.closeAllConnections(); await app.close(); app = null; } }
  await start();
  t.after(async () => { await stop(); await rm(directory, { recursive: true, force: true }); });
  function client() {
    let cookie = '';
    return {
      async request(path, method = 'GET', data) {
        const response = await fetch(base + path, { method, headers: { origin: base, ...(cookie ? { cookie } : {}), ...(data === undefined ? {} : { 'content-type': 'application/json' }) }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
        if (response.headers.getSetCookie().length) cookie = response.headers.getSetCookie()[0].split(';')[0];
        return { status: response.status, body: await response.json() };
      },
      async ok(path, method = 'GET', data) {
        const result = await this.request(path, method, data);
        assert.ok(result.status < 300, `${path}: ${JSON.stringify(result)}`);
        return result.body;
      },
    };
  }
  async function guest(name, trackId = 'python', level = 'beginner') {
    const person = client();
    await person.ok('/api/session', 'POST', {});
    await person.ok('/api/profile', 'PUT', profile(name, trackId, level));
    return person;
  }
  return { client, guest, db: () => app.db, restart: async (seed = () => {}) => { await stop(); const db = new DatabaseSync(dbPath); try { seed(db); } finally { db.close(); } await start(); } };
}
const dashboard = (person, id) => person.ok(`/api/squads/${id}`);
const createSquad = async person => (await person.ok('/api/squads', 'POST', { slots })).squadId;

test('new learners receive three active course previews and separate archive metadata without full materials', async t => {
  const f = await fixture(t), guest = f.client();
  const boot = await guest.ok('/api/bootstrap');
  assert.deepEqual(boot.tracks.map(track => track.id), ['python', 'ai-literacy', 'spanish']);
  assert.deepEqual(boot.archivedTracks.map(track => track.id), ['ai']);
  assert.ok(!JSON.stringify(boot).toLowerCase().includes('javascript'));
  assert.equal(boot.archivedTracks.find(track => track.id === 'ai').title, 'AI Apps with Python');
  for (const course of boot.tracks) {
    assert.deepEqual(course.levels.map(level => level.id), ['beginner', 'basics']);
    assert.equal(course.weeks.length, 4);
    assert.equal(course.weeks.reduce((sum, week) => sum + week.lessonCount, 0), 8);
    assert.ok(course.weeks.every(week => !week.tasks && !week.preparation));
    for (const week of trackById(course.id).weeks) for (const task of week.tasks) {
      assert.ok(task.steps?.length && task.practice?.length, `${course.id} ${task.id} needs actionable guidance and practice`);
      for (const field of ['title', 'description', 'criteria', 'example', 'extension']) assert.ok(typeof task[field] === 'string' && task[field].trim(), `${course.id} ${task.id} ${field}`);
    }
    for (const week of basePlan(course.id, 'beginner').weeks) for (const task of week.tasks) {
      assert.ok(task.lesson?.objectives.length && task.lesson.sections.length, `${course.id} ${task.id} needs its own lesson material`);
      assert.ok(task.lesson.sections.every(section => section.title && section.paragraphs.length));
      assert.ok(task.lesson.exercise.prompt && task.lesson.exercise.checklist.length && task.lesson.exercise.sampleAnswer);
      assert.ok(task.lesson.checks.length && task.lesson.checks.every(check => check.question && check.answer && check.explanation));
      assert.ok(task.lesson.recap.length);
    }
  }
  await guest.ok('/api/session', 'POST', {});
  for (const retired of ['javascript', 'ai']) {
    const response = await guest.request('/api/profile', 'PUT', profile('New learner', retired, 'basics'));
    assert.equal(response.status, 400);
    assert.equal(response.body.code, 'track_archived');
  }
  await guest.ok('/api/profile', 'PUT', profile('Non-coder', 'ai-literacy'));
  assert.equal((await guest.ok('/api/bootstrap')).user.level, 'beginner');
});

test('automatic matching isolates all three active courses and saves their own detailed curriculum', async t => {
  const f = await fixture(t);
  const groups = new Map();
  for (const trackId of ['python', 'ai-literacy', 'spanish']) {
    const people = [await f.guest(`${trackId} A`, trackId), await f.guest(`${trackId} B`, trackId)];
    for (const person of people) assert.equal((await person.ok('/api/matchmaking', 'POST', {})).status, 'waiting');
    groups.set(trackId, people);
  }
  const squadIds = new Set();
  for (const [trackId, people] of groups) {
    const third = await f.guest(`${trackId} C`, trackId);
    const matched = await third.ok('/api/matchmaking', 'POST', {});
    assert.equal(matched.status, 'matched');
    assert.equal(matched.squad.trackId, trackId);
    assert.equal(matched.squad.memberCount, 3);
    squadIds.add(matched.squadId);
    for (const person of [...people, third]) {
      const detail = await dashboard(person, matched.squadId);
      const stored = JSON.parse(f.db().prepare('SELECT plan FROM sprints WHERE squad_id=?').get(matched.squadId).plan);
      assert.deepEqual(stored.weeks, basePlan(trackId, 'beginner').weeks);
      assert.equal(detail.plan.weeks[0].tasks[0].description, trackById(trackId).weeks[0].tasks[0].description);
      assert.ok(detail.plan.weeks[1].tasks.every(task => task.access.unlocked === false && !task.description));
      assert.deepEqual(detail.meetings.map(meeting => meeting.topic), detail.plan.weeks.flatMap(week => week.tasks.map(task => task.title)));
    }
  }
  assert.equal(squadIds.size, 3);
});

test('existing archived AI squad keeps its original plan, work, meeting link and profile editing across catalog migration', async t => {
  const f = await fixture(t);
  const people = await Promise.all(['Legacy A', 'Legacy B', 'Legacy C'].map(name => f.guest(name)));
  const id = await createSquad(people[0]);
  for (const person of people.slice(1)) await person.ok(`/api/squads/${id}/join`, 'POST', {});
  const before = await dashboard(people[0], id), meetingId = before.meetings[0].id;
  const oldPlan = basePlan('ai', 'basics'); delete oldPlan.level;
  oldPlan.weeks[0].preparation = 'Original saved AI instructions; never replace these.';
  const taskId = oldPlan.weeks[0].tasks[0].id;
  await people[0].ok(`/api/squads/${id}/progress/${taskId}`, 'PUT', { status: 'done', note: 'My existing task planner result', url: 'https://example.com/old-planner' });
  await people[0].ok(`/api/squads/${id}/meetings/${meetingId}`, 'PUT', { url: 'https://meet.google.com/abc-defg-hij' });
  for (const person of people) await person.ok(`/api/squads/${id}/meetings/${meetingId}/readiness`, 'PUT', { ready: true });
  const userIds = await Promise.all(people.map(async person => (await person.ok('/api/bootstrap')).user.id));
  const waiting = await f.guest('Old waiting learner'); await waiting.ok('/api/matchmaking', 'POST', {});
  const waitingId = (await waiting.ok('/api/bootstrap')).user.id;
  await f.restart(db => {
    for (const userId of [...userIds, waitingId]) {
      const stored = JSON.parse(db.prepare('SELECT profile FROM users WHERE id=?').get(userId).profile);
      db.prepare('UPDATE users SET profile=? WHERE id=?').run(JSON.stringify({ ...stored, trackId: 'ai', level: 'basics' }), userId);
    }
    db.prepare("UPDATE squads SET track_id='ai',level='basics',name='AI Apps with Python #001' WHERE id=?").run(id);
    db.prepare('UPDATE sprints SET plan=? WHERE squad_id=?').run(JSON.stringify(oldPlan), id);
    oldPlan.weeks.flatMap(week => week.tasks).forEach((task, index) => db.prepare('UPDATE meetings SET topic=? WHERE id=?').run(task.title, before.meetings[index].id));
    db.prepare("INSERT INTO matchmaking_queue VALUES (?,'matched','2026-11-15T12:00:00Z','2026-11-16T12:00:00Z')").run(userIds[0]);
  });
  const migrated = await dashboard(people[0], id);
  assert.equal(migrated.squad.name, 'AI Apps with Python #001');
  assert.equal(migrated.squad.trackId, 'ai');
  assert.deepEqual(JSON.parse(f.db().prepare('SELECT plan FROM sprints WHERE squad_id=?').get(id).plan), oldPlan);
  assert.equal(migrated.plan.weeks[0].tasks[0].description, oldPlan.weeks[0].tasks[0].description);
  assert.deepEqual(migrated.meetings.map(meeting => meeting.startsAt), before.meetings.map(meeting => meeting.startsAt));
  assert.equal(migrated.meetings[0].meetUrl, 'https://meet.google.com/abc-defg-hij');
  assert.equal(migrated.progress.find(task => task.taskId === taskId).note, 'My existing task planner result');
  assert.equal((await people[0].ok('/api/matchmaking', 'POST', {})).squadId, id);
  await people[0].ok(`/api/squads/${id}/join`, 'POST', {});
  await people[0].ok('/api/profile', 'PUT', profile('Renamed legacy learner', 'ai', 'basics'));
  assert.equal((await people[0].ok('/api/bootstrap')).user.name, 'Renamed legacy learner');
  assert.equal((await waiting.ok('/api/matchmaking')).status, 'expired');
  assert.equal(f.db().prepare('SELECT state FROM matchmaking_queue WHERE user_id=?').get(waitingId).state, 'expired');
  // Profile saving clears its own queue by design; verify another saved matched
  // state survives a restart independently of the archived waiting cleanup.
  f.db().prepare("INSERT INTO matchmaking_queue VALUES (?,'matched','2026-11-15T12:00:00Z','2026-11-16T12:00:00Z')").run(userIds[1]);
  await f.restart();
  assert.equal(f.db().prepare('SELECT state FROM matchmaking_queue WHERE user_id=?').get(userIds[1]).state, 'matched');
  for (const [path, data] of [['/api/matchmaking', {}], ['/api/matchmaking/poll', {}], ['/api/squads', { slots }], ['/api/squads/preview', { slots }], [`/api/squads/${id}/join`, {}]]) {
    const denied = await waiting.request(path, 'POST', data);
    assert.equal(denied.status, 409, path);
    assert.equal(denied.body.code, 'track_archived', path);
  }
  await people[0].ok(`/api/squads/${id}/leave`, 'POST', {});
  assert.equal((await dashboard(people[0], id)).plan.weeks[0].tasks[0].description, oldPlan.weeks[0].tasks[0].description);
  assert.deepEqual(JSON.parse(f.db().prepare('SELECT plan FROM sprints WHERE squad_id=?').get(id).plan), oldPlan);
  await people[0].ok('/api/profile', 'PUT', profile('Next subject', 'spanish'));
  assert.equal((await people[0].ok('/api/matchmaking', 'POST', {})).status, 'waiting');
});

test('removed JavaScript releases old members, hides history and preserves their identity and stored work', async t => {
  const f = await fixture(t);
  const people = await Promise.all(['Removed A', 'Removed B', 'Removed C'].map(name => f.guest(name)));
  const id = await createSquad(people[0]);
  for (const person of people.slice(1)) await person.ok(`/api/squads/${id}/join`, 'POST', {});
  const before = await dashboard(people[0], id), meetingId = before.meetings[0].id;
  await people[0].ok(`/api/squads/${id}/progress/week-1-task-1`, 'PUT', { status: 'done', note: 'Saved original work', url: '' });
  await people[0].ok(`/api/squads/${id}/meetings/${meetingId}`, 'PUT', { url: 'https://meet.google.com/abc-defg-hij' });
  const waiting = await f.guest('Removed waiting learner');
  await waiting.ok('/api/matchmaking', 'POST', {});
  const oldProfiles = await Promise.all([...people, waiting].map(async person => (await person.ok('/api/bootstrap')).user));
  const other = await f.guest('Unaffected Python learner'), otherId = await createSquad(other);
  const oldPlan = JSON.stringify(basePlan('javascript', 'beginner'));
  await f.restart(db => {
    for (const person of oldProfiles) {
      const saved = JSON.parse(db.prepare('SELECT profile FROM users WHERE id=?').get(person.id).profile);
      db.prepare('UPDATE users SET profile=? WHERE id=?').run(JSON.stringify({ ...saved, trackId: 'javascript', level: 'basics' }), person.id);
    }
    db.prepare("UPDATE squads SET track_id='javascript' WHERE id=?").run(id);
    db.prepare('UPDATE sprints SET plan=? WHERE squad_id=?').run(oldPlan, id);
  });
  for (const [index, person] of [...people, waiting].entries()) {
    const boot = await person.ok('/api/bootstrap');
    assert.equal(boot.currentSquadId, null);
    assert.deepEqual(boot.history, []);
    assert.equal(boot.matchmaking.status, 'idle');
    assert.equal(boot.user.trackId, undefined);
    for (const key of ['id', 'name', 'timezone', 'availability']) assert.deepEqual(boot.user[key], oldProfiles[index][key]);
    assert.ok(!JSON.stringify(boot).toLowerCase().includes('javascript'));
  }
  for (const [path, method, body] of [[`/api/squads/${id}`, 'GET'], [`/api/squads/${id}/progress/week-1-task-1`, 'PUT', { status: 'done', note: '', url: '' }]]) {
    const denied = await people[0].request(path, method, body);
    assert.equal(denied.status, 410);
    assert.equal(denied.body.code, 'course_removed');
  }
  assert.equal(f.db().prepare('SELECT COUNT(*) AS n FROM memberships WHERE squad_id=? AND active=1').get(id).n, 0);
  assert.equal(f.db().prepare('SELECT status FROM sprints WHERE squad_id=?').get(id).status, 'closed');
  assert.equal(f.db().prepare('SELECT plan FROM sprints WHERE squad_id=?').get(id).plan, oldPlan);
  assert.equal(f.db().prepare('SELECT note FROM progress WHERE user_id=?').get(oldProfiles[0].id).note, 'Saved original work');
  assert.equal(f.db().prepare('SELECT meet_url FROM meetings WHERE id=?').get(meetingId).meet_url, 'https://meet.google.com/abc-defg-hij');
  assert.equal((await other.ok('/api/bootstrap')).currentSquadId, otherId);
  assert.equal((await dashboard(other, otherId)).squad.trackId, 'python');
  await people[0].ok('/api/profile', 'PUT', profile('Continue learning', 'spanish'));
  assert.equal((await people[0].ok('/api/matchmaking', 'POST', {})).status, 'waiting');
  await f.restart();
  const continued = await people[0].ok('/api/bootstrap');
  assert.equal(continued.user.id, oldProfiles[0].id);
  assert.equal(continued.user.trackId, 'spanish');
  assert.equal(continued.matchmaking.status, 'waiting');
});

test('optional AI adaptation preserves detailed teaching material and the selected level', async t => {
  const f = await fixture(t, { aiAdapter: async input => ({ weeks: input.weeks.map(week => ({
    week: week.week, title: `Adapted: ${week.title}`, preparation: week.preparation,
    tasks: week.tasks.map(task => ({ id: task.id, week: task.week, title: task.title, description: task.description, criteria: task.criteria })),
  })) }) });
  const learner = await f.guest('Spanish continuation', 'spanish', 'basics');
  const id = await createSquad(learner);
  const before = await dashboard(learner, id);
  const savedBefore = JSON.parse(f.db().prepare('SELECT plan FROM sprints WHERE squad_id=?').get(id).plan);
  assert.equal(before.plan.level, 'basics');
  await learner.ok(`/api/squads/${id}/adapt`, 'POST', {});
  const after = await dashboard(learner, id);
  const savedAfter = JSON.parse(f.db().prepare('SELECT plan FROM sprints WHERE squad_id=?').get(id).plan);
  assert.equal(after.plan.source, 'ai');
  assert.equal(after.plan.level, 'basics');
  for (let week = 0; week < 4; week++) for (let task = 0; task < 2; task++) {
    for (const field of ['steps', 'practice', 'example', 'extension', 'lesson']) assert.deepEqual(savedAfter.weeks[week].tasks[task][field], savedBefore.weeks[week].tasks[task][field]);
  }
});
