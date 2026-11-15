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
test('chat is private, persisted, ordered, rate limited, and retry-safe', async t => {
  const f = await fixture(t), { people, id } = await team(f);
  const [a,b] = people, outsider = await f.guest('Outside');
  const path = `/api/squads/${id}/chat`;
  denied(await outsider.request(path));
  denied(await outsider.request(path, 'POST', { text: 'No access', clientId: 'outside-1' }));
  rejected(await a.request(path, 'POST', { text: '  ', clientId: 'blank-000' }));
  rejected(await a.request(path, 'POST', { text: 'x'.repeat(2001), clientId: 'long-0000' }));
  const sent = await a.ok(path, 'POST', { text: '<script>not executable</script>\nHello squad', clientId: 'message-0001' });
  const retry = await a.ok(path, 'POST', { text: '<script>not executable</script>\nHello squad', clientId: 'message-0001' });
  assert.equal(sent.message.id, retry.message.id);
  assert.equal((await a.request(path, 'POST', { text: 'Changed', clientId: 'message-0001' })).status, 409);
  assert.equal((await dashboard(b,id)).chatUnread, 1);
  const got = await b.ok(path);
  assert.equal(got.messages.length,1); assert.equal(got.messages[0].clientId, undefined);
  await b.ok(`${path}/read`, 'PUT', { lastId: sent.message.id });
  assert.equal((await dashboard(b,id)).chatUnread,0);
  await f.restart();
  assert.equal((await b.ok(path)).messages[0].text, sent.message.text);
  for(let n=2;n<=20;n++) await a.ok(path,'POST',{text:`Message ${n}`,clientId:`message-${String(n).padStart(4,'0')}`});
  assert.equal((await a.request(path,'POST',{text:'Too many',clientId:'message-0021'})).status,429);
  await b.ok(`/api/squads/${id}/leave`,'POST',{});
  denied(await b.request(path)); denied(await b.request(path,'POST',{text:'Left',clientId:'left-0001'}));
});
test('chat pagination loses no messages and cannot access another team via cursors', async t => {
  const f=await fixture(t), {people,id}=await team(f);
  const path=`/api/squads/${id}/chat`;
  for(let n=0;n<55;n++) await people[n%3].ok(path,'POST',{text:`Message ${n}`,clientId:`page-${String(n).padStart(4,'0')}`});
  const newest=await people[0].ok(path), oldest=await people[0].ok(`${path}?before=${newest.messages[0].id}`);
  assert.equal(newest.messages.length,50);assert.equal(newest.hasMore,true);assert.equal(oldest.messages.length,5);assert.equal(oldest.hasMore,false);
  const all=[...oldest.messages,...newest.messages];assert.equal(new Set(all.map(m=>m.id)).size,55);
  assert.deepEqual((await people[0].ok(`${path}?after=${all[49].id}`)).messages.map(m=>m.id),all.slice(50).map(m=>m.id));
  rejected(await people[0].request(`${path}?before=NaN`));rejected(await people[0].request(`${path}?after=0&before=2`));
});
test('video requires the current squad and all teammates ready; signals go only to the intended peer', async t=>{
  const f=await fixture(t), {people,id,meetingId,detail}=await team(f), outside=await f.guest('Outside');
  const path=`/api/squads/${id}/meetings/${meetingId}/video`;
  denied(await outside.request(`${path}/join`,'POST',{}));
  assert.equal((await people[0].request(`/api/squads/${id}/meetings/${detail.meetings[1].id}/video/join`,'POST',{})).status,409);
  const sessions=await Promise.all(people.map(p=>p.ok(`${path}/join`,'POST',{})));
  const call=(i,action,body={})=>people[i].request(`${path}/${action}`,'POST',{peerId:sessions[i].peerId,...body});
  denied(await outside.request(`${path}/poll`,'POST',{peerId:sessions[0].peerId}));
  assert.equal((await people[1].request(`${path}/poll`,'POST',{peerId:sessions[0].peerId})).status,409);
  await call(0,'ready',{ready:true});await call(1,'ready',{ready:true});
  assert.equal((await call(0,'poll')).body.started,false);
  assert.equal((await call(0,'signal',{to:sessions[1].peerId,signal:{type:'offer',sdp:'v=0'}})).status,409);
  assert.equal((await call(2,'ready',{ready:true})).body.started,true);
  assert.equal((await call(0,'signal',{to:sessions[1].peerId,signal:{type:'offer',sdp:'v=0'}})).status,200);
  const inbox=await call(1,'poll');assert.equal(inbox.body.signals.length,1);assert.equal((await call(2,'poll')).body.signals.length,0);
  assert.equal((await call(1,'poll',{after:inbox.body.cursor})).body.signals.length,0);
  await people[1].ok(`/api/squads/${id}/leave`,'POST',{});
  denied(await call(1,'poll'));
  assert.equal((await call(0,'signal',{to:sessions[1].peerId,signal:{type:'offer',sdp:'v=0'}})).status,409);
});
test('video replaces a duplicate tab, expires absent sessions and does not persist signals after restart',async t=>{
  const f=await fixture(t),{people,id,meetingId}=await team(f),p=people[0],path=`/api/squads/${id}/meetings/${meetingId}/video`;
  const first=await p.ok(`${path}/join`,'POST',{}),second=await p.ok(`${path}/join`,'POST',{});
  assert.notEqual(first.peerId,second.peerId);
  assert.equal((await p.request(`${path}/poll`,'POST',{peerId:first.peerId})).status,409);
  f.setTime('2026-11-15T12:00:46.000Z');
  assert.equal((await p.request(`${path}/poll`,'POST',{peerId:second.peerId})).status,409);
  const third=await p.ok(`${path}/join`,'POST',{});await f.restart();
  assert.equal((await p.request(`${path}/poll`,'POST',{peerId:third.peerId})).status,409);
});
function noUpcomingUrl(detail, meetingId) {
  assert.ok(!getMeeting(detail, meetingId).meetUrl, 'The conference URL must remain hidden until every current member is ready');
}
