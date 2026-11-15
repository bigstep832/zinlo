import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import sharp from 'sharp';
import { createApp } from '../server/app.js';
import { searchCities } from '../server/locations.js';
import { passQuiz, submitAssignment } from './assessment-helpers.js';
const profile = (name,extra={})=>({name,trackId:'python',level:'beginner',timezone:'UTC',availability:[{day:2,start:'19:00',end:'22:00'},{day:4,start:'19:00',end:'22:00'}],...extra});
async function fixture(t){
  let time=new Date('2026-11-15T12:00:00Z');
  const app=createApp({dbPath:':memory:',now:()=>new Date(time),aiAdapter:null,googleMeetConfig:null});app.server.listen(0,'127.0.0.1');await once(app.server,'listening');
  t.after(()=>app.close());const base=`http://127.0.0.1:${app.server.address().port}`;
  function client(){let cookie='';return {async request(path,method='GET',body,type){const response=await fetch(base+path,{method,headers:{cookie,origin:base,...(body!==undefined?{'content-type':type||'application/json'}:{})},body:body===undefined?undefined:type?body:JSON.stringify(body)});if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];const data=response.headers.get('content-type')?.includes('json')?await response.json():Buffer.from(await response.arrayBuffer());return {status:response.status,data};},async ok(...args){const result=await this.request(...args);assert.ok(result.status<300,JSON.stringify(result));return result.data;}};}
  return {app,client,setTime:value=>time=new Date(value)};
}
test('city search supports aliases and disambiguation; a selected city controls the saved time zone',async t=>{
  const {client}=await fixture(t),person=client();await person.ok('/api/session','POST',{});
  const cities=await person.ok('/api/cities?q='+encodeURIComponent('Алматы'));
  assert.equal(cities.cities[0].timezone,'Asia/Almaty');
  const saved=await person.ok('/api/profile','PUT',profile('City QA',{cityId:cities.cities[0].id,timezone:'America/New_York'}));
  assert.equal(saved.user.timezone,'Asia/Almaty');assert.match(saved.user.cityLabel,/Kazakhstan/);
  assert.equal((await person.request('/api/profile','PUT',profile('Bad',{cityId:'no-such-city'}))).status,400);
  assert.equal(searchCities('New York')[0].timezone,'America/New_York');
  const ambiguous=searchCities('Springfield');assert.ok(ambiguous.length>1);assert.ok(new Set(ambiguous.map(c=>c.label)).size>1);
  assert.deepEqual(searchCities('a'),[]);
});
test('uploaded avatars are resized, stripped of metadata, private to current teammates and removable',async t=>{
  const {client}=await fixture(t),people=[client(),client(),client()];
  for(const [i,person]of people.entries()){await person.ok('/api/session','POST',{});await person.ok('/api/profile','PUT',profile(`Photo ${i}`));}
  const image=await sharp({create:{width:600,height:400,channels:3,background:'#2463eb'}}).jpeg().withMetadata().toBuffer();
  const uploaded=await people[0].ok('/api/profile/avatar','PUT',image,'image/jpeg');assert.match(uploaded.avatarUrl,/^\/api\/avatars\//);
  const own=await people[0].ok(uploaded.avatarUrl),meta=await sharp(own).metadata();assert.equal(meta.width,256);assert.equal(meta.height,256);assert.equal(meta.format,'webp');assert.equal(meta.exif,undefined);
  assert.equal((await people[1].request(uploaded.avatarUrl)).status,403);
  for(const person of people)await person.ok('/api/matchmaking','POST',{});
  const match=await people[0].ok('/api/matchmaking');assert.equal(match.status,'matched');assert.ok(match.squad.members.some(m=>m.avatarUrl===uploaded.avatarUrl));
  assert.equal((await people[1].request(uploaded.avatarUrl)).status,200);
  await people[1].ok(`/api/squads/${match.squadId}/leave`,'POST',{});assert.equal((await people[1].request(uploaded.avatarUrl)).status,403);
  await people[0].ok('/api/profile/avatar','DELETE',{});assert.equal((await people[0].request(uploaded.avatarUrl)).status,404);
});
test('avatar upload rejects unauthenticated, non-image, SVG and oversized input without changing the current photo',async t=>{
  const {client}=await fixture(t),person=client();
  assert.equal((await person.request('/api/profile/avatar','PUT',Buffer.from('x'),'image/png')).status,401);
  await person.ok('/api/session','POST',{});
  assert.equal((await person.request('/api/profile/avatar','PUT',Buffer.from('not an image'),'image/png')).status,400);
  assert.equal((await person.request('/api/profile/avatar','PUT',Buffer.from('<svg/>'),'image/svg+xml')).status,415);
  assert.equal((await person.request('/api/profile/avatar','PUT',Buffer.alloc(2*1024*1024+1),'image/jpeg')).status,413);
  assert.equal((await person.ok('/api/bootstrap')).user.avatarUrl,null);
});
test('independent checkout creates one private course without queueing or meetings and keeps calendar plus assessment locks',async t=>{
  const {client,setTime}=await fixture(t),person=client(),outsider=client();
  await person.ok('/api/session','POST',{});await outsider.ok('/api/session','POST',{});
  await person.ok('/api/profile','PUT',profile('Solo QA',{learningMode:'solo',availability:[]}));
  assert.equal((await person.request('/api/matchmaking','POST',{})).status,400);
  const course=await person.ok('/api/solo','POST',{}),path=`/api/squads/${course.squadId}`;
  let detail=await person.ok(path);assert.equal(detail.squad.learningMode,'solo');assert.equal(detail.squad.status,'active');assert.equal(detail.squad.memberCount,1);assert.deepEqual(detail.meetings,[]);
  assert.equal(detail.plan.weeks[0].tasks[0].access.unlocked,true);assert.equal(detail.plan.weeks[0].tasks[1].access.unlocked,false);
  assert.equal((await outsider.request(path)).status,403);
  assert.equal((await person.request('/api/solo','POST',{})).status,409);
  await passQuiz(person,course.squadId,'week-1-task-1');await passQuiz(person,course.squadId,'week-1-task-2');await submitAssignment(person,course.squadId,1);
  detail=await person.ok(path);assert.equal(detail.plan.weeks[1].tasks[0].access.reason,'week_not_released');
  setTime('2026-11-22T12:00:00Z');detail=await person.ok(path);assert.equal(detail.plan.weeks[1].tasks[0].access.unlocked,true);assert.equal(detail.plan.weeks[1].tasks[1].access.unlocked,false);
  assert.equal((await person.request('/api/profile','PUT',profile('Solo QA',{learningMode:'squad'}))).status,409);
});
test('solo-only preferences cannot create or join a squad through alternate endpoints',async t=>{
  const {client}=await fixture(t),solo=client(),team=client();for(const p of [solo,team])await p.ok('/api/session','POST',{});
  await solo.ok('/api/profile','PUT',profile('Independent',{learningMode:'solo',availability:[]}));await team.ok('/api/profile','PUT',profile('Team'));
  const slots=[{day:2,start:'19:00'},{day:4,start:'19:00'}];const created=await team.ok('/api/squads','POST',{slots});
  assert.equal((await solo.request(`/api/squads/${created.squadId}/join`,'POST',{})).status,409);
  assert.equal((await solo.request('/api/squads','POST',{slots})).status,400);
  assert.equal((await solo.request('/api/squads/preview','POST',{slots})).status,400);
});
