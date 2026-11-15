import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../server/app.js';
import { courseQuizzes, courseAssignments } from '../server/assessments.js';
import { passQuiz, submitAssignment } from './assessment-helpers.js';

const slots = [{ day: 2, start: '19:00' }, { day: 4, start: '19:00' }];
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'squads-assessments-'));
  const dbPath = join(directory, 'test.sqlite');
  let app, base, time = new Date('2026-11-15T12:00:00Z');
  async function start() { app = createApp({ dbPath, now: () => new Date(time), aiAdapter: null, googleMeetConfig: null, meetAdapter: null }); app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening'); base = `http://127.0.0.1:${app.server.address().port}`; }
  async function stop() { app.server.closeAllConnections(); await app.close(); }
  await start(); t.after(async () => { await stop(); await rm(directory, { recursive: true, force: true }); });
  function client() {
    let cookie = '';
    return {
      async request(path, method = 'GET', body) {
        const response = await fetch(base + path, { method, headers: { origin: base, ...(cookie ? { cookie } : {}), ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
        if (response.headers.getSetCookie().length) cookie = response.headers.getSetCookie()[0].split(';')[0];
        return { status: response.status, body: await response.json() };
      },
      async ok(...args) { const response = await this.request(...args); assert.ok(response.status < 300, JSON.stringify(response)); return response.body; },
    };
  }
  async function guest(name, trackId = 'python') {
    const person = client(); await person.ok('/api/session', 'POST', {});
    await person.ok('/api/profile', 'PUT', { name, trackId, level: 'beginner', timezone: 'UTC', availability: slots.map(slot => ({ ...slot, end: '22:00' })) }); return person;
  }
  async function team(track = 'python') {
    const people = await Promise.all(['First', 'Second', 'Third'].map(name => guest(name, track)));
    const id = (await people[0].ok('/api/squads', 'POST', { slots })).squadId;
    for (const person of people.slice(1)) await person.ok(`/api/squads/${id}/join`, 'POST', {});
    return { people, id };
  }
  return { team, guest, client, db: () => app.db, setTime: value => { time = new Date(value); }, restart: async seed => { await stop(); if (seed) { const db = new DatabaseSync(dbPath); try { seed(db); } finally { db.close(); } } await start(); } };
}
const view = (person, id) => person.ok(`/api/squads/${id}`);
const task = (detail, id) => detail.plan.weeks.flatMap(week => week.tasks).find(item => item.id === id);
const firstTask = 'week-1-task-1';
const quizPath = id => `/api/squads/${id}/quizzes/${firstTask}`;
const correct = (trackId = 'python', id = firstTask) => Object.fromEntries(courseQuizzes[trackId][id].questions.map(q => [q.id, q.correctOptionId]));
const incorrect = () => Object.fromEntries(courseQuizzes.python[firstTask].questions.map(q => [q.id, q.options.find(option => option.id !== q.correctOptionId).id]));
const submission = { status: 'submitted', text: 'My original practice work and recorded results: the script handles both accepted names and blank input.', url: '', checkedCriteria: ['c1', 'c2', 'c3'] };

test('all three courses can complete 24 real quizzes and 12 weekly assignments in calendar order', async t => {
  const f = await fixture(t);
  for (const trackId of ['python', 'ai-literacy', 'spanish']) {
    f.setTime('2026-11-15T12:00:00Z');
    const { people: [person], id } = await f.team(trackId);
    const initial = await view(person, id);
    for (let week = 1; week <= 4; week++) {
      if (week > 1) f.setTime(initial.meetings.find(meeting => meeting.week === week).startsAt);
      for (let lesson = 1; lesson <= 2; lesson++) {
        const taskId = `week-${week}-task-${lesson}`;
        const result = await passQuiz(person, id, taskId, trackId);
        assert.equal(result.score, 3); assert.equal(result.passed, true);
        assert.equal(result.feedback.length, 3);
      }
      const detail = await view(person, id), assignment = detail.plan.weeks[week - 1].assignment;
      assert.equal(assignment.access.unlocked, true);
      assert.equal(assignment.title, courseAssignments[trackId][week - 1].title);
      assert.equal(assignment.deliverables.length, 3);
      await submitAssignment(person, id, week);
    }
    const finished = await view(person, id);
    assert.equal(finished.learningProgress.done, 8);
    assert.equal(finished.learningProgress.assignmentsDone, 4);
    assert.equal(finished.learningProgress.nextTaskId, null);
    assert.equal(finished.learningProgress.nextAssignmentWeek, null);
  }
});

test('quizzes withhold answer keys, grade on the server, preserve failed attempts and allow a successful retry', async t => {
  const f = await fixture(t), { people: [a, b], id } = await f.team();
  const before = await view(a, id);
  assert.ok(!JSON.stringify(before).includes('correctOptionId'));
  assert.equal(task(before, firstTask).quiz.questions.length, 3);
  assert.equal(task(before, 'week-1-task-2').quiz, undefined);
  assert.equal(before.plan.weeks[0].assignment.prompt, undefined);
  const bypass = await a.request(`/api/squads/${id}/progress/${firstTask}`, 'PUT', { status: 'done', note: '', url: '' });
  assert.equal(bypass.status, 409); assert.equal(bypass.body.code, 'quiz_required');
  for (const answers of [{}, { ...correct(), q4: '0' }, { ...correct(), q1: 'not-an-option' }, [], { ...correct(), q1: 0 }]) assert.equal((await a.request(quizPath(id), 'POST', { answers })).status, 400);
  const failed = await a.ok(quizPath(id), 'POST', { answers: incorrect(), passed: true, score: 3, userId: (await b.ok('/api/bootstrap')).user.id });
  assert.equal(failed.score, 0); assert.equal(failed.passed, false); assert.equal(failed.attempts, 1);
  assert.ok(failed.feedback.every(item => item.explanation && !item.correct));
  await f.restart();
  const restored = await view(a, id);
  assert.deepEqual(task(restored, firstTask).quiz.result.answers, incorrect());
  assert.equal(task(restored, 'week-1-task-2').access.unlocked, false);
  assert.equal(task(await view(b, id), firstTask).quiz.result, null);
  await a.ok(`/api/squads/${id}/progress/${firstTask}`, 'PUT', { status: 'in_progress', note: 'Keep this practice note', url: '' });
  const passed = await passQuiz(a, id, firstTask);
  assert.equal(passed.attempts, 2);
  const after = await view(a, id);
  assert.equal(after.progress[0].status, 'done'); assert.equal(after.progress[0].note, 'Keep this practice note');
  assert.equal(task(after, 'week-1-task-2').access.unlocked, true);
  assert.equal(task(await view(b, id), 'week-1-task-2').access.unlocked, false);
  const duplicate = await a.ok(quizPath(id), 'POST', { answers: incorrect() });
  assert.equal(duplicate.passed, true); assert.equal(duplicate.attempts, 2);
});

test('a weekly draft is private, submission needs the full checklist, and the next week also waits for its date', async t => {
  const f = await fixture(t), { people: [a, b], id } = await f.team();
  const path = `/api/squads/${id}/assignments/1`;
  assert.equal((await a.request(path, 'PUT', submission)).status, 409);
  await passQuiz(a, id, firstTask); await passQuiz(a, id, 'week-1-task-2');
  assert.equal((await view(a, id)).learningProgress.nextAssignmentWeek, 1);
  await a.ok(path, 'PUT', { ...submission, status: 'draft', checkedCriteria: [] });
  await f.restart();
  assert.equal((await view(a, id)).plan.weeks[0].assignment.result.status, 'draft');
  assert.ok(!JSON.stringify(await view(b, id)).includes(submission.text));
  for (const body of [{ ...submission, text: 'Too short' }, { ...submission, checkedCriteria: ['c1'] }, { ...submission, checkedCriteria: ['c1', 'c1', 'c2'] }, { ...submission, url: 'javascript:alert(1)' }]) assert.equal((await a.request(path, 'PUT', body)).status, 400);
  const release = (await view(a, id)).meetings.find(meeting => meeting.week === 2).startsAt;
  f.setTime(release);
  assert.equal(task(await view(a, id), 'week-2-task-1').access.reason, 'previous_assignment_incomplete');
  assert.equal((await a.request(`/api/squads/${id}/quizzes/week-2-task-1`, 'POST', { answers: correct('python', 'week-2-task-1') })).status, 409);
  f.setTime('2026-11-15T12:00:00Z');
  await a.ok(path, 'PUT', submission);
  assert.equal(task(await view(a, id), 'week-2-task-1').access.reason, 'week_not_released');
  f.setTime(release);
  assert.equal(task(await view(a, id), 'week-2-task-1').access.unlocked, true);
  const bView = await view(b, id), shared = bView.teamProgress.find(member => member.assignments.length);
  assert.equal(shared.assignments[0].locked, true); assert.equal(shared.assignments[0].text, undefined);
  await passQuiz(b, id, firstTask); await passQuiz(b, id, 'week-1-task-2');
  assert.equal((await view(b, id)).teamProgress.find(member => member.assignments.length).assignments[0].text, submission.text);
  assert.equal(task(await view(b, id), 'week-2-task-1').access.unlocked, false);
  assert.equal((await a.request(path, 'PUT', { ...submission, status: 'draft' })).status, 409);
  await a.ok(path, 'PUT', { ...submission, text: submission.text + ' Updated after the squad discussion.' });
});

test('outside, departed and completed members cannot submit quizzes or weekly work', async t => {
  const f = await fixture(t), { people: [a], id } = await f.team(), outsider = await f.guest('Outside');
  assert.equal((await f.client().request(quizPath(id), 'POST', { answers: correct() })).status, 401);
  assert.equal((await outsider.request(quizPath(id), 'POST', { answers: correct() })).status, 403);
  assert.equal((await outsider.request(`/api/squads/${id}/assignments/1`, 'PUT', submission)).status, 403);
  await passQuiz(a, id, firstTask); await passQuiz(a, id, 'week-1-task-2'); await a.ok(`/api/squads/${id}/assignments/1`, 'PUT', submission);
  await a.ok(`/api/squads/${id}/leave`, 'POST', {});
  assert.equal((await a.request(quizPath(id), 'POST', { answers: correct() })).status, 403);
  assert.equal((await a.request(`/api/squads/${id}/assignments/1`, 'PUT', submission)).status, 403);
  assert.equal((await view(a, id)).plan.weeks[0].assignment.result.text, submission.text);
  const finishedTeam = await f.team('spanish');
  const finishedLearner = finishedTeam.people[0];
  const finishedView = await view(finishedLearner, finishedTeam.id);
  f.setTime(Date.parse(finishedView.squad.endDate) + 1);
  assert.equal((await view(finishedLearner, finishedTeam.id)).squad.status, 'completed');
  assert.equal((await finishedLearner.request(quizPath(finishedTeam.id), 'POST', { answers: correct('spanish') })).status, 403);
  assert.equal((await finishedLearner.request(`/api/squads/${finishedTeam.id}/assignments/1`, 'PUT', submission)).status, 403);
});

test('migration credits prior completed lessons and weeks once without inventing quiz scores or rewriting plans', async t => {
  const f = await fixture(t), { people: [a, b], id } = await f.team();
  const aid = (await a.ok('/api/bootstrap')).user.id, bid = (await b.ok('/api/bootstrap')).user.id;
  const original = f.db().prepare('SELECT id,plan FROM sprints WHERE squad_id=?').get(id);
  await f.restart(db => {
    db.prepare("DELETE FROM schema_migrations WHERE id='required-assessments-v1'").run();
    for (const taskId of [firstTask, 'week-1-task-2']) db.prepare("INSERT INTO progress(sprint_id,user_id,task_id,status,note) VALUES (?,?,?,'done','Existing result')").run(original.id, aid, taskId);
  });
  const credited = await view(a, id);
  assert.equal(credited.progress[0].note, 'Existing result');
  assert.equal(task(credited, firstTask).quiz.credited, true);
  assert.equal(task(credited, firstTask).quiz.result, null);
  assert.equal(credited.plan.weeks[0].assignment.credited, true);
  assert.equal(f.db().prepare('SELECT plan FROM sprints WHERE squad_id=?').get(id).plan, original.plan);
  await f.restart(db => { db.prepare("INSERT INTO progress(sprint_id,user_id,task_id,status) VALUES (?,?,?,'done')").run(original.id, bid, firstTask); });
  const uncredited = await view(b, id);
  assert.equal(task(uncredited, firstTask).quiz.credited, false);
  assert.equal(task(uncredited, 'week-1-task-2').access.unlocked, false);
  assert.equal(uncredited.learningProgress.done, 0);
});

test('concurrent correct quiz submissions are idempotent and quiz work freezes AI adaptation', async t => {
  const f = await fixture(t), { people: [a], id } = await f.team();
  const attempts = await Promise.all([a.ok(quizPath(id), 'POST', { answers: correct() }), a.ok(quizPath(id), 'POST', { answers: correct() })]);
  assert.ok(attempts.every(result => result.passed && result.attempts === 1));
  assert.equal((await view(a, id)).learningProgress.done, 1);
  const frozen = await a.request(`/api/squads/${id}/adapt`, 'POST', {});
  assert.equal(frozen.status, 409); assert.equal(frozen.body.code, 'plan_locked');
});
