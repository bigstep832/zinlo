import React, { useCallback, useEffect, useRef, useState } from 'react';

function validMeetUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'meet.google.com' && !url.port && !url.username && !url.password && /^\/[a-z]{3}-[a-z]{4}-[a-z]{3}\/?$/.test(url.pathname);
  } catch { return false; }
}

const waitingKey = (squadId, meetingId) => `learning-squads:meet-window:v1:${squadId}:${meetingId}`;
const waitingPath = (squadId, meetingId) => `/squads/${encodeURIComponent(squadId)}/meetings/${encodeURIComponent(meetingId)}/wait`;

export function useMeetingAccess({ squadId, data, receivedAt, change, suspended = false, waitingMeetingId = null }) {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [opening, setOpening] = useState('');
  const [visible, setVisible] = useState(document.visibilityState === 'visible');
  const [visibleSince, setVisibleSince] = useState(Date.now());
  const [windowAttempt, setWindowAttempt] = useState(() => waitingMeetingId ? new URLSearchParams(location.hash.slice(1)).get('attempt') : null);
  const [currentAttempt, setCurrentAttempt] = useState(null);
  const [windowNotice, setWindowNotice] = useState('');
  const ownedAttempt = useRef(windowAttempt);
  const mounted = useRef(true);
  const attempted = useRef(new Set());
  const navigated = useRef(new Set());
  const nearest = data?.meetings.find(meeting => new Date(meeting.endsAt).getTime() > Date.now());
  const nextMeeting = waitingMeetingId ? data?.meetings.find(meeting => meeting.id === waitingMeetingId) : nearest;
  const readiness = nextMeeting?.readiness;
  const enabled = !!(data?.isMember && data.canEdit && readiness?.eligible && nextMeeting?.id === nearest?.id);
  const meetingId = nextMeeting?.id;
  const fresh = receivedAt >= visibleSince;
  const waitingWindow = !!waitingMeetingId;
  const windowAuthorized = !waitingWindow || !!windowAttempt && windowAttempt === currentAttempt;

  useEffect(() => {
    if (!meetingId) return;
    const key = waitingKey(squadId, meetingId);
    const readAttempt = () => { try { setCurrentAttempt(localStorage.getItem(key)); } catch { setCurrentAttempt(null); } };
    const onStorage = event => { if (!event.key || event.key === key) readAttempt(); };
    readAttempt();
    window.addEventListener('storage', onStorage);
    if (waitingWindow) window.opener = null;
    return () => window.removeEventListener('storage', onStorage);
  }, [squadId, meetingId, waitingWindow]);

  useEffect(() => {
    mounted.current = true;
    const onVisibility = () => { const active = document.visibilityState === 'visible'; if (active) setVisibleSince(Date.now()); setVisible(active); };
    document.addEventListener('visibilitychange', onVisibility);
    return () => { mounted.current = false; document.removeEventListener('visibilitychange', onVisibility); };
  }, []);

  useEffect(() => {
    setError(''); setOpening(''); setConfirming(false);
  }, [meetingId]);

  function stopWaitingWindow(cancelAll = false) {
    if (!meetingId) return;
    try {
      const key = waitingKey(squadId, meetingId);
      if (cancelAll || localStorage.getItem(key) === ownedAttempt.current) { localStorage.removeItem(key); setCurrentAttempt(null); }
    } catch { /* The manual join fallback remains available. */ }
  }

  function openMeetingTab() {
    if (!meetingId || !enabled) return;
    try {
      const attempt = crypto.randomUUID();
      ownedAttempt.current = attempt;
      localStorage.setItem(waitingKey(squadId, meetingId), attempt);
      setCurrentAttempt(attempt);
      const tab = window.open(`${waitingPath(squadId, meetingId)}#attempt=${attempt}`, '_blank');
      if (!tab) {
        localStorage.removeItem(waitingKey(squadId, meetingId)); setCurrentAttempt(null);
        setWindowNotice('Your browser blocked the meeting tab. Use Open meeting tab, or Join Google Meet when everyone is ready.');
        return;
      }
      tab.opener = null;
      setWindowNotice('Your separate meeting tab is open. Keep this squad tab for your work; return here after the call.');
    } catch {
      setWindowNotice('The meeting tab could not open automatically. Use Join Google Meet when everyone is ready.');
    }
  }

  function authorizeThisWindow() {
    try {
      const attempt = crypto.randomUUID();
      ownedAttempt.current = attempt;
      localStorage.setItem(waitingKey(squadId, meetingId), attempt);
      setWindowAttempt(attempt); setCurrentAttempt(attempt);
      history.replaceState(null, '', `${waitingPath(squadId, meetingId)}#attempt=${attempt}`);
    } catch { setWindowNotice('Automatic opening is unavailable in this browser. Use Join Google Meet when everyone is ready.'); }
  }

  const launch = useCallback(async () => {
    if (!meetingId) return;
    attempted.current.add(meetingId);
    setBusy('launch'); setError('');
    try { await change(`/squads/${squadId}/meetings/${meetingId}/launch`, 'POST', {}); }
    catch (err) { if (mounted.current) setError(err.message); }
    finally { if (mounted.current) setBusy(''); }
  }, [squadId, meetingId, change]);

  useEffect(() => {
    if (!readiness?.allReady) attempted.current.delete(meetingId);
    if (!visible || !fresh || !enabled || busy || suspended || !windowAuthorized || !readiness?.selfReady || !readiness.allReady) return;
    if (readiness.status === 'waiting' && data.googleMeet?.organizerAvailable && !attempted.current.has(meetingId)) void launch();
  }, [visible, fresh, enabled, busy, suspended, windowAuthorized, meetingId, readiness?.selfReady, readiness?.allReady, readiness?.status, data?.googleMeet?.organizerAvailable, launch]);

  useEffect(() => {
    if (!waitingWindow || !windowAuthorized || !visible || !fresh || !enabled || busy || suspended || !readiness?.selfReady || !readiness.allReady || readiness.status !== 'ready' || !validMeetUrl(nextMeeting?.meetUrl)) return;
    const key = `learning-squads:meet:v2:${squadId}:${meetingId}:${readiness.launchId || nextMeeting.meetUrl}`;
    if (navigated.current.has(key)) return;
    navigated.current.add(key);
    try {
      if (sessionStorage.getItem(key)) { setOpening('Google Meet is ready. Use the button below to join again.'); return; }
      sessionStorage.setItem(key, 'opened');
    } catch {
      setOpening('Automatic opening is unavailable in this browser. Use Join Google Meet below.');
      return;
    }
    setOpening('Everyone is ready. Opening Google Meet…');
    window.opener = null;
    window.location.assign(nextMeeting.meetUrl);
  }, [waitingWindow, windowAuthorized, visible, fresh, enabled, busy, suspended, squadId, meetingId, readiness?.selfReady, readiness?.allReady, readiness?.status, readiness?.launchId, nextMeeting?.meetUrl]);

  async function setReady(ready) {
    if (!meetingId || busy) return;
    if (ready) {
      if (waitingWindow) authorizeThisWindow();
      else openMeetingTab();
    } else stopWaitingWindow(true);
    setBusy('readiness'); setError('');
    try {
      await change(`/squads/${squadId}/meetings/${meetingId}/readiness`, 'PUT', { ready });
      if (mounted.current) setConfirming(false);
    } catch (err) { if (ready) stopWaitingWindow(); if (mounted.current) setError(err.message); }
    finally { if (mounted.current) setBusy(''); }
  }

  async function connect() {
    if (busy) return;
    setBusy('connect'); setError('');
    try {
      const result = await change('/google-meet/connect', 'POST', { squadId });
      const url = new URL(result.authorizationUrl);
      if (url.protocol !== 'https:' || url.hostname !== 'accounts.google.com' || url.username || url.password) throw new Error('Google connection could not be opened. Please try again.');
      if (mounted.current) window.location.assign(url.href);
    } catch (err) { if (mounted.current) setError(err.message); }
    finally { if (mounted.current) setBusy(''); }
  }

  async function disconnect() {
    if (busy) return;
    setBusy('disconnect'); setError('');
    try { await change('/google-meet/connection', 'DELETE', {}); }
    catch (err) { if (mounted.current) setError(err.message); }
    finally { if (mounted.current) setBusy(''); }
  }

  return { data, nextMeeting, readiness, enabled, busy, error, confirming, opening, windowNotice, waitingWindow, windowAuthorized, openMeetingTab, stopWaitingWindow, setConfirming, setReady, connect, disconnect, launch };
}

