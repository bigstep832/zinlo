import { MyCourses } from './my-courses.jsx';
import { DemoExperience, DemoGuide, RecoveryPanel, ProfileGuidelines } from './squad-support.jsx';
import { CourseHome } from './course-home.jsx';
import { TeamChat } from './team-chat.jsx';
import { VideoRoom } from './video-room.jsx';
import { Checkout } from './course-checkout.jsx';
import { Avatar, AvatarPicker } from './avatar.jsx';
import { CityPicker, AvailabilityEditor, ProfileReview, LearningFormat } from './onboarding-details.jsx';
import { MatchExperience } from './match-experience.jsx';
import React, { useState, useEffect, useRef, useId, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { MeetingReadiness, MeetingJoinLink, MeetingWaitingRoom, useMeetingAccess } from './meeting-access.jsx';
import { LearningWorkspace } from './learning-plan.jsx';
import './styles.css';
import './blue-design.css';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const LEVELS = { beginner: 'Starting from scratch', basics: 'Know the basics' };
const DEFAULT_LEVELS = [
  { id: 'beginner', title: 'Starting from scratch', description: 'This subject is new to me. I would like to start with guided examples.' },
  { id: 'basics', title: 'Know the basics', description: 'I can already do simple tasks in this subject and would like more practice.' },
];
const findTrack = (boot, id) => [...(boot?.tracks || []), ...(boot?.archivedTracks || [])].find(track => track.id === id);
const trackLevels = track => track?.levels?.length ? track.levels : DEFAULT_LEVELS;
const levelTitle = (track, level) => trackLevels(track).find(item => item.id === level)?.title || LEVELS[level] || level;
const STATUS = { forming: 'Forming', ready: 'Ready', active: 'Active', completed: 'Completed', closed: 'Closed' };
const TIMES = Array.from({ length: 49 }, (_, i) => `${String(Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`);
const detectedZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const ZONES = [...new Set(['UTC', detectedZone, ...(Intl.supportedValuesOf?.('timeZone') || ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'Europe/London', 'Asia/Almaty'])])].sort();
const minute = text => Number(text.split(':')[0]) * 60 + Number(text.split(':')[1]);

