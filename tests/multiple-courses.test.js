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

test('one learner can enroll in several courses with independent progress and schedules',async t=>{
  const f=await fixture(t),{people:[a,b,c],id}=await team(f);
  await a.ok(`/api/squads/${id}/progress/week-1-task-1`,'PUT',{status:'in_progress',note:'Python work stays here',url:''});
  const original=await dashboard(a,id),profile=(await a.ok('/api/bootstrap')).user;
  await a.ok('/api/profile','PUT',{...profile,trackId:'spanish',availability:slots.map(({day})=>({day,start:'20:00',end:'22:00'}))});
  let boot=await a.ok('/api/bootstrap');assert.equal(boot.currentSquadId,null);assert.equal(boot.activeCourses.length,1);assert.equal(boot.history.some(s=>s.id===id),false);
  const spanish=(await a.ok('/api/squads','POST',{slots:slots.map(s=>({...s,start:'20:00'}))})).squadId;
  boot=await a.ok('/api/bootstrap');assert.equal(boot.activeCourses.length,2);assert.equal(boot.currentSquadId,spanish);
  assert.deepEqual((await dashboard(a,id)).meetings,original.meetings);assert.equal((await dashboard(a,id)).progress[0].note,'Python work stays here');assert.equal((await dashboard(a,spanish)).progress[0].note,'');
  denied(await b.request(`/api/squads/${spanish}`));
  await a.ok('/api/profile','PUT',{...profile,trackId:'ai-literacy',learningMode:'solo',availability:[]});
  const ai=(await a.ok('/api/solo','POST',{})).squadId;assert.equal((await a.ok('/api/bootstrap')).activeCourses.length,3);assert.equal((await dashboard(a,ai)).squad.learningMode,'solo');
  rejected(await a.request('/api/solo','POST',{}));
  await a.ok(`/api/squads/${spanish}/leave`,'POST',{});boot=await a.ok('/api/bootstrap');assert.deepEqual(new Set(boot.activeCourses.map(s=>s.id)),new Set([id,ai]));assert.ok(boot.history.some(s=>s.id===spanish));
  await f.restart();assert.equal((await a.ok('/api/bootstrap')).activeCourses.length,2);
});
test('overlaps are rejected for manual creation, preview and join including another time zone',async t=>{
  const f=await fixture(t),{people:[a],id}=await team(f),profile=(await a.ok('/api/bootstrap')).user;
  await a.ok('/api/profile','PUT',{...profile,trackId:'spanish',timezone:'America/New_York',availability:slots.map(({day})=>({day,start:'14:00',end:'17:00'}))});
  const overlapping=slots.map(s=>({...s,start:'14:00'}));
  rejected(await a.request('/api/squads','POST',{slots:overlapping}));rejected(await a.request('/api/squads/preview','POST',{slots:overlapping}));
  const d=await f.guest('Spanish host'),dp=(await d.ok('/api/bootstrap')).user;await d.ok('/api/profile','PUT',{...dp,trackId:'spanish'});
  const other=(await d.ok('/api/squads','POST',{slots})).squadId;
  rejected(await a.request(`/api/squads/${other}/join`,'POST',{}));assert.equal((await dashboard(a,id)).isMember,true);
  assert.equal((await a.ok('/api/matches')).squads.some(s=>s.id===other),false);
  const safe=slots.map(s=>({...s,start:'15:00'}));assert.equal((await a.request('/api/squads','POST',{slots:safe})).status,201);
});
test('automatic matching skips occupied hours and keeps existing courses',async t=>{
  const f=await fixture(t),{people:[a],id}=await team(f),d=await f.guest('Spanish D'),e=await f.guest('Spanish E');
  for(const person of [a,d,e]) {const p=(await person.ok('/api/bootstrap')).user;await person.ok('/api/profile','PUT',{...p,trackId:'spanish'});}
  await a.ok('/api/matchmaking','POST',{});await d.ok('/api/matchmaking','POST',{});const result=await e.ok('/api/matchmaking','POST',{});
  assert.equal(result.status,'matched');const detail=await dashboard(a,result.squadId);assert.ok(detail.meetings.every(m=>m.startsAt.includes('T20:00:')));
  assert.equal((await a.ok('/api/bootstrap')).activeCourses.length,2);assert.equal((await dashboard(a,id)).isMember,true);
  await a.ok('/api/profile','PUT',{...(await a.ok('/api/bootstrap')).user,trackId:'python'});rejected(await a.request('/api/squads','POST',{slots}));
});
test('recovery of one course preserves another enrollment',async t=>{
  const f=await fixture(t),{people:[a,b,c],id}=await team(f),profile=(await a.ok('/api/bootstrap')).user;
  await a.ok('/api/profile','PUT',{...profile,trackId:'spanish',learningMode:'solo',availability:[]});const other=(await a.ok('/api/solo','POST',{})).squadId;
  await c.ok(`/api/squads/${id}/leave`,'POST',{});const info=(await dashboard(a,id)).recovery;const recovery=await choose(a,id,info,'solo');
  const boot=await a.ok('/api/bootstrap');assert.equal(boot.activeCourses.length,2);assert.ok(boot.activeCourses.some(s=>s.id===other));assert.ok(boot.activeCourses.some(s=>s.id===recovery.squadId));assert.equal((await dashboard(a,other)).isMember,true);
});

test('a stale checkout cannot enroll the newly selected course by mistake',async t=>{
  const f=await fixture(t),a=await f.guest('Two tabs'),profile=(await a.ok('/api/bootstrap')).user;
  await a.ok('/api/profile','PUT',{...profile,trackId:'spanish',learningMode:'solo',availability:[]});
  const stale=await a.request('/api/solo','POST',{trackId:'python'});assert.equal(stale.status,409);assert.equal(stale.body.code,'course_selection_changed');assert.equal((await a.ok('/api/bootstrap')).activeCourses.length,0);
  const correct=await a.ok('/api/solo','POST',{trackId:'spanish'});assert.equal((await dashboard(a,correct.squadId)).squad.trackId,'spanish');
});