export function MeetingReadiness({ access, Modal, onManualLink }) {
  const { data, nextMeeting, readiness, enabled, busy, error, confirming, opening, windowNotice, waitingWindow, windowAuthorized, openMeetingTab, setConfirming, setReady, connect, disconnect, launch } = access;
  const google = data?.googleMeet;
  if (!readiness || !data?.isMember || !data.canEdit) return <MeetingJoinLink meeting={nextMeeting} />;
  const readyToJoin = readiness.allReady && readiness.status === 'ready' && validMeetUrl(nextMeeting.meetUrl);

  return <div className="meeting-readiness">
    <h3>Ready to meet?</h3>
    {!enabled ? <p className="muted">Readiness opens when your squad has enough members to start.</p> : <>
      <p className="readiness-count" role="status"><strong>{readiness.readyCount} of {readiness.totalCount} ready</strong>{readiness.allReady ? ' · Everyone has confirmed.' : ' · Waiting for the whole squad.'}</p>
      <ul className="readiness-roster" aria-label="Meeting readiness">
        {readiness.members.map(member => <li key={member.id}><span>{member.name}</span><strong>{member.ready ? 'Ready' : 'Not ready yet'}</strong></li>)}
      </ul>
      <p className="muted">{waitingWindow ? 'This meeting tab will open your shared Google Meet when everyone is ready. Your squad page stays in its original tab.' : 'Confirm only when you can join now. A separate meeting tab will open now and take you to Google Meet when everyone is ready. Your squad page stays here.'}</p>
      <div className="actions readiness-actions">
        {readiness.selfReady ? <button disabled={!!busy} onClick={() => setReady(false)}>{busy === 'readiness' ? 'Saving…' : 'Cancel my readiness'}</button> : <button className="primary" disabled={!!busy} onClick={() => { setConfirming(true); }}>I’m ready</button>}
        {readiness.selfReady && !waitingWindow && <button disabled={!!busy} onClick={openMeetingTab}>Open meeting tab</button>}
      </div>
    </>}
    {windowNotice && <p className="readiness-status" role="status">{windowNotice}</p>}
    {waitingWindow && !windowAuthorized && <p className="notice" role="status">Automatic opening is paused in this tab. Readiness may have been cancelled, or a newer meeting tab opened. You can return to your squad or use the Join button when the meeting is ready.</p>}
    {readiness.status === 'creating' || busy === 'launch' ? <p className="readiness-status" role="status">Creating your shared Google Meet…</p> : null}
    {(error || readiness.error) && <p className="notice error" role="alert">{error || readiness.error}</p>}
    {enabled && readiness.selfReady && readiness.allReady && (readiness.status === 'error' || error) && !readyToJoin && <button disabled={!!busy} onClick={launch}>{busy === 'launch' ? 'Trying again…' : 'Retry creating Meet'}</button>}
    {readyToJoin && <><p role="status" className="readiness-status">{opening || 'Your shared Google Meet is ready.'}</p><MeetingJoinLink meeting={nextMeeting} /></>}
    {!readyToJoin && <div className="google-connection">
      {!google?.configured ? <p className="muted">Automatic Google Meet links are not connected yet. The site owner needs to finish Google setup. Your readiness is still saved.</p> : google.connected ? <><p className="muted">Your Google account is connected and can organize the squad’s meetings.</p><button className="text-button" disabled={!!busy} onClick={disconnect}>{busy === 'disconnect' ? 'Disconnecting…' : 'Disconnect my Google account'}</button></> : <><p className="muted">{google.organizerAvailable ? 'A squad member has connected Google. Your shared Meet will be created when everyone is ready.' : 'One squad member needs to connect Google to create the shared Meet automatically.'}</p><button disabled={!!busy} onClick={connect}>{busy === 'connect' ? 'Opening Google…' : 'Connect Google to organize'}</button></>}
      {onManualLink && <details className="manual-meet"><summary>Already have a Google Meet link?</summary><p className="muted">You can use an existing conference. It will open after everyone confirms readiness.</p><button className="text-button" disabled={!!busy} onClick={onManualLink}>Use an existing Meet link</button></details>}
    </div>}
    {confirming && <Modal title="Ready to join Google Meet?" onClose={() => !busy && setConfirming(false)}>
      <p>You are confirming that you can join <strong>{nextMeeting.topic}</strong> now.</p>
      <p>{waitingWindow ? 'This meeting tab will take you to the shared Google Meet when every current squad member is ready.' : 'A separate meeting tab will open immediately. When every current squad member is ready, that tab will take you to the shared Google Meet.'} Your squad page stays open. After leaving the call, close the Meet tab and return to your squad.</p>
      {error && <p className="notice error" role="alert">{error}</p>}
      <div className="actions"><button disabled={!!busy} onClick={() => setConfirming(false)}>Not yet</button><button className="primary" disabled={!!busy} onClick={() => setReady(true)}>{busy === 'readiness' ? 'Confirming…' : 'Confirm I’m ready'}</button></div>
    </Modal>}
  </div>;
}

