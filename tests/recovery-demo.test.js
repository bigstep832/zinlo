import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createApp } from '../server/app.js';
import { courseQuizzes } from '../server/assessments.js';

const initialTime = '2026-11-15T12:00:00.000Z';
const slots = [{ day: 2, start: '19:00' }, { day: 4, start: '19:00' }];
const meetUrl = 'https://meet.google.com/abc-defg-hij';
const validAdapter = async () => ({ url: meetUrl, spaceName: 'spaces/test-meeting' });

async function fixture(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'learning-squads-collaboration-'));
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
      binary(path, method = 'GET', body, headers = {}) {
        return fetch(base + path, { method, signal: AbortSignal.timeout(8000), headers: { origin: base, ...(cookie ? { cookie } : {}), ...headers }, ...(body === undefined ? {} : { body }) });
      },
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
  return { db: () => app.db, client, guest, setTime: value => { time = new Date(value); }, restart: async () => { await stop(); await start(); } };
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

const choose = (person,id,info,choice) => person.ok(`/api/squads/${id}/recovery`,'POST',{caseId:info.id,choice});
test('demo is private, labelled, idempotent and separate from a real squad and profile', async t=>{
  const f=await fixture(t),{people:[a,b],id}=await team(f),before=await a.ok('/api/bootstrap');
  const demo=await a.ok('/api/demo/start','POST',{}),again=await a.ok('/api/demo/start','POST',{});
  assert.equal(demo.squadId,again.squadId);assert.equal(demo.squad.isDemo,true);assert.equal(demo.squad.members.filter(m=>m.isDemo).length,2);
  const after=await a.ok('/api/bootstrap');assert.equal(after.currentSquadId,id);assert.deepEqual(after.user,before.user);assert.equal(after.history.some(s=>s.isDemo),false);
  denied(await b.request(`/api/squads/${demo.squadId}`));rejected(await b.request(`/api/squads/${demo.squadId}/join`,'POST',{}));
  const messages=await a.ok(`/api/squads/${demo.squadId}/chat`);assert.equal(messages.messages.length,2);assert.ok(messages.messages.every(m=>m.name.includes('(demo)')));
  const body={text:'Hello demo',clientId:'demo-test-message'};await a.ok(`/api/squads/${demo.squadId}/chat`,'POST',body);await a.ok(`/api/squads/${demo.squadId}/chat`,'POST',body);
  assert.equal((await a.ok(`/api/squads/${demo.squadId}/chat`)).messages.length,4);
  await a.ok(`/api/squads/${demo.squadId}/leave`,'POST',{});assert.equal((await a.ok('/api/bootstrap')).currentSquadId,id);
});
test('demo never consumes a real matchmaking queue and video starts on one device',async t=>{
  const f=await fixture(t),a=await f.guest('Judge');await a.ok('/api/matchmaking','POST',{});
  const demo=await a.ok('/api/demo/start','POST',{}),detail=await dashboard(a,demo.squadId);
  assert.equal((await a.ok('/api/matchmaking','POST',{})).status,'waiting');
  const path=`/api/squads/${demo.squadId}/meetings/${detail.meetings[0].id}/video`;
  const session=await a.ok(`${path}/join`,'POST',{});assert.equal(session.relayConfigured,false);
  const room=await a.ok(`${path}/ready`,'POST',{peerId:session.peerId,ready:true,media:{audio:false,video:false}});
  assert.equal(room.started,true);assert.equal(room.isDemo,true);assert.equal(room.participants.filter(p=>p.isDemo&&p.ready).length,2);
  const outsider=await f.guest('Outside');assert.ok(!(await outsider.ok('/api/matches')).squads.some(s=>s.id===demo.squadId));
  assert.equal((await a.request(`/api/squads/${demo.squadId}/meetings/${detail.meetings[0].id}/launch`,'POST',{})).status,409);
});
test('remaining learners must both agree to duo; a later departure opens a new case',async t=>{
  const f=await fixture(t),{people:[a,b,c],id}=await team(f);
  await c.ok(`/api/squads/${id}/leave`,'POST',{});let info=(await dashboard(a,id)).recovery;
  assert.equal(info.canDuo,true);await choose(a,id,info,'duo');assert.equal((await dashboard(b,id)).recovery.state,'open');
  await choose(b,id,info,'duo');assert.equal((await dashboard(a,id)).squad.minimumMembers,2);assert.equal((await dashboard(a,id)).recovery.state,'resolved');
  await b.ok(`/api/squads/${id}/leave`,'POST',{});const next=(await dashboard(a,id)).recovery;
  assert.notEqual(next.id,info.id);assert.equal(next.canDuo,false);rejected(await c.request(`/api/squads/${id}/recovery`,'POST',{caseId:next.id,choice:'refund'}));
});
test('solo recovery preserves quizzes, assignment drafts, notes and exact weekly dates',async t=>{
  const f=await fixture(t),{people:[a,b,c],id}=await team(f);
  for(const taskId of ['week-1-task-1','week-1-task-2']) {
    const answers=Object.fromEntries(courseQuizzes.python[taskId].questions.map(q=>[q.id,q.correctOptionId]));
    await a.ok(`/api/squads/${id}/quizzes/${taskId}`,'POST',{answers});
  }
  await a.ok(`/api/squads/${id}/progress/week-1-task-1`,'PUT',{status:'done',note:'My saved program',url:''});
  await a.ok(`/api/squads/${id}/assignments/1`,'PUT',{status:'draft',text:'My personal assignment draft, kept during the transfer.',url:'',checkedCriteria:[]});
  const before=await dashboard(a,id);await c.ok(`/api/squads/${id}/leave`,'POST',{});
  const info=(await dashboard(a,id)).recovery,created=await choose(a,id,info,'solo'),again=await choose(a,id,info,'solo');
  assert.equal(created.squadId,again.squadId);const target=await dashboard(a,created.squadId);
  assert.equal(target.squad.learningMode,'solo');assert.equal(target.learningProgress.done,2);assert.equal(target.progress.find(p=>p.taskId==='week-1-task-1').note,'My saved program');
  assert.deepEqual(target.plan.weeks.map(w=>w.access.releaseAt),before.plan.weeks.map(w=>w.access.releaseAt));
  assert.equal(target.plan.weeks[0].assignment.result.text,before.plan.weeks[0].assignment.result.text);assert.equal(target.plan.weeks[1].access.released,false);
  assert.equal((await dashboard(a,id)).isMember,false);assert.equal((await a.ok('/api/bootstrap')).user.learningMode,'solo');
  assert.equal((await dashboard(b,id)).recovery.canDuo,false);denied(await b.request(`/api/squads/${created.squadId}`));
});
test('refund is private, proportional, demo-only, idempotent and excludes voluntary leavers',async t=>{
  const f=await fixture(t),{people:[a,b,c],id,detail}=await team(f);
  f.setTime(new Date(Date.parse(detail.meetings[1].endsAt)+1000));await c.ok(`/api/squads/${id}/leave`,'POST',{});
  const info=(await dashboard(a,id)).recovery;assert.equal(info.remainingMeetings,6);assert.equal(info.fraction,.75);
  const one=await choose(a,id,info,'refund'),two=await choose(a,id,info,'refund');assert.deepEqual(one.recovery.refund,two.recovery.refund);
  assert.equal(one.recovery.refund.state,'demo_recorded');assert.equal(one.recovery.refund.amountCents,0);assert.equal(one.recovery.refund.paidCents,0);
  assert.equal((await dashboard(b,id)).recovery.refund,null);assert.equal((await dashboard(c,id)).recovery.canChoose,false);
  f.setTime(new Date(Date.parse(info.deadlineAt)+1));const closed=await dashboard(b,id);assert.equal(closed.squad.status,'closed');assert.equal(closed.recovery.refund.state,'demo_recorded');
  assert.equal((await dashboard(c,id)).recovery.refund,null);assert.equal((await a.ok('/api/bootstrap')).currentSquadId,null);
  await f.restart();assert.equal((await dashboard(b,id)).recovery.refund.state,'demo_recorded');
});
test('a team not formed before start automatically records a full demo refund',async t=>{
  const f=await fixture(t),{people:[a],id,detail}=await team(f,1);f.setTime(new Date(Date.parse(detail.squad.startDate)+1));
  const result=await dashboard(a,id);assert.equal(result.squad.status,'closed');assert.equal(result.recovery.fraction,1);assert.equal(result.recovery.refund.mode,'demo');
});
test('replacement search carries equivalent work and never uses demo members',async t=>{
  const f=await fixture(t),{people:[a,b,c],id}=await team(f);
  await a.ok(`/api/squads/${id}/progress/week-1-task-1`,'PUT',{status:'in_progress',note:'Carry me over',url:''});
  await c.ok(`/api/squads/${id}/leave`,'POST',{});const info=(await dashboard(a,id)).recovery;
  const result=await choose(a,id,info,'rematch');assert.equal(result.searching,true);assert.equal((await a.ok('/api/bootstrap')).pendingRecovery.id,info.id);
  const d=await f.guest('New D'),e=await f.guest('New E');await d.ok('/api/matchmaking','POST',{});const match=await e.ok('/api/matchmaking','POST',{});assert.equal(match.status,'matched');
  const target=await dashboard(a,match.squadId);assert.notEqual(target.squad.id,id);assert.equal(target.progress[0].note,'Carry me over');assert.ok(target.members.every(m=>!m.isDemo));
  assert.equal((await a.ok('/api/bootstrap')).pendingRecovery,null);assert.equal((await dashboard(a,id)).isMember,false);
});
test('an unmatched replacement retains recovery options and gets a refund at the deadline',async t=>{
  const f=await fixture(t),{people:[a,b,c],id}=await team(f);await c.ok(`/api/squads/${id}/leave`,'POST',{});
  const info=(await dashboard(a,id)).recovery;await choose(a,id,info,'rematch');assert.equal((await dashboard(a,id)).recovery.canChoose,true);
  f.setTime(new Date(Date.parse(info.deadlineAt)+1));const boot=await a.ok('/api/bootstrap');assert.equal(boot.pendingRecovery,null);assert.equal(boot.matchmaking.status,'idle');assert.equal((await dashboard(a,id)).recovery.refund.state,'demo_recorded');
});
test('demo team-change controls cannot affect a real squad and keep real study intact',async t=>{
  const f=await fixture(t),{people:[a,b],id}=await team(f),real=await a.ok('/api/bootstrap'),demo=await a.ok('/api/demo/start','POST',{});
  denied(await a.request(`/api/squads/${id}/demo-scenario`,'POST',{remaining:1}));denied(await b.request(`/api/squads/${demo.squadId}/demo-scenario`,'POST',{remaining:1}));
  const changed=await a.ok(`/api/squads/${demo.squadId}/demo-scenario`,'POST',{remaining:1});assert.equal(changed.recovery.canChoose,true);
  const solo=await choose(a,demo.squadId,changed.recovery,'solo');assert.equal((await dashboard(a,solo.squadId)).squad.isDemo,true);
  const after=await a.ok('/api/bootstrap');assert.equal(after.currentSquadId,id);assert.deepEqual(after.user,real.user);
});