async function api(path, method = 'GET', body, signal) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) controller.abort();
  const timer = setTimeout(() => controller.abort(), path.endsWith('/adapt') ? 65000 : 20000);
  try {
    const response = await fetch(`/api${path}`, { method, credentials: 'same-origin', signal: controller.signal, headers: body !== undefined ? { 'Content-Type': 'application/json' } : {}, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(data.error || `Request failed (${response.status}). Please try again.`), data, { status: response.status });
    return data;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('The request took too long. Refresh to check whether it was saved, then try again.');
    if (error instanceof TypeError) throw new Error('Cannot reach the server. Check your connection and try again.');
    throw error;
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}

function dateText(value, timezone, full = false) {
  if (!value) return '';
  try { return new Intl.DateTimeFormat('en-US', { timeZone: timezone || detectedZone, weekday: 'short', month: 'short', day: 'numeric', ...(full ? { year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' } : {}) }).format(new Date(value)); }
  catch { return value; }
}
function timeText(value, timezone) { return new Intl.DateTimeFormat('en-US', { timeZone: timezone || detectedZone, hour: 'numeric', minute: '2-digit' }).format(new Date(value)); }

function Notice({ children, error = false }) { return children ? <div className={`notice ${error ? 'error' : ''}`} role={error ? 'alert' : 'status'}>{children}</div> : null; }
function Loading({ children = 'Loading…' }) { return <div className="loading" role="status">{children}</div>; }
function Badge({ status }) { return <span className="badge">{STATUS[status] || status}</span>; }
function Modal({ title, onClose, children }) {
  const ref = useRef(null); const id = useId();
  useEffect(() => { const dialog = ref.current; dialog.showModal(); return () => dialog.close(); }, []);
  return <dialog ref={ref} aria-labelledby={id} onCancel={e => { e.preventDefault(); onClose(); }} onClick={e => { if (e.target === e.currentTarget) { const b = e.currentTarget.getBoundingClientRect(); if (e.clientX < b.left || e.clientX > b.right || e.clientY < b.top || e.clientY > b.bottom) onClose(); } }}><div className="modal-head"><h2 id={id}>{title}</h2><button type="button" onClick={onClose}>Close</button></div><div className="modal-body">{children}</div></dialog>;
}

function Schedule({ meetings = [], timezone, compact = false }) {
  return <div className="schedule"><p className="muted">Times in <strong>{timezone || detectedZone}</strong>. Each meeting lasts 50 minutes; reserve the full hour.</p><ol className={compact ? 'schedule-list compact' : 'schedule-list'}>{meetings.map((meeting, i) => <li key={meeting.id || i}><div><span className="eyebrow">Meeting {i + 1} · Week {meeting.week || Math.floor(i / 2) + 1}</span><strong>{dateText(meeting.startsAt, timezone)} · {timeText(meeting.startsAt, timezone)}–{timeText(meeting.windowEndsAt || meeting.endsAt, timezone)}</strong>{!compact && <span className="muted">{meeting.topic}</span>}</div></li>)}</ol></div>;
}

function App() {
  const [boot, setBoot] = useState(null); const [error, setError] = useState('');
  const [path, setPath] = useState(location.pathname); const [dialog, setDialog] = useState(null); const [busy, setBusy] = useState(false);
  const initial = useRef(true);
  const go = (next, replace = false) => { if (next !== location.pathname) history[replace ? 'replaceState' : 'pushState']({}, '', next); setPath(next); setDialog(null); window.scrollTo({ top: 0 }); };
  async function refresh() { const data = await api('/bootstrap'); setBoot(data); return data; }
  useEffect(() => { const pop = () => { setPath(location.pathname); setDialog(null); }; window.addEventListener('popstate', pop); return () => window.removeEventListener('popstate', pop); }, []);
  useEffect(() => { refresh().then(data => { if (initial.current && location.pathname === '/') { if (data.matchmaking?.status === 'waiting') go('/matches', true); else if (data.activeCourses?.length) go('/courses', true); } initial.current = false; }).catch(e => setError(e.message)); }, []);
  useEffect(() => { document.title = `${path === '/' ? 'Learn together' : path === '/start' ? 'Find your squad' : path === '/matches' ? 'Find my teammates' : path === '/checkout' ? 'Course checkout' : path === '/courses' ? 'My courses' : path === '/demo' ? 'Interactive demo' : 'Your squad'} · Zinlo`; }, [path]);
  async function start(trackId) {
    setBusy(true); setError('');
    try { const data = await api('/session', 'POST', {}); const enrolled = data.activeCourses?.find(course => course.trackId === trackId); setBoot({ ...data, selectedTrack: trackId }); go(enrolled ? `/squads/${enrolled.id}` : !trackId && data.matchmaking?.status === 'waiting' ? '/matches' : '/start'); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  const trackName = id => findTrack(boot, id)?.title || id;
  return <><a className="skip-link" href="#main">Skip to content</a><header><div className="header-inner"><a className="brand" href="/" onClick={e => { e.preventDefault(); go('/'); }} aria-label="Zinlo home"><img src="/zinlo-mark.svg" alt="" width="42" height="30"/>Zinlo</a><nav aria-label="Main navigation">{boot?.matchmaking?.status === 'waiting' && <a href="/matches" onClick={e => { e.preventDefault(); go('/matches'); }}>My search</a>}{boot?.activeCourses?.length > 0 && <a href="/courses" aria-current={path === '/courses' ? 'page' : undefined} onClick={e => { e.preventDefault(); go('/courses'); }}>My courses</a>}{boot?.demoSquadId && <a href={`/squads/${boot.demoSquadId}`} onClick={e => { e.preventDefault(); go(`/squads/${boot.demoSquadId}`); }}>My demo</a>}{boot?.user ? <><button className="text-button" onClick={() => setDialog('history')}>History</button><button onClick={() => setDialog('profile')}>{boot.user.name || 'Guest'} · Profile</button></> : <button disabled={busy || !boot} onClick={() => start()}>Find my squad</button>}</nav></div></header>
    <main id="main" className={path === "/" ? "site-home" : path.startsWith("/squads/") ? "squad-main" : path === "/start" ? "setup-page" : path === "/matches" ? "search-page" : ""}><Notice error>{error}</Notice>{!boot ? error ? <button onClick={() => { setError(''); refresh().catch(e => setError(e.message)); }}>Retry connection</button> : <Loading>Connecting to Zinlo…</Loading> : path === '/' ? <CourseHome tracks={boot.tracks} start={start} busy={busy} Modal={Modal} /> : path === '/courses' ? <MyCourses boot={boot} go={go} dateText={dateText}/> : path === '/demo' ? <DemoExperience api={api} refresh={refresh} go={go}/> : path === '/start' ? <Onboarding boot={boot} onSaved={async ({ startSearch } = {}) => { const data = await refresh(); go(startSearch ? '/checkout' : data.currentSquadId ? `/squads/${data.currentSquadId}` : '/matches'); }} createSession={async () => { const data = await api('/session', 'POST', {}); setBoot(data); }} /> : path === '/checkout' ? <Checkout boot={boot} api={api} refresh={refresh} go={go} /> : path === '/matches' ? <>{boot.pendingRecovery && <RecoveryPanel squadId={boot.pendingRecovery.squadId} info={boot.pendingRecovery} api={api} refresh={refresh} go={go}/>}<Matches boot={boot} go={go} refresh={refresh} /></> : /^\/squads\/[^/]+(?:\/.*)?$/.test(path) ? <Dashboard key={path.split('/')[2]} id={path.split('/')[2]} path={path} waitingMeetingId={/^\/squads\/[^/]+\/meetings\/[^/]+\/wait$/.test(path) ? path.split('/')[4] : null} boot={boot} refreshBoot={refresh} go={go} /> : <section className="panel"><h1>Page not found</h1><button onClick={() => go('/')}>Go home</button></section>}</main>
    {dialog === 'profile' && <Modal title="Your profile" onClose={() => setDialog(null)}><ProfileGuidelines/><ProfileForm boot={boot} editing onSaved={async () => { const data = await refresh(); setDialog(null); if (path === '/matches') { go('/start'); go('/matches'); } else if (path.startsWith('/squads/') && !data.currentSquadId) go('/matches'); }} /></Modal>}
    {dialog === 'history' && <Modal title="Sprint history" onClose={() => setDialog(null)}>{boot.history?.length ? <div className="stack">{boot.history.map(s => <article className="panel" key={s.id}><div className="row"><h3>{s.name || trackName(s.trackId)}</h3><Badge status={s.status} /></div><p>{dateText(s.startDate, boot.user?.timezone)} – {dateText(s.endDate, boot.user?.timezone)}</p><button onClick={() => go(`/squads/${s.id}`)}>Open sprint</button></article>)}</div> : <p>Your completed, closed and previous sprints will appear here.</p>}<p className="muted">History stays with this browser’s guest session.</p>{boot.demoHistory?.length > 0 && <details><summary>Demo history</summary><div className="stack">{boot.demoHistory.map(s => <article className="panel" key={s.id}><h3>{s.name} · Demo</h3><p>Sample course · {s.status}</p><button onClick={() => go(`/squads/${s.id}`)}>Open demo record</button></article>)}</div></details>}</Modal>}
  </>;
}

function Onboarding({ boot, onSaved, createSession }) {
  const [error, setError] = useState(''); const requested = useRef(false);
  useEffect(() => { if (!boot.user && !requested.current) { requested.current = true; createSession().catch(e => setError(e.message)); } }, [boot.user]);
  if (!boot.user) return <><Notice error>{error}</Notice>{error ? <button onClick={() => { setError(''); createSession().catch(e => setError(e.message)); }}>Start guest session</button> : <Loading>Starting your private guest session…</Loading>}</>;
  return <div className="setup-layout"><aside className="setup-story"><p className="eyebrow">Your next chapter</p><h2>Four weeks.<br />One useful skill.<br />Your next chapter.</h2><p>A little structure.<br />Steady progress.</p><small>Free to try. No email or card needed.</small></aside><div className="setup-content"><p className="eyebrow">Find your squad</p><h1>Make it yours.</h1><p className="lead">Choose a skill you would love to learn.<br />Learn with a small squad, or follow your own weekly plan.</p><ProfileForm boot={boot} onSaved={onSaved} /></div></div>;
}

function ProfileForm({ boot, editing = false, onSaved }) {
  const formRef = useRef(null), previousStep = useRef(0);
  const [form, setForm] = useState(() => ({ name: boot.user?.name || '', learningMode: boot.user?.learningMode || 'squad', cityId: boot.user?.cityId || null, cityLabel: boot.user?.cityLabel || '', manualTimezone: !!boot.user?.trackId && !boot.user?.cityId, trackId: (editing ? boot.user?.trackId : boot.selectedTrack || boot.user?.trackId) || boot.tracks[0]?.id || '', level: boot.user?.level || 'beginner', timezone: boot.user?.availability?.length ? boot.user.timezone : detectedZone, availability: boot.user?.availability?.length ? boot.user.availability : [{ day: 2, start: '19:00', end: '22:00' }, { day: 4, start: '19:00', end: '22:00' }] }));
  const [step, setStep] = useState(0); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [conflict, setConflict] = useState(false);
  useEffect(() => { if (editing || previousStep.current === step) return; previousStep.current = step; const legend = formRef.current?.querySelector('fieldset > legend'); if (legend) { legend.tabIndex = -1; legend.focus({preventScroll:true}); } formRef.current?.scrollIntoView({block:'start',behavior:'instant'}); }, [step, editing]);
  const [avatarUrl, setAvatarUrl] = useState(boot.user?.avatarUrl || null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const track = findTrack(boot, form.trackId); const currentCourse = boot.activeCourses?.find(course => course.trackId === form.trackId); const current = !!currentCourse;
  const archived = !boot.tracks.some(item => item.id === form.trackId);
  const levels = trackLevels(track);
  const update = (key, value) => {
    setForm(f => {
      const next = { ...f, [key]: value };
      if (key === 'trackId') { const enrolled = boot.activeCourses?.find(course => course.trackId === value); if (enrolled) { next.level = enrolled.level; next.learningMode = enrolled.learningMode; } const options = trackLevels(findTrack(boot, value)); if (!options.some(option => option.id === f.level)) next.level = options[0].id; }
      return next;
    });
    setConflict(false); setError('');
  };
  function validate(part) {
    if ((part === 0 || part === 'all') && !form.name.trim()) return 'Enter a name or nickname.';
    if ((part === 0 || part === 'all') && (!track || archived && !current)) return 'This course is archived. Choose an available course before starting a new search.';
    if ((part === 1 || part === 'all') && !levels.some(level => level.id === form.level)) return 'Choose a starting level for this course.';
    if (part === 2 || part === 'all') {
      if (!form.cityId && !form.manualTimezone) return 'Choose your city from the results, or select a time zone manually.';
      try { new Intl.DateTimeFormat('en', { timeZone: form.timezone }); } catch { return 'Choose a valid named time zone from the list.'; }
      if (form.learningMode !== 'solo' && form.availability.some(a => minute(a.end) <= minute(a.start))) return 'Every availability interval must end after it starts.';
      if (form.learningMode !== 'solo' && new Set(availableSlots(form.availability).map(s => s.day)).size < 2) return 'Add at least one full hour on two different days.';
    }
    return '';
  }
  async function save(confirmConflict = false, leave = false) {
    const issue = validate('all'); if (issue) { setError(issue); return; }
    if (leave && archived) { setError('Leave this archived squad from its workspace, then choose a current course before saving a new profile.'); return; }
    setBusy(true); setError('');
    try {
      if (leave) await api(`/squads/${currentCourse.id}/leave`, 'POST', {});
      await api('/profile', 'PUT', { ...form, confirmConflict });
      await onSaved({ startSearch: !editing && !current });
    } catch (e) { setError(e.message); if (e.code === 'schedule_conflict') setConflict(true); }
    finally { setBusy(false); }
  }
  const advance = () => { const issue = validate(step); if (issue) return setError(issue); setError(''); setStep(s => s + 1); };
  const visible = s => editing || step === s;

  return <form ref={formRef} className={editing ? 'stack' : 'panel stack'} onSubmit={e => { e.preventDefault(); if (!editing && step < 3) advance(); else save(); }}>
    {boot.matchmaking?.status === 'waiting' && <Notice>Saving these preferences replaces your current search. Existing enrolled courses and their meeting times stay unchanged.</Notice>}
    {!editing && <ol className="steps" aria-label="Setup progress">{['Profile', 'Preparation', form.learningMode === 'solo' ? 'Schedule' : 'Availability', 'Review'].map((name, i) => <li key={name} aria-current={step === i ? 'step' : undefined}><span>{i + 1}</span>{name}</li>)}</ol>}
    {visible(0) && <fieldset disabled={busy || photoBusy}>
      <legend>{editing ? 'Profile and course' : '1. Your profile and direction'}</legend>
      <AvatarPicker name={form.name} value={avatarUrl} onChange={setAvatarUrl} onBusy={setPhotoBusy} />
      <label>Name or nickname<input value={form.name} maxLength={60} autoComplete="nickname" onChange={e => update('name', e.target.value)} required /></label>
      {editing ? <><label>Learning course<select value={form.trackId} onChange={e => update('trackId', e.target.value)}>
        {archived && <option value={form.trackId} disabled>{track?.title || form.trackId} (archived)</option>}
        {boot.tracks.map(course => <option key={course.id} value={course.id}>{course.title}</option>)}
      </select></label></> : <fieldset className="setup-course-choices"><legend>What would you like to learn?</legend>{boot.tracks.map(course => <label className="choice" key={course.id}><input type="radio" name="course" checked={form.trackId === course.id} onChange={() => update('trackId', course.id)} /><span><strong>{course.title}</strong><small>{course.project}</small></span></label>)}</fieldset>}
      <LearningFormat value={form.learningMode} onChange={value => update('learningMode', value)} disabled={current} />
      {archived && <Notice>{current ? 'This course is archived for new learners. Your existing squad, study plan and results remain available.' : 'Your previous course is archived. Choose an available course above to start a new search; your history is preserved.'}</Notice>}
      <p><strong>Your outcome:</strong> {track?.project}</p>
      {track?.prerequisite && <p className="muted">{track.prerequisite}</p>}
      {current && <p className="muted">You are already enrolled in this course. Its level and format stay fixed. Choose a different course to add another enrollment.</p>}
    </fieldset>}
    {visible(1) && <fieldset disabled={busy || photoBusy}>
      <legend>{editing ? 'Preparation' : '2. Your starting point'}</legend>
      {levels.map(level => <label className="choice" key={level.id}>
        <input type="radio" name="level" value={level.id} checked={form.level === level.id} disabled={current} onChange={() => update('level', level.id)} />
        <span><strong>{level.title}</strong><small>{level.description}</small></span>
      </label>)}
      <p className="muted">This is your own assessment, not an entrance exam. We match you with learners at the same starting level.</p>
    </fieldset>}
    {visible(2) && <fieldset disabled={busy || photoBusy}><legend>{editing ? 'Your schedule' : form.learningMode === 'solo' ? '3. Your weekly rhythm' : '3. Make time for your squad'}</legend><CityPicker form={form} setForm={setForm} api={api} zones={ZONES} />{form.learningMode === 'solo' ? <p className="muted">Start after checkout. Each new week opens seven days after the previous one, once you complete its lessons and assignment. No meeting times needed.</p> : <><AvailabilityEditor form={form} update={update} />{boot.activeCourses?.length > 0 && <p className="notice">These times apply to your selected course. New squad meetings must fit around your other enrolled courses; their schedules stay unchanged.</p>}</>}</fieldset>}
    {visible(3) && !editing && <fieldset><legend>4. Your next chapter, at a glance</legend><ProfileReview form={form} track={track} level={levelTitle(track,form.level)} avatarUrl={avatarUrl} /></fieldset>}
    <Notice error>{error}</Notice>
    {conflict && <div className="panel"><h3>Your new availability conflicts with this squad</h3><p>The squad’s meeting times will stay the same. You can keep your existing commitment{archived ? '.' : ', or leave the squad and save your new availability.'}</p>{archived && <p>This course is archived. To switch courses, close this profile, leave from the squad workspace, then choose a current course.</p>}<div className="actions"><button type="button" disabled={busy} onClick={() => save(true)}>Save and keep my commitment</button>{!archived && <button type="button" disabled={busy} onClick={() => save(false, true)}>Leave squad and save</button>}</div></div>}
    <div className={`actions ${!editing && step === 3 ? 'final-search-action' : ''}`}>{!editing && step > 0 && <button type="button" disabled={busy} onClick={() => { setStep(s => s - 1); setError(''); }}>Back</button>}<button className={`primary ${!editing && step === 3 ? 'find-teammates-button' : ''}`} disabled={busy || photoBusy}>{busy && !editing && step === 3 && <span className="search-spinner small" aria-hidden="true" />}{busy ? (!editing && step === 3 ? 'Saving preferences…' : 'Saving…') : editing ? 'Save profile' : step === 3 ? (current ? 'Save and open my squad' : 'Continue to checkout') : 'Continue'}</button></div>
  </form>;
}

function availableSlots(availability = []) {
  const result = [];
  for (let day = 1; day <= 7; day++) {
    const ranges = availability.filter(a => a.day === day).map(a => [minute(a.start), minute(a.end)]).sort((a, b) => a[0] - b[0]);
    const merged = []; for (const range of ranges) { const last = merged.at(-1); if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]); else merged.push([...range]); }
    for (const [start, end] of merged) for (let m = Math.ceil(start / 30) * 30; m + 60 <= end; m += 30) result.push({ day, start: TIMES[m / 30] });
  }
  return result;
}

function Matches({ boot, go, refresh }) {
  const [search, setSearch] = useState(boot.matchmaking || null); const [error, setError] = useState('');
  const [requestBusy, setRequestBusy] = useState(false); const [cancelled, setCancelled] = useState(false);
  const stateRef = useRef(null); const mounted = useRef(false); const inFlight = useRef(false);
  const generation = useRef(0); const controllerRef = useRef(null); const syncedSquad = useRef(null);
  const refreshRef = useRef(refresh); refreshRef.current = refresh;
  const profileKey = JSON.stringify(boot.user);

  async function request(method, path, explicit = false) {
    if (inFlight.current) return null;
    inFlight.current = true; setRequestBusy(true);
    const version = generation.current; const controller = new AbortController(); controllerRef.current = controller;
    if (explicit) setError('');
    try {
      const result = await api(path, method, method === 'GET' ? undefined : {}, controller.signal);
      if (!mounted.current || generation.current !== version) return null;
      const previousStatus = stateRef.current?.status;
      stateRef.current = result; setSearch(result); setError('');
      if (result.status === 'matched' && result.squadId !== syncedSquad.current) {
        syncedSquad.current = result.squadId;
        await refreshRef.current();
      } else if (explicit || (previousStatus && previousStatus !== result.status)) await refreshRef.current();
      return result;
    } catch (e) {
      if (mounted.current && generation.current === version && !controller.signal.aborted) setError(e.message);
      return null;
    } finally {
      if (generation.current === version) { inFlight.current = false; controllerRef.current = null; if (mounted.current) setRequestBusy(false); }
    }
  }

  async function checkStatus() { const result = await request('GET', '/matchmaking', true); if (result?.status === 'waiting' && document.visibilityState === 'visible') await request('POST', '/matchmaking/poll'); }

  useEffect(() => {
    mounted.current = true; generation.current += 1; inFlight.current = false;
    stateRef.current = boot.matchmaking || null; setSearch(boot.matchmaking || null); setError(''); setCancelled(false);
    if (boot.user?.trackId) checkStatus();
    const poll = () => { if (document.visibilityState === 'visible' && stateRef.current?.status === 'waiting') request('POST', '/matchmaking/poll'); };
    const timer = setInterval(poll, 5000);
    document.addEventListener('visibilitychange', poll);
    return () => { mounted.current = false; generation.current += 1; controllerRef.current?.abort(); clearInterval(timer); document.removeEventListener('visibilitychange', poll); };
  }, [profileKey]);

  async function begin() { setCancelled(false); await request('POST', '/matchmaking', true); }
  async function cancel(edit = false) {
    const result = await request('DELETE', '/matchmaking', true);
    if (!result) return;
    if (result.status === 'matched') return;
    setCancelled(true);
    if (edit) go('/start');
  }
  if (!boot.user?.trackId) return <section className="panel"><h1>Set your preferences first</h1><p>Choose your course, starting level and availability so we can find your teammates.</p><button className="primary" onClick={() => go('/start')}>Complete my profile</button></section>;
  if (!boot.currentSquadId && !boot.tracks.some(course => course.id === boot.user.trackId)) return <section className="panel"><h1>Choose a current course</h1><p>Your previous course is archived and no longer accepts new searches. Your earlier squads and saved results remain in History.</p><button className="primary" onClick={() => go('/start')}>Choose a new course</button></section>;
  const track = findTrack(boot, boot.user.trackId);
  const squad = search?.squad;
  const waiting = search?.status === 'waiting';
  const matched = search?.status === 'matched' && squad;
  if (boot.user?.learningMode === 'solo') return <section className="panel narrow"><h1>Your independent course</h1><button className="primary" onClick={() => go(boot.currentSquadId ? `/squads/${boot.currentSquadId}` : '/checkout')}>Continue to my course</button></section>;
  if (waiting || matched) return <MatchExperience search={search} user={boot.user} track={track} error={error} busy={requestBusy} onCancel={() => cancel(false)} onEdit={() => cancel(true)} onRetry={checkStatus} onDemo={() => go('/demo')} onOpen={() => go(`/squads/${search.squadId}`)} schedule={<Schedule meetings={squad?.meetings || []} timezone={boot.user.timezone} />} />;
  return <section className="panel narrow"><p className="eyebrow">{track?.title}</p><h1>{search?.status === 'expired' ? 'Your search paused' : cancelled ? 'Search cancelled' : 'Ready for your next chapter?'}</h1><p>{search?.status === 'expired' ? 'This page was inactive or disconnected. Your preferences are saved.' : 'Review your course before starting a new teammate search.'}</p><Notice error>{error}</Notice>{!search && !error ? <Loading>Checking your search…</Loading> : <div className="actions"><button disabled={requestBusy} onClick={() => go('/start')}>Edit preferences</button><button className="primary" disabled={requestBusy} onClick={() => go('/checkout')}>Continue to checkout</button>{error && <button disabled={requestBusy} onClick={checkStatus}>Retry search status</button>}</div>}</section>;

}

function Dashboard({ id, path, boot, refreshBoot, go, waitingMeetingId = null }) {
  const [data, setData] = useState(null); const base = `/squads/${id}`; const section = path.slice(base.length).split('/')[1] || 'overview'; const tab = section === 'assignments' ? 'plan' : section; const setTab = next => go(`${base}${next === 'overview' ? '' : '/' + next}`); const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const [busy, setBusy] = useState(false); const [leaving, setLeaving] = useState(false); const [meeting, setMeeting] = useState(null);
  const [pollError, setPollError] = useState('');
  const [receivedAt, setReceivedAt] = useState(0);

  const bootRef = useRef(boot); bootRef.current = boot;
  const refreshRef = useRef(refreshBoot); refreshRef.current = refreshBoot;
  const goRef = useRef(go); goRef.current = go;
  const dataRef = useRef(null);
  const scopeRef = useRef(id); scopeRef.current = id;
  const mountedRef = useRef(true);
  const readRef = useRef(null);
  const readVersion = useRef(0);
  const mutations = useRef(new Set());
  const acceptDashboard = useCallback(result => {
    if (!mountedRef.current || scopeRef.current !== id) return;
    dataRef.current = result; setData(result); setReceivedAt(Date.now()); setPollError('');
  }, [id]);
  const load = useCallback(async (background = false) => {
    if (mutations.current.size || (background && readRef.current)) return dataRef.current;
    readRef.current?.abort();
    const controller = new AbortController();
    const version = ++readVersion.current;
    readRef.current = controller;
    try {
      const result = await api(`/squads/${id}`, 'GET', undefined, controller.signal);
      if (controller.signal.aborted || !mountedRef.current || scopeRef.current !== id || version !== readVersion.current) return dataRef.current;
      acceptDashboard(result);
      if ((!result.isMember || ['closed', 'completed'].includes(result.squad.status)) && bootRef.current.activeCourses?.some(course => course.id === id)) await refreshRef.current();
      return result;
    } catch (err) {
      if (!controller.signal.aborted && err.code === 'course_removed') {
        const updated = await refreshRef.current();
        if (mountedRef.current && scopeRef.current === id) goRef.current(updated.currentSquadId ? `/squads/${updated.currentSquadId}` : '/start', true);
        return null;
      }
      if (!controller.signal.aborted) throw err;
      return dataRef.current;
    }
    finally { if (readRef.current === controller) readRef.current = null; }
  }, [id, acceptDashboard]);
  const change = useCallback(async (path, method, body) => {
    readVersion.current++; readRef.current?.abort();
    const controller = new AbortController(); mutations.current.add(controller);
    try {
      const result = await api(path, method, body, controller.signal);
      if (controller.signal.aborted || !mountedRef.current || scopeRef.current !== id) return result;
      if (result.squad && Array.isArray(result.meetings)) acceptDashboard(result);
      else if (method === 'DELETE') {
        const updated = await api(`/squads/${id}`, 'GET', undefined, controller.signal);
        if (!controller.signal.aborted) acceptDashboard(updated);
      }
      return result;
    } finally { mutations.current.delete(controller); }
  }, [id, acceptDashboard]);
  useEffect(() => {
    mountedRef.current = true; dataRef.current = null; setData(null); setError('');
    load().catch(e => { if (mountedRef.current && scopeRef.current === id) setError(e.message); });
    const poll = () => { if (document.visibilityState === 'visible' && (!dataRef.current || dataRef.current.isMember && dataRef.current.canEdit)) load(true).catch(e => { if (mountedRef.current && scopeRef.current === id) setPollError(`Live updates paused. ${e.message}`); }); };
    const timer = setInterval(poll, 4000);
    document.addEventListener('visibilitychange', poll);
    const callback = new URLSearchParams(location.search).get('googleMeet');
    if (callback) {
      if (callback === 'connected') setNotice('Your Google account is connected. Your squad can now create shared Meet links.');
      else setError('Google could not be connected. Please try again.');
      const url = new URL(location.href); url.searchParams.delete('googleMeet'); history.replaceState(null, '', url.pathname + url.search + url.hash);
    }
    return () => { mountedRef.current = false; readVersion.current++; readRef.current?.abort(); for (const controller of mutations.current) controller.abort(); clearInterval(timer); document.removeEventListener('visibilitychange', poll); };
  }, [id, load]);
  const meetingAccess = useMeetingAccess({ squadId: id, data, receivedAt, change, suspended: busy || leaving || section !== 'meetings' && !waitingMeetingId, waitingMeetingId });
  async function leave() { setBusy(true); setError(''); try { await api(`/squads/${id}/leave`, 'POST', {}); await refreshBoot(); go(data?.squad.isDemo ? '/' : '/matches'); } catch (e) { setError(e.message); setLeaving(false); } finally { setBusy(false); } }
  async function adapt() { setBusy(true); setError(''); setNotice(''); try { const result = await api(`/squads/${id}/adapt`, 'POST', {}); setNotice(result.message || (result.source === 'ai' ? 'Your adapted plan has been saved.' : 'The base plan is still available.')); await load(); } catch (e) { setError(e.message); } finally { setBusy(false); } }
  if (!data) return <><Notice error>{error}</Notice>{error ? <div className="actions"><button onClick={() => { setError(''); load().catch(e => setError(e.message)); }}>Retry</button><button onClick={() => go('/')}>Go home</button></div> : <Loading>Loading your squad…</Loading>}</>;
  const { squad, plan, meetings, members, progress, canEdit } = data;
  const solo = squad.learningMode === 'solo';
  const zone = boot.user?.timezone || detectedZone; const track = findTrack(boot, squad.trackId);
  if (waitingMeetingId) return <><Notice error>{pollError}</Notice><MeetingWaitingRoom access={meetingAccess} Modal={Modal} onBack={() => go(`/squads/${id}`)} timeLabel={meetingAccess.nextMeeting ? dateText(meetingAccess.nextMeeting.startsAt, zone, true) : ''} /></>;
  const nextAssignment = plan.weeks.find(week => week.week === data.learningProgress?.nextAssignmentWeek);
  const tasks = plan.weeks.flatMap(w => w.tasks); const done = progress.filter(p => p.status === 'done').length;
  const nextMeeting = meetings.find(m => m.readiness?.eligible) || meetings.find(m => new Date(m.endsAt).getTime() > Date.now()); const nextTask = tasks.find(task => task.id === data.learningProgress?.nextAvailableTaskId && task.access?.unlocked);
  const working = progress.some(p => p.status !== 'not_started' || p.note || p.url) || data.teamProgress?.some(p => p.results?.some(r => r.status !== 'not_started' || r.note || r.url));
  const links = [['overview', 'Home'], ['plan', 'Learning plan'], ['assignments', 'Assignments'], ['chat', 'Team chat'], ['meetings', 'Meetings'], ['progress', 'Progress'], ['settings', 'Settings']].filter(([key]) => !solo || !['chat','meetings'].includes(key));
  const lessonPath = task => `${base}/plan/weeks/${task.week}/lessons/${task.id}/learn`;
  const activeSection = section === 'room' ? 'meetings' : section;
  return <div className={`squad-shell ${section === 'room' ? 'room-shell' : ''}`}><aside className="squad-sidebar"><p className="sidebar-kicker">YOUR WORKSPACE</p><h2>{squad.name}</h2><p className="sidebar-course">{track?.title}</p><nav aria-label="Squad navigation">{links.map(([key, label]) => <a key={key} href={`${base}${key === 'overview' ? '' : '/' + key}`} aria-current={activeSection === key ? 'page' : undefined} onClick={event => { if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return; event.preventDefault(); setTab(key); }}>{label}{key === 'chat' && data.chatUnread > 0 ? <span className="nav-count">{data.chatUnread}</span> : null}</a>)}</nav><div className="sidebar-footer"><strong>One step at a time.</strong><p>{done} of {tasks.length} lessons completed</p><progress value={done} max={tasks.length} aria-label="Course progress" /></div></aside>
    <div className="squad-content"><div className="workspace-top"><span>{track?.title} · {levelTitle(track, squad.level)}</span><Badge status={squad.status} /></div>
    {section !== 'overview' && <a className="back-home" href={base} onClick={e => { e.preventDefault(); go(base); }}>{solo ? 'Back to course home' : 'Back to squad home'}</a>}
    <Notice error>{error}</Notice><Notice error>{pollError}</Notice><Notice>{notice}</Notice>
    {squad.isDemo && <DemoGuide squad={squad} api={api} reload={load} refresh={refreshBoot} go={go}/>}
    {['overview','settings'].includes(section) && <RecoveryPanel squadId={id} info={data.recovery} api={api} refresh={async () => { await load(); await refreshBoot(); }} go={go} isDemo={squad.isDemo}/>}
    {['completed','closed'].includes(squad.status) && <Notice>This sprint has {squad.status === 'completed' ? 'ended' : 'closed'}. Your saved work remains available.</Notice>}
    {!data.isMember && <Notice>You are viewing a previous squad. Your saved learning work is read-only.</Notice>}
    {section === 'overview' && <><div className="hub-heading"><p className="eyebrow">{squad.name}</p><h1>Good to see you{boot.user?.name ? `, ${boot.user.name}` : ''}.</h1><p>{solo ? 'Your weekly plan. Your own progress. What will you work on today?' : 'Small steps. Shared momentum. What will you work on today?'}</p></div><div className="hub-grid">
      <section className="panel next-step-card"><p className="eyebrow">YOUR NEXT STEP</p><h2>{nextAssignment ? nextAssignment.assignment.title : nextTask ? nextTask.title : 'Keep your progress going.'}</h2><p>{nextAssignment ? (solo ? 'Put this week’s lessons into practice and check your work.' : 'Put this week’s lessons into practice, then discuss your work with the squad.') : nextTask ? 'Your next lesson is ready. Learn, practise, and check your understanding.' : 'Review your plan and see when the next step opens.'}</p><button className="primary" onClick={() => go(nextAssignment ? `${base}/assignments/${nextAssignment.week}` : nextTask ? lessonPath(nextTask) : `${base}/plan`)}>{nextAssignment ? 'Open assignment' : nextTask ? 'Continue learning' : 'Open learning plan'}</button></section>
      {!solo && <section className="panel"><p className="eyebrow">NEXT MEETING</p><h2>{nextMeeting ? dateText(nextMeeting.startsAt, zone) : 'No upcoming meetings'}</h2>{nextMeeting && <><p className="meeting-time">{timeText(nextMeeting.startsAt, zone)}–{timeText(nextMeeting.endsAt, zone)}</p><p>{nextMeeting.topic}</p><small className="muted">{zone} · 50 minutes</small><div className="card-action"><button onClick={() => setTab('meetings')}>Open meeting room</button></div></>}</section>}
      {!solo && <section className="panel"><div className="row"><h2>Your people</h2><span className="muted">{squad.memberCount} learners</span></div><ul className="member-list">{members.filter(m => m.active).map(m => <li key={m.id}><span className="member-name"><Avatar name={m.name} src={m.avatarUrl} size={36} />{m.name}{m.id === boot.user?.id ? ' (you)' : ''}</span></li>)}</ul><button onClick={() => setTab('chat')}>Open team chat{data.chatUnread > 0 ? ` (${data.chatUnread} new)` : ''}</button></section>}
      <section className="panel"><p className="eyebrow">YOUR PROGRESS</p><h2>{done} of {tasks.length} lessons</h2><progress value={done} max={tasks.length} aria-label="Lessons completed" /><p>{data.learningProgress?.assignmentsDone || 0} of 4 weekly assignments submitted.</p><button onClick={() => setTab('progress')}>See my progress</button></section>
    </div></>}
    {!solo && section === 'meetings' && <><div className="learning-intro"><h1>Meet with your squad.</h1><p>Practise together, compare your work, and plan your next step.</p></div>{nextMeeting && <section className="panel"><p className="eyebrow">NEXT MEETING · {dateText(nextMeeting.startsAt, zone, true)}</p><h2>{nextMeeting.topic}</h2><p>Join the video room right here. No Google account needed. Check your camera and microphone, then confirm you are ready.</p><button className="primary" disabled={!canEdit || !nextMeeting.readiness?.eligible} onClick={() => go(`${base}/room/${nextMeeting.id}`)}>Open video room</button><p className="muted card-action">After the call, you will return to your squad home.</p>{!squad.isDemo && <details className="meet-alternative"><summary>Use Google Meet instead</summary><MeetingReadiness access={meetingAccess} Modal={Modal} onManualLink={() => setMeeting(nextMeeting)} /></details>}</section>}<section className="panel"><h2>Your meeting schedule</h2><Schedule meetings={meetings} timezone={zone} /></section></>}
    {!solo && section === 'room' && <VideoRoom key={path.split('/')[4]} squadId={id} meetingId={path.split('/')[4]} api={api} onLeave={() => go(base)} />}
    <LearningWorkspace activeTab={tab} route={path.slice(base.length)} base={base} navigate={go} data={data} track={track} zone={zone} selfId={boot.user?.id} api={api} onSaved={load} aiAvailable={boot.aiAvailable} adapt={adapt} adapting={busy} working={working} />
    <TeamChat squadId={id} selfId={boot.user?.id} api={api} active={!solo && section === 'chat'} canSend={canEdit} isMember={data.isMember} />
    {section === 'settings' && <><div className="learning-intro"><h1>{solo ? 'Course settings' : 'Squad settings'}</h1><p>Your sprint details and membership.</p></div><section className="panel"><h2>Your sprint</h2><dl className="review-list"><dt>Team</dt><dd>{squad.name}</dd><dt>Course</dt><dd>{track?.title}</dd><dt>Dates</dt><dd>{dateText(squad.startDate, zone)} – {dateText(squad.endDate, zone)}</dd><dt>Time zone</dt><dd>{zone}</dd></dl><button onClick={async () => { try { await load(); await refreshBoot(); setNotice('Squad updated.'); } catch (e) { setError(e.message); } }}>Refresh squad details</button></section>{canEdit && <details className="panel membership-settings"><summary>Manage my membership</summary><p>Leaving frees your place. Your saved learning work stays in history; access to the team chat ends.</p><button className="text-button" onClick={() => setLeaving(true)}>{solo ? 'Leave this course' : 'Leave this squad'}</button></details>}</>}
    {!links.some(([key]) => key === section) && section !== 'room' && <section className="panel"><h1>Page not found</h1><button onClick={() => go(base)}>Back to squad home</button></section>}
    {leaving && <Modal title={solo ? 'Leave this course?' : 'Leave this squad?'} onClose={() => !busy && setLeaving(false)}><p>{solo ? 'Your course will move to read-only history. Your saved work remains available.' : 'You will give up your place. Your saved work remains in history. Before the first meeting, the squad may return to Forming if fewer than three learners remain.'}</p><div className="actions"><button onClick={() => setLeaving(false)} disabled={busy}>{solo ? 'Stay in my course' : 'Stay in my squad'}</button><button className="primary" disabled={busy} onClick={leave}>{busy ? 'Leaving…' : 'Confirm leave'}</button></div></Modal>}
    {meeting && <Modal title="Google Meet link" onClose={() => setMeeting(null)}><MeetingEditor squadId={id} meeting={meeting} onSaved={async () => { await load(); setMeeting(null); setNotice('Meeting link saved.'); }} /></Modal>}
  </div></div>;
}

function MeetLink({ meeting, editable, onEdit }) {
  const upcoming = new Date(meeting.endsAt).getTime() > Date.now();
  return <div className="meet-controls"><MeetingJoinLink meeting={meeting} />{!meeting.meetUrl && <p className="muted">{upcoming ? 'Meet opens when everyone is ready.' : 'No meeting link was saved.'}</p>}{editable && !meeting.readiness?.launchId && <button className="text-button" onClick={onEdit}>Use an existing Meet link</button>}</div>;
}

function MeetingEditor({ squadId, meeting, onSaved }) {
  const [url, setUrl] = useState(meeting.meetUrl || ''); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  return <form className="stack" onSubmit={async e => { e.preventDefault(); setBusy(true); setError(''); try { await api(`/squads/${squadId}/meetings/${meeting.id}`, 'PUT', { url }); await onSaved(); } catch (err) { setError(err.message); } finally { setBusy(false); } }}><p>{meeting.topic}</p><p>Create a meeting in Google Meet, then paste its real link. The person saving it is recorded as the organizer, not as an instructor.</p><a href="https://meet.google.com/" target="_blank" rel="noopener noreferrer">Open Google Meet</a><label>Google Meet URL<input type="url" disabled={busy} value={url} placeholder="https://meet.google.com/abc-defg-hij" maxLength={300} onChange={e => setUrl(e.target.value)} /></label><p className="muted">Leave the field empty to remove the link. Opening Meet does not record attendance.</p><Notice error>{error}</Notice><button className="primary" disabled={busy}>{busy ? 'Saving…' : 'Save meeting link'}</button></form>;
}

class ErrorBoundary extends React.Component {
  state = { error: false };
  static getDerivedStateFromError() { return { error: true }; }
  render() { return this.state.error ? <main><section className="panel"><h1>Something went wrong</h1><p>Your saved data is still on the server. Reload the page to continue.</p><button onClick={() => location.reload()}>Reload page</button></section></main> : this.props.children; }
}

createRoot(document.getElementById('root')).render(<ErrorBoundary><App /></ErrorBoundary>);