export function MeetingJoinLink({ meeting }) {
  if (!validMeetUrl(meeting?.meetUrl)) return null;
  if (new Date(meeting.endsAt).getTime() > Date.now() && !(meeting.readiness?.allReady && meeting.readiness?.status === 'ready')) return null;
  return <div className="meet-controls"><a className="button primary" href={meeting.meetUrl} target="_blank" rel="noopener noreferrer">Join Google Meet</a>{meeting.organizerName && <small>Organized by {meeting.organizerName}</small>}</div>;
}

export function MeetingWaitingRoom({ access, Modal, onBack, timeLabel }) {
  const { data, nextMeeting, enabled, busy, stopWaitingWindow } = access;
  return <section className="panel narrow">
    <p className="eyebrow">{data.squad.name}</p>
    <h1>Meeting waiting room</h1>
    {nextMeeting ? <><h2>{nextMeeting.topic}</h2><p>{timeLabel}</p></> : null}
    <p>Your squad page stays open in its original tab. After leaving Google Meet, close the Meet tab to return to your work.</p>
    {!nextMeeting || !enabled ? <p className="notice" role="status">{!data.isMember || !data.canEdit ? 'This squad is read-only for you. This tab will not open a conference.' : 'Only your nearest upcoming meeting can open here. Return to your squad to choose the current meeting.'}</p> : <MeetingReadiness access={access} Modal={Modal} />}
    <div className="actions"><button disabled={!!busy} onClick={() => { stopWaitingWindow(); onBack(); }}>Back to squad</button></div>
    <p className="muted">Back to squad stops automatic opening in this waiting tab. Use Cancel my readiness if you are no longer ready to join.</p>
  </section>;
}
