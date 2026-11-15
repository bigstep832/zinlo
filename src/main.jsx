import React, { useState, useEffect, useRef, useId, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { MeetingReadiness, MeetingJoinLink, MeetingWaitingRoom, useMeetingAccess } from './meeting-access.jsx';
import { LearningWorkspace } from './learning-plan.jsx';
import './styles.css';

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
  useEffect(() => { refresh().then(data => { if (initial.current && location.pathname === '/') { if (data.matchmaking?.status === 'waiting') go('/matches', true); else if (data.currentSquadId) go(`/squads/${data.currentSquadId}`, true); } initial.current = false; }).catch(e => setError(e.message)); }, []);
  useEffect(() => { document.title = `${path === '/' ? 'Learn together' : path === '/start' ? 'Find your squad' : path === '/matches' ? 'Find my teammates' : 'Your squad'} · Learning Squads`; }, [path]);
  async function start(trackId) {
    setBusy(true); setError('');
    try { const data = await api('/session', 'POST', {}); setBoot({ ...data, selectedTrack: trackId }); go(data.matchmaking?.status === 'waiting' ? '/matches' : data.currentSquadId ? `/squads/${data.currentSquadId}` : '/start'); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  const trackName = id => findTrack(boot, id)?.title || id;
  return <><a className="skip-link" href="#main">Skip to content</a><header><div className="header-inner"><a className="brand" href="/" onClick={e => { e.preventDefault(); go('/'); }}>Learning Squads</a><nav aria-label="Main navigation">{boot?.matchmaking?.status === 'waiting' && <a href="/matches" onClick={e => { e.preventDefault(); go('/matches'); }}>My search</a>}{boot?.currentSquadId && <a href={`/squads/${boot.currentSquadId}`} onClick={e => { e.preventDefault(); go(`/squads/${boot.currentSquadId}`); }}>My squad</a>}{boot?.user ? <><button className="text-button" onClick={() => setDialog('history')}>History</button><button onClick={() => setDialog('profile')}>{boot.user.name || 'Guest'} · Profile</button></> : <button disabled={busy || !boot} onClick={() => start()}>Find my squad</button>}</nav></div></header>
    <main id="main"><Notice error>{error}</Notice>{!boot ? error ? <button onClick={() => { setError(''); refresh().catch(e => setError(e.message)); }}>Retry connection</button> : <Loading>Connecting to Learning Squads…</Loading> : path === '/' ? <Home tracks={boot.tracks} start={start} busy={busy} /> : path === '/start' ? <Onboarding boot={boot} onSaved={async ({ startSearch } = {}) => { if (startSearch) await api('/matchmaking', 'POST', {}); const data = await refresh(); go(startSearch ? '/matches' : data.currentSquadId ? `/squads/${data.currentSquadId}` : '/matches'); }} createSession={async () => { const data = await api('/session', 'POST', {}); setBoot(data); }} /> : path === '/matches' ? <Matches boot={boot} go={go} refresh={refresh} /> : /^\/squads\/[^/]+\/meetings\/[^/]+\/wait$/.test(path) ? <Dashboard key={path} id={path.split('/')[2]} waitingMeetingId={path.split('/')[4]} boot={boot} refreshBoot={refresh} go={go} /> : /^\/squads\/[^/]+$/.test(path) ? <Dashboard key={path} id={path.split('/')[2]} boot={boot} refreshBoot={refresh} go={go} /> : <section className="panel"><h1>Page not found</h1><button onClick={() => go('/')}>Go home</button></section>}</main>
    <footer><span>Learning Squads · Four weeks, one useful skill.</span><span>Peer learning. No instructor. No automatic renewal.</span></footer>
    {dialog === 'profile' && <Modal title="Your profile" onClose={() => setDialog(null)}><ProfileForm boot={boot} editing onSaved={async () => { const data = await refresh(); setDialog(null); if (path === '/matches') { go('/start'); go('/matches'); } else if (path.startsWith('/squads/') && !data.currentSquadId) go('/matches'); }} /></Modal>}
    {dialog === 'history' && <Modal title="Sprint history" onClose={() => setDialog(null)}>{boot.history?.length ? <div className="stack">{boot.history.map(s => <article className="panel" key={s.id}><div className="row"><h3>{s.name || trackName(s.trackId)}</h3><Badge status={s.status} /></div><p>{dateText(s.startDate, boot.user?.timezone)} – {dateText(s.endDate, boot.user?.timezone)}</p><button onClick={() => go(`/squads/${s.id}`)}>Open sprint</button></article>)}</div> : <p>Your completed, closed and previous sprints will appear here.</p>}<p className="muted">History stays with this browser’s guest session.</p></Modal>}
  </>;
}

function Home({ tracks, start, busy }) {
  return <>
    <section className="hero">
      <p className="eyebrow">A small team. A shared schedule. A useful skill.</p>
      <h1>Find your squad.<br />Learn something useful.</h1>
      <p className="lead">Choose a skill for work or everyday life. Learn with people at your level who can meet at the same time, following a practical four-week plan.</p>
      <button className="primary" disabled={busy} onClick={() => start()}>{busy ? 'Starting your guest session…' : 'Find my squad'}</button>
      <p className="muted">No account, email or card needed. Free to try this MVP.</p>
    </section>
    <section aria-labelledby="format-title">
      <h2 id="format-title">A clear plan for four weeks</h2>
      <div className="grid four">
        <div className="panel"><strong>3–4 learners</strong><p>A small peer group learning the same course at the same level.</p></div>
        <div className="panel"><strong>8 meetings</strong><p>Twice a week, 50 minutes within an agreed hour.</p></div>
        <div className="panel"><strong>2 practice hours</strong><p>Plan for about two additional hours on your own each week.</p></div>
        <div className="panel"><strong>A practical outcome</strong><p>Try useful tasks, compare examples, and show what you learned.</p></div>
      </div>
    </section>
    <section aria-labelledby="tracks-title">
      <h2 id="tracks-title">Choose what you want to learn</h2>
      <div className="grid three">{tracks.map(track => <article className="panel track-card" key={track.id}>
        {track.category && <p className="eyebrow">{track.category}</p>}
        <h3>{track.title}</h3><p>{track.description}</p>
        <p><strong>Your outcome:</strong> {track.project}</p>
        <p className="muted">{track.prerequisite || 'Start with the level that fits your experience.'}</p>
        <details><summary>Preview the four-week plan</summary><ol className="plan-preview">{track.weeks?.map(week => <li key={week.week}><strong>Week {week.week}: {week.title}</strong><p>{week.summary || `${week.lessonCount || 2} lessons`}</p></li>)}</ol></details>
        <button disabled={busy} onClick={() => start(track.id)}>Choose {track.shortTitle || track.title}</button>
      </article>)}</div>
    </section>
    <section className="panel price-block"><div><p className="eyebrow">One sprint at a time</p><h2>$29 per four-week sprint</h2><p>Proposed launch price: your squad, eight meetings, a study plan and a place to save results. No instructor or automatic renewal.</p><p><strong>This MVP is free. No payment is collected.</strong></p></div><button className="primary" disabled={busy} onClick={() => start()}>Find my squad</button></section>
    <section className="panel"><h2>How guest access works</h2><p>Your profile and progress are saved on the server. This browser keeps the private cookie that gives you access. Come back in the same browser to continue.</p><p className="muted">Clearing cookies, using private browsing after closing the session, or switching devices can lose access. Account recovery is not available in this version.</p></section>
  </>;
}

function Onboarding({ boot, onSaved, createSession }) {
  const [error, setError] = useState(''); const requested = useRef(false);
  useEffect(() => { if (!boot.user && !requested.current) { requested.current = true; createSession().catch(e => setError(e.message)); } }, [boot.user]);
  if (!boot.user) return <><Notice error>{error}</Notice>{error ? <button onClick={() => { setError(''); createSession().catch(e => setError(e.message)); }}>Start guest session</button> : <Loading>Starting your private guest session…</Loading>}</>;
  return <div className="narrow"><p className="eyebrow">Find your squad</p><h1>Make room for your next skill.</h1><p className="lead">Tell us what you want to learn and when you can meet.</p><ProfileForm boot={boot} onSaved={onSaved} /></div>;
}

function ProfileForm({ boot, editing = false, onSaved }) {
  const [form, setForm] = useState(() => ({ name: boot.user?.name || '', trackId: (boot.currentSquadId ? boot.user?.trackId : boot.selectedTrack || boot.user?.trackId) || boot.tracks[0]?.id || '', level: boot.user?.level || 'beginner', timezone: boot.user?.trackId ? boot.user.timezone : detectedZone, availability: boot.user?.availability?.length ? boot.user.availability : [{ day: 2, start: '19:00', end: '22:00' }, { day: 4, start: '19:00', end: '22:00' }] }));
  const [step, setStep] = useState(0); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [conflict, setConflict] = useState(false);
  const track = findTrack(boot, form.trackId); const current = !!boot.currentSquadId;
  const archived = !boot.tracks.some(item => item.id === form.trackId);
  const levels = trackLevels(track);
  const update = (key, value) => {
    setForm(f => {
      const next = { ...f, [key]: value };
      if (key === 'trackId') { const options = trackLevels(findTrack(boot, value)); if (!options.some(option => option.id === f.level)) next.level = options[0].id; }
      return next;
    });
    setConflict(false); setError('');
  };
  function validate(part) {
    if ((part === 0 || part === 'all') && !form.name.trim()) return 'Enter a name or nickname.';
    if ((part === 0 || part === 'all') && (!track || archived && !current)) return 'This course is archived. Choose an available course before starting a new search.';
    if ((part === 1 || part === 'all') && !levels.some(level => level.id === form.level)) return 'Choose a starting level for this course.';
    if (part === 2 || part === 'all') {
      try { new Intl.DateTimeFormat('en', { timeZone: form.timezone }); } catch { return 'Choose a valid named time zone from the list.'; }
      if (form.availability.some(a => minute(a.end) <= minute(a.start))) return 'Every availability interval must end after it starts.';
      if (new Set(availableSlots(form.availability).map(s => s.day)).size < 2) return 'Add at least one full hour on two different days.';
    }
    return '';
  }
  async function save(confirmConflict = false, leave = false) {
    const issue = validate('all'); if (issue) { setError(issue); return; }
    if (leave && archived) { setError('Leave this archived squad from its workspace, then choose a current course before saving a new profile.'); return; }
    setBusy(true); setError('');
    try {
      if (leave) await api(`/squads/${boot.currentSquadId}/leave`, 'POST', {});
      await api('/profile', 'PUT', { ...form, confirmConflict });
      await onSaved({ startSearch: !editing && !current });
    } catch (e) { setError(e.message); if (e.code === 'schedule_conflict') setConflict(true); }
    finally { setBusy(false); }
  }
  const advance = () => { const issue = validate(step); if (issue) return setError(issue); setError(''); setStep(s => s + 1); };
  const visible = s => editing || step === s;
  if (busy && !editing && step === 3 && !current) return <section className="panel search-panel" aria-busy="true"><div className="search-status" role="status" aria-live="polite"><span className="search-spinner" aria-hidden="true" /><h2>Finding your teammates…</h2></div><p>Saving your preferences and checking for learners with a compatible course, level and schedule.</p><p className="muted">We will show your real teammates when a match is found, or keep your search open while more learners join.</p></section>;
  return <form className={editing ? 'stack' : 'panel stack'} onSubmit={e => { e.preventDefault(); if (!editing && step < 3) advance(); else save(); }}>
    {editing && boot.matchmaking?.status === 'waiting' && <Notice>Saving profile changes cancels your current search. Start a new search with your updated preferences when you are ready.</Notice>}
    {!editing && <ol className="steps" aria-label="Setup progress">{['Profile', 'Preparation', 'Availability', 'Review'].map((name, i) => <li key={name} aria-current={step === i ? 'step' : undefined}><span>{i + 1}</span>{name}</li>)}</ol>}
    {visible(0) && <fieldset disabled={busy}>
      <legend>{editing ? 'Profile and course' : '1. Your profile and direction'}</legend>
      <label>Name or nickname<input value={form.name} maxLength={60} autoComplete="nickname" onChange={e => update('name', e.target.value)} required /></label>
      <label>Learning course<select value={form.trackId} disabled={current} onChange={e => update('trackId', e.target.value)}>
        {archived && <option value={form.trackId} disabled>{track?.title || form.trackId} (archived)</option>}
        {boot.tracks.map(course => <option key={course.id} value={course.id}>{course.title}</option>)}
      </select></label>
      {archived && <Notice>{current ? 'This course is archived for new learners. Your existing squad, study plan and results remain available.' : 'Your previous course is archived. Choose an available course above to start a new search; your history is preserved.'}</Notice>}
      <p><strong>Your outcome:</strong> {track?.project}</p>
      {track?.prerequisite && <p className="muted">{track.prerequisite}</p>}
      {current && <p className="muted">Your current squad fixes the course and level. You can choose a new course after leaving or finishing this sprint.</p>}
    </fieldset>}
    {visible(1) && <fieldset disabled={busy}>
      <legend>{editing ? 'Preparation' : '2. Your starting point'}</legend>
      {levels.map(level => <label className="choice" key={level.id}>
        <input type="radio" name="level" value={level.id} checked={form.level === level.id} disabled={current} onChange={() => update('level', level.id)} />
        <span><strong>{level.title}</strong><small>{level.description}</small></span>
      </label>)}
      <p className="muted">This is your own assessment, not an entrance exam. We match you with learners at the same starting level.</p>
      {track?.starterUrl && <p>A prepared starter is included with your existing course.</p>}
    </fieldset>}
    {visible(2) && <fieldset disabled={busy}><legend>{editing ? 'Availability' : '3. When can you meet?'}</legend><Availability form={form} update={update} /><p className="muted">Choose all the time you could attend, not a commitment to every hour. Availability repeats for four weeks. We check all eight dates before matching.</p></fieldset>}
    {visible(3) && !editing && <fieldset><legend>4. Review your preferences</legend><dl className="review-list"><dt>Name</dt><dd>{form.name}</dd><dt>Course</dt><dd>{track?.title}</dd><dt>Outcome</dt><dd>{track?.project}</dd><dt>Level</dt><dd>{levelTitle(track, form.level)}</dd><dt>Time zone</dt><dd>{form.timezone}</dd><dt>Available times</dt><dd>{form.availability.map((a, i) => <div key={i}>{DAYS[a.day - 1]} · {a.start}–{a.end}</div>)}</dd></dl><p>Four weeks · 3–4 learners · two 50-minute meetings each week · about two hours of independent practice.</p><p>We will automatically form a squad of 3–4 learners with the same track and level, and choose two weekly windows within your availability. All eight meetings must fit everyone. Your place is reserved and the full schedule appears when a match is found.</p><Notice>No payment is collected in this MVP. Only one unfinished sprint at a time.</Notice><p className="muted">Your guest access stays in this browser. Clearing cookies or switching devices loses access; recovery is not yet available.</p></fieldset>}
    <Notice error>{error}</Notice>
    {conflict && <div className="panel"><h3>Your new availability conflicts with this squad</h3><p>The squad’s meeting times will stay the same. You can keep your existing commitment{archived ? '.' : ', or leave the squad and save your new availability.'}</p>{archived && <p>This course is archived. To switch courses, close this profile, leave from the squad workspace, then choose a current course.</p>}<div className="actions"><button type="button" disabled={busy} onClick={() => save(true)}>Save and keep my commitment</button>{!archived && <button type="button" disabled={busy} onClick={() => save(false, true)}>Leave squad and save</button>}</div></div>}
    <div className={`actions ${!editing && step === 3 ? 'final-search-action' : ''}`}>{!editing && step > 0 && <button type="button" disabled={busy} onClick={() => { setStep(s => s - 1); setError(''); }}>Back</button>}<button className={`primary ${!editing && step === 3 ? 'find-teammates-button' : ''}`} disabled={busy}>{busy && !editing && step === 3 && <span className="search-spinner small" aria-hidden="true" />}{busy ? (!editing && step === 3 ? 'Starting your search…' : 'Saving…') : editing ? 'Save profile' : step === 3 ? (current ? 'Save and open my squad' : 'Find my teammates') : 'Continue'}</button></div>
  </form>;
}

function Availability({ form, update }) {
  const timezoneListId = useId();
  const change = (index, field, value) => update('availability', form.availability.map((a, i) => i === index ? { ...a, [field]: value } : a));
  return <><label>Time zone<input list={timezoneListId} value={form.timezone} onChange={e => update('timezone', e.target.value)} spellCheck="false" required /><datalist id={timezoneListId}>{ZONES.map(zone => <option key={zone} value={zone} />)}</datalist></label><div className="intervals">{form.availability.map((a, i) => <div className="interval" key={i}><label>Day<select value={a.day} onChange={e => change(i, 'day', Number(e.target.value))}>{DAYS.map((day, j) => <option key={day} value={j + 1}>{day}</option>)}</select></label><label>From<select value={a.start} onChange={e => change(i, 'start', e.target.value)}>{TIMES.slice(0, -1).map(t => <option key={t}>{t}</option>)}</select></label><label>Until<select value={a.end} onChange={e => change(i, 'end', e.target.value)}>{TIMES.slice(1).map(t => <option key={t}>{t}</option>)}</select></label><button type="button" aria-label={`Remove availability interval ${i + 1}`} onClick={() => update('availability', form.availability.filter((_, j) => j !== i))}>Remove</button></div>)}</div><button type="button" onClick={() => update('availability', [...form.availability, { day: 6, start: '10:00', end: '12:00' }])}>Add available interval</button></>;
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
  const [search, setSearch] = useState(null); const [error, setError] = useState('');
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
    stateRef.current = null; setSearch(null); setError(''); setCancelled(false);
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
  return <div className="narrow"><div className="page-heading"><div><p className="eyebrow">Automatic team matching</p><h1>{matched ? 'Meet your teammates.' : 'Find your teammates.'}</h1><p>{track?.title} · {levelTitle(track, boot.user.level)} · {boot.user.timezone}</p></div></div>
    <Notice error>{error && <>{error}{waiting && <p>Your search may still be active. Retry to check its current status.</p>}</>}</Notice>
    {!search ? error ? <button disabled={requestBusy} onClick={checkStatus}>Retry search status</button> : <Loading>Checking your search…</Loading> : matched ? <section className="panel matched-team"><p className="eyebrow">Your place is reserved</p><h2>{squad.name}</h2><p>These learners share your course and level. All eight meeting windows fit everyone’s availability.</p><ul className="teammate-list">{squad.members.map(member => <li key={member.id}><strong>{member.name}</strong>{member.id === boot.user.id && <span className="muted">You</span>}</li>)}</ul><p><strong>Your outcome:</strong> {track?.project}</p><Schedule meetings={squad.meetings} timezone={boot.user.timezone} /><button className="primary find-teammates-button" onClick={() => go(`/squads/${search.squadId}`)}>Open my squad</button><p className="muted search-footnote">Your study plan, meeting links and progress are in the squad workspace. You can leave there if your plans change.</p></section> : waiting ? <section className="panel search-panel"><div className="search-status" role="status" aria-live="polite">{!error && <span className="search-spinner" aria-hidden="true" />}<h2>{error ? 'Search connection interrupted' : 'Looking for your teammates…'}</h2></div><p>We are checking real learners who are searching for the same course and level, with a schedule that fits all eight meetings.</p><p><strong>Your team needs at least three compatible learners.</strong> If there aren’t enough yet, the search stays open. We’ll show your teammates as soon as your squad is formed.</p><p className="muted">Keep this tab open and visible. The search pauses after two minutes in the background or without a connection. Refreshing this page restores its current status.</p>{error && <button disabled={requestBusy} onClick={() => request('POST', '/matchmaking/poll', true)}>Retry connection</button>}<div className="actions"><button disabled={requestBusy} onClick={() => cancel(false)}>Cancel search</button><button disabled={requestBusy} onClick={() => cancel(true)}>Edit preferences</button></div></section> : <section className="panel search-panel"><h2>{search.status === 'expired' ? 'Your search paused' : cancelled ? 'Search cancelled' : 'Ready to find your teammates?'}</h2><p>{search.status === 'expired' ? 'The page was inactive or disconnected for more than two minutes. Start again when you are ready to look for a team.' : cancelled ? 'You are no longer waiting for a match. Your profile and availability are saved.' : 'We will assemble a real team for you when at least three compatible learners are searching. There is no squad list to choose from.'}</p><p className="muted">Matching uses your course, level and all eight meeting windows. A place is reserved automatically when your team is found.</p><div className="actions"><button disabled={requestBusy} onClick={() => go('/start')}>Edit preferences</button><button className="primary find-teammates-button" disabled={requestBusy} onClick={begin}>{requestBusy ? 'Starting your search…' : 'Find my teammates'}</button></div></section>}
    {error && search && !waiting && <button disabled={requestBusy} onClick={checkStatus}>Retry search status</button>}
  </div>;
}

function Dashboard({ id, boot, refreshBoot, go, waitingMeetingId = null }) {
  const [data, setData] = useState(null); const [tab, setTab] = useState('overview'); const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const [busy, setBusy] = useState(false); const [leaving, setLeaving] = useState(false); const [meeting, setMeeting] = useState(null);
  const [pollError, setPollError] = useState('');
  const [receivedAt, setReceivedAt] = useState(0);
  const [planRequest, setPlanRequest] = useState(null);
  const bootRef = useRef(boot); bootRef.current = boot;
  const refreshRef = useRef(refreshBoot); refreshRef.current = refreshBoot;
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
      if ((!result.isMember || ['closed', 'completed'].includes(result.squad.status)) && bootRef.current.currentSquadId === id) await refreshRef.current();
      return result;
    } catch (err) { if (!controller.signal.aborted) throw err; return dataRef.current; }
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
  const meetingAccess = useMeetingAccess({ squadId: id, data, receivedAt, change, suspended: busy || leaving, waitingMeetingId });
  async function leave() { setBusy(true); setError(''); try { await api(`/squads/${id}/leave`, 'POST', {}); await refreshBoot(); go('/matches'); } catch (e) { setError(e.message); setLeaving(false); } finally { setBusy(false); } }
  async function adapt() { setBusy(true); setError(''); setNotice(''); try { const result = await api(`/squads/${id}/adapt`, 'POST', {}); setNotice(result.message || (result.source === 'ai' ? 'Your adapted plan has been saved.' : 'The base plan is still available.')); await load(); } catch (e) { setError(e.message); } finally { setBusy(false); } }
  if (!data) return <><Notice error>{error}</Notice>{error ? <div className="actions"><button onClick={() => { setError(''); load().catch(e => setError(e.message)); }}>Retry</button><button onClick={() => go('/')}>Go home</button></div> : <Loading>Loading your squad…</Loading>}</>;
  const { squad, plan, meetings, members, progress, canEdit } = data;
  const zone = boot.user?.timezone || detectedZone; const track = findTrack(boot, squad.trackId);
  if (waitingMeetingId) return <><Notice error>{pollError}</Notice><MeetingWaitingRoom access={meetingAccess} Modal={Modal} onBack={() => go(`/squads/${id}`)} timeLabel={meetingAccess.nextMeeting ? dateText(meetingAccess.nextMeeting.startsAt, zone, true) : ''} /></>;
  const tasks = plan.weeks.flatMap(w => w.tasks); const done = progress.filter(p => p.status === 'done').length;
  const nextMeeting = meetings.find(m => new Date(m.endsAt).getTime() > Date.now()); const nextTask = tasks.find(task => task.id === data.learningProgress?.nextAvailableTaskId && task.access?.unlocked);
  const working = progress.some(p => p.status !== 'not_started' || p.note || p.url) || data.teamProgress?.some(p => p.results?.some(r => r.status !== 'not_started' || r.note || r.url));
  return <><div className="page-heading"><div><p className="eyebrow">{track?.title} · {levelTitle(track, squad.level)}</p><h1>{squad.name || 'Your learning squad'}</h1><p>{dateText(squad.startDate, zone)} – {dateText(squad.endDate, zone)} · {zone}</p></div><Badge status={squad.status} /></div><Notice error>{error}</Notice><Notice error>{pollError}</Notice><Notice>{notice}</Notice>{squad.status === 'forming' && <Notice>Recruitment is open: {squad.memberCount} of 4 learners. Your squad needs at least 3 learners by the first meeting. You can start preparing now.</Notice>}{squad.status === 'ready' && <Notice>Your squad has enough learners to start. Check the dates and prepare for your first meeting.</Notice>}{squad.status === 'closed' && <Notice>This squad closed without starting. Your saved work is still here. <button className="text-button" onClick={() => go('/matches')}>Find another squad</button></Notice>}{squad.status === 'completed' && <Notice>The four-week sprint has ended. Task completion reflects your own reports; it does not certify a skill. Your history and results remain available.</Notice>}{!canEdit && !['completed', 'closed'].includes(squad.status) && <Notice>You are viewing a previous squad. Your saved work remains available in read-only mode.</Notice>}
    <div className="tabs" role="tablist" aria-label="Squad sections">{['overview', 'plan', 'progress'].map((t, index) => <button key={t} id={`tab-${t}`} role="tab" tabIndex={tab === t ? 0 : -1} aria-selected={tab === t} aria-controls={`panel-${t}`} onKeyDown={e => { const options = ['overview', 'plan', 'progress']; const next = e.key === 'ArrowRight' ? (index + 1) % 3 : e.key === 'ArrowLeft' ? (index + 2) % 3 : e.key === 'Home' ? 0 : e.key === 'End' ? 2 : null; if (next !== null) { e.preventDefault(); setTab(options[next]); document.getElementById(`tab-${options[next]}`)?.focus(); } }} onClick={() => { setTab(t); setNotice(''); }}>{t[0].toUpperCase() + t.slice(1)}</button>)}<button className="refresh" onClick={async () => { setError(''); try { await load(); await refreshBoot(); setNotice('Squad updated.'); } catch (e) { setError(e.message); } }}>Refresh</button></div>
    <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
    {tab === 'overview' && <><div className="grid overview-grid"><section className="panel"><p className="eyebrow">Your next step</p><h2>{nextMeeting ? 'Your next meeting' : 'No upcoming meetings'}</h2>{nextMeeting ? <><p className="lead">{dateText(nextMeeting.startsAt, zone, true)}</p><h3>{nextMeeting.topic}</h3><p>{timeText(nextMeeting.startsAt, zone)}–{timeText(nextMeeting.endsAt, zone)} · 50 minutes</p><MeetingReadiness access={meetingAccess} Modal={Modal} onManualLink={() => setMeeting(nextMeeting)} /></> : <p>Your saved plan and results are available in the other tabs.</p>}{nextTask && <div className="next-task"><h3>Your next lesson</h3><p>{nextTask.title}</p><p className="muted">{nextTask.description}</p><button onClick={() => { setPlanRequest({ taskId: nextTask.id, version: Date.now() }); setTab('plan'); }}>Continue learning</button></div>}<p className="muted">Meeting format: 5 minutes on blockers, 35 minutes of practice, 10 minutes to share results and next steps.</p></section><aside className="panel"><h2>Your squad</h2><p>{squad.memberCount} of 4 active learners</p><ul className="member-list">{members.map(m => <li key={m.id}><span>{m.name}{m.isSelf || m.id === boot.user?.id ? ' (you)' : ''}</span>{!m.active && <span className="muted">Left squad</span>}</li>)}</ul><h3>Shared goal</h3><p>{track?.project}</p><p className="muted">Work toward your own result and practice together. A missed meeting does not block anyone else’s progress.</p><p><strong>{done} of {tasks.length} tasks done</strong></p><button onClick={() => setTab('progress')}>View my progress</button></aside></div><section className="panel"><h2>All eight meetings</h2><p className="muted">Times in {zone}. Reserve the full hour shown. The actual meeting lasts 50 minutes.</p><div className="meeting-list">{meetings.map((m, i) => <article key={m.id}><div><p className="eyebrow">Meeting {i + 1} · Week {m.week}</p><h3>{m.topic}</h3><p>{dateText(m.startsAt, zone)} · {timeText(m.startsAt, zone)}–{timeText(m.windowEndsAt || m.endsAt, zone)}</p></div><MeetLink meeting={m} editable={canEdit} onEdit={() => setMeeting(m)} /></article>)}</div></section></>}
    <LearningWorkspace activeTab={tab} data={data} track={track} zone={zone} selfId={boot.user?.id} request={planRequest} openPlan={() => setTab('plan')} api={api} onSaved={load} aiAvailable={boot.aiAvailable} adapt={adapt} adapting={busy} working={working} />
    </div>
    {canEdit && <section className="panel row"><div><h2>Need to step away?</h2><p className="muted">Leaving preserves your work and the rest of the squad’s progress.</p></div><button onClick={() => setLeaving(true)}>Leave squad</button></section>}
    {leaving && <Modal title="Leave this squad?" onClose={() => !busy && setLeaving(false)}><p>You will give up your place. Your saved work remains in history. Before the first meeting, the squad may return to Forming if fewer than three learners remain.</p><div className="actions"><button onClick={() => setLeaving(false)} disabled={busy}>Stay in my squad</button><button className="primary" disabled={busy} onClick={leave}>{busy ? 'Leaving…' : 'Confirm leave'}</button></div></Modal>}
    {meeting && <Modal title="Google Meet link" onClose={() => setMeeting(null)}><MeetingEditor squadId={id} meeting={meeting} onSaved={async () => { await load(); setMeeting(null); setNotice('Meeting link saved.'); }} /></Modal>}
  </>;
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