test('a fresh guest can explore the demo without onboarding or a checkout',async t=>{
  const f=await fixture(t),a=f.client();await a.ok('/api/session','POST',{});const demo=await a.ok('/api/demo/start','POST',{});
  const detail=await dashboard(a,demo.squadId);assert.equal(detail.canEdit,true);assert.equal(detail.plan.weeks[0].tasks[0].access.unlocked,true);
  await a.ok(`/api/squads/${demo.squadId}/progress/week-1-task-1`,'PUT',{status:'in_progress',note:'Demo learner work',url:''});
  const changed=await a.ok(`/api/squads/${demo.squadId}/demo-scenario`,'POST',{remaining:1});await choose(a,demo.squadId,changed.recovery,'refund');
  const boot=await a.ok('/api/bootstrap');assert.equal(boot.user.trackId,'');assert.equal(boot.activeCourses.length,0);assert.ok(boot.demoHistory.some(s=>s.id===demo.squadId));
});
test('a real payment cannot be reported as refunded by the demo ledger',async t=>{
  const f=await fixture(t),{people:[a,b,c],id}=await team(f);await c.ok(`/api/squads/${id}/leave`,'POST',{});
  const user=(await a.ok('/api/bootstrap')).user,info=(await dashboard(a,id)).recovery;
  f.db().prepare("UPDATE course_orders SET paid_cents=2900,mode='paid' WHERE squad_id=? AND user_id=?").run(id,user.id);
  const result=await a.request(`/api/squads/${id}/recovery`,'POST',{caseId:info.id,choice:'refund'});assert.equal(result.status,409);assert.equal(result.body.code,'refund_provider_required');
  assert.equal((await dashboard(a,id)).recovery.refund,null);assert.equal((await dashboard(a,id)).isMember,true);
});
