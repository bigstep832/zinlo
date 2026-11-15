import React, { useEffect, useRef, useState } from 'react';
import { Avatar } from './avatar.jsx';
import { ArrowRight, Check, FlaskConical, ShieldCheck } from 'lucide-react';
import './squad-support.css';

export function DemoExperience({ api, refresh, go }) {
  const [result, setResult] = useState(null), [error, setError] = useState('');
  const busy = useRef(false), live = useRef(true);
  async function prepare() {
    if (busy.current) return; busy.current = true; setError('');
    try {
      await api('/session', 'POST', {});
      const [data] = await Promise.all([api('/demo/start', 'POST', {}), new Promise(resolve => setTimeout(resolve, 1200))]);
      if (!live.current) return;
      setResult(data); await refresh();
    } catch (e) { if (live.current) setError(e.message); }
    finally { busy.current = false; }
  }
  useEffect(() => { live.current = true; prepare(); return () => { live.current = false; }; }, []);
  return <section className="demo-experience"><span className="demo-label"><FlaskConical size={17} aria-hidden="true"/>Interactive demo</span>{result ? <><div className="match-check"><Check size={28} aria-hidden="true"/></div><h1>Your demo squad is ready.</h1><p>You and two simulated teammates. One device is all you need.</p><div className="match-people">{result.squad.members.map(person => <div key={person.id}><Avatar name={person.name} src={person.avatarUrl} size={80}/><strong>{person.name}</strong><small>{person.isDemo ? 'Simulated teammate' : 'You'}</small></div>)}</div><h2>{result.squad.name}</h2><button className="primary" onClick={() => go(`/squads/${result.squadId}`)}>Explore my demo squad <ArrowRight size={18} aria-hidden="true"/></button><p className="muted">Try lessons, chat, file sharing and the demo call. Sample teammates use scripted replies. Your real profile and squad stay separate.</p></> : <><div className="match-orbit" aria-hidden="true"><div className="orbit-ring ring-one"/><div className="orbit-ring ring-two"/><div className="orbit-core"><FlaskConical size={42}/></div><span className="orbit-dot dot-one"/><span className="orbit-dot dot-two"/></div><h1 role="status">{error ? 'Let’s try again.' : 'Preparing your demo squad…'}</h1><p>Creating a private sample team, without waiting for real learners.</p></>}{error && <div className="notice error" role="alert">{error}<button onClick={prepare}>Retry demo</button></div>}<button className="text-button" onClick={() => go('/')}>Back to Zinlo</button></section>;
}

export function DemoGuide({ squad, api, reload, refresh, go }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function action(remaining) {
    setBusy(true); setError('');
    try {
      if (remaining) { await api(`/squads/${squad.id}/demo-scenario`, 'POST', { remaining }); await reload(); }
      else { const result = await api('/demo/start', 'POST', { trackId: squad.trackId, restart: true }); await refresh(); go(`/squads/${result.squadId}`); }
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  return <aside className="demo-guide"><div><span className="demo-label"><FlaskConical size={16} aria-hidden="true"/>Demo squad</span><p>{squad.learningMode === 'solo' ? 'This is your independent demo course. Your real enrollments stay separate.' : 'Maya and Sam are simulated. Chat replies are scripted; the demo call previews your camera with sample teammates. Real squads have real chat and video calls.'}</p></div><details><summary>Try a team change</summary><p>These controls affect this demo only.</p><div className="actions">{squad.learningMode !== 'solo' && <><button disabled={busy || squad.memberCount <= 2 || squad.status === 'closed'} onClick={() => action(2)}>One teammate leaves</button><button disabled={busy || squad.memberCount <= 1 || squad.status === 'closed'} onClick={() => action(1)}>Both teammates leave</button></>}<button disabled={busy} onClick={() => action(null)}>Restart demo</button></div></details>{error && <p role="alert" className="notice error">{error}</p>}</aside>;
}

const CHOICES = { duo: ['Continue as a pair', 'Both remaining learners must agree. Keep your schedule and study together.'], solo: ['Continue independently', 'Keep your saved work, quizzes and original weekly release dates. No additional payment.'], rematch: ['Find another squad', 'Search for a real compatible team. Your work stays in history; equivalent lesson results carry over when matched.'], refund: ['Close my place and record a refund', 'Your course moves to read-only history. We calculate the unused portion and record a demo refund. No money is transferred.'] };
export function RecoveryPanel({ squadId, info, api, refresh, go, isDemo = false }) {
  const [choice, setChoice] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  if (!info) return null;
  const choices = isDemo ? { ...CHOICES, rematch: ['Create another demo squad', 'Try a fresh sample team with two simulated learners. Your real courses stay unchanged.'] } : CHOICES;
  async function confirm() {
    setBusy(true); setError('');
    try { const result = await api(`/squads/${squadId}/recovery`, 'POST', { caseId: info.id, choice }); await refresh(); setChoice(null); go(result.squadId ? `/squads/${result.squadId}` : result.searching ? '/matches' : `/squads/${squadId}`); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  if (info.refund) return <section className="panel recovery-panel"><p className="eyebrow">DEMO REFUND RECORDED</p><h2>Your demo refund is recorded.</h2><p>{info.remainingMeetings} of {info.totalMeetings} scheduled meetings had not started when the team changed: <strong>{Math.round(info.fraction * 1000) / 10}%</strong> of the course price.</p><p>Amount charged: $0 · Refund amount: $0. Payments are not connected; no money was transferred. Your saved work remains in history.</p></section>;
  if (!info.canChoose) return info.choice === 'duo' && info.state === 'resolved' ? <p className="notice">You both agreed to continue as a pair. Your schedule and work are unchanged.</p> : null;
  return <section className="panel recovery-panel"><p className="eyebrow">YOUR SQUAD HAS CHANGED</p><h2>{info.choice === 'rematch' ? 'Looking for your next squad.' : 'Choose what works for you.'}</h2><p>Your saved work is safe. Choose by {new Date(info.deadlineAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}. If no format is agreed by then, the affected squad closes and remaining learners receive a demo refund for the unused portion.</p>{info.choice === 'duo' && <p role="status">Your choice is saved. Waiting for the other learner to agree.</p>}<div className="recovery-options">{Object.entries(choices).filter(([key]) => key !== 'duo' || info.canDuo).map(([key, [title, description]]) => <button key={key} disabled={busy || info.choice === key && key === 'duo'} onClick={() => { setChoice(key); setError(''); }}><strong>{title}</strong><span>{description}</span></button>)}</div>{choice && <div className="recovery-confirm" role="group" aria-label="Confirm your choice"><h3>{choices[choice][0]}?</h3><p>{choices[choice][1]}</p>{choice === 'refund' && <p>Unused portion: {info.remainingMeetings}/{info.totalMeetings} meetings ({Math.round(info.fraction * 1000) / 10}%). Today’s payment and refund are both $0.</p>}<div className="actions"><button className="primary" disabled={busy} onClick={confirm}>{busy ? 'Saving…' : 'Confirm my choice'}</button><button disabled={busy} onClick={() => setChoice(null)}>Cancel</button></div></div>}{error && <p className="notice error" role="alert">{error}</p>}</section>;
}
export function ProfileGuidelines() { return <aside className="profile-guidelines"><ShieldCheck size={20} aria-hidden="true"/><div><strong>A good teammate starts with respect.</strong><p>No insults, harassment or spam. Choose times you can attend and let your squad know if your plans change.</p></div></aside>; }
