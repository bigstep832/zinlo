import React, { useCallback, useEffect, useRef, useState } from 'react';

function validMeetUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'meet.google.com' && !url.port && !url.username && !url.password && /^\/[a-z]{3}-[a-z]{4}-[a-z]{3}\/?$/.test(url.pathname);
  } catch { return false; }
}

export function useMeetingAccess({ squadId, data, receivedAt, change, suspended = false }) {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [opening, setOpening] = useState('');
  const [visible, setVisible] = useState(document.visibilityState === 'visible');
  const [visibleSince, setVisibleSince] = useState(Date.now());
  const mounted = useRef(true);
  const attempted = useRef(new Set());
  const navigated = useRef(new Set());
  const nextMeeting = data?.meetings.find(meeting => new Date(meeting.endsAt).getTime() > Date.now());
  const readiness = nextMeeting?.readiness;
  const enabled = !!(data?.isMember && data.canEdit && readiness?.eligible);
  const meetingId = nextMeeting?.id;
  const fresh = receivedAt >= visibleSince;

  useEffect(() => {
    mounted.current = true;
    const onVisibility = () => { const active = document.visibilityState === 'visible'; if (active) setVisibleSince(Date.now()); setVisible(active); };
    document.addEventListener('visibilitychange', onVisibility);
    return () => { mounted.current = false; document.removeEventListener('visibilitychange', onVisibility); };
  }, []);

  useEffect(() => {
    setError(''); setOpening(''); setConfirming(false);
  }, [meetingId]);

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
    if (!visible || !fresh || !enabled || busy || suspended || !readiness?.selfReady || !readiness.allReady) return;
    if (readiness.status === 'waiting' && data.googleMeet?.organizerAvailable && !attempted.current.has(meetingId)) void launch();
  }, [visible, fresh, enabled, busy, suspended, meetingId, readiness?.selfReady, readiness?.allReady, readiness?.status, data?.googleMeet?.organizerAvailable, launch]);

  useEffect(() => {
    if (!visible || !fresh || !enabled || busy || suspended || !readiness?.selfReady || !readiness.allReady || readiness.status !== 'ready' || !validMeetUrl(nextMeeting?.meetUrl)) return;
    const key = `learning-squads:meet:v1:${squadId}:${meetingId}:${readiness.launchId || nextMeeting.meetUrl}`;
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
    window.location.assign(nextMeeting.meetUrl);
  }, [visible, fresh, enabled, busy, suspended, squadId, meetingId, readiness?.selfReady, readiness?.allReady, readiness?.status, readiness?.launchId, nextMeeting?.meetUrl]);

  async function setReady(ready) {
    if (!meetingId || busy) return;
    setBusy('readiness'); setError('');
    try {
      await change(`/squads/${squadId}/meetings/${meetingId}/readiness`, 'PUT', { ready });
      if (mounted.current) setConfirming(false);
    } catch (err) { if (mounted.current) setError(err.message); }
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

  return { data, nextMeeting, readiness, enabled, busy, error, confirming, opening, setConfirming, setReady, connect, disconnect, launch };
}

export function MeetingReadiness({ access, Modal, onManualLink }) {
  const { data, nextMeeting, readiness, enabled, busy, error, confirming, opening, setConfirming, setReady, connect, disconnect, launch } = access;
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
      <p className="muted">Confirm only when you can join now. When everyone is ready, this tab will open your shared Google Meet automatically.</p>
      <div className="actions readiness-actions">
        {readiness.selfReady ? <button disabled={!!busy} onClick={() => setReady(false)}>{busy === 'readiness' ? 'Saving…' : 'Cancel my readiness'}</button> : <button className="primary" disabled={!!busy} onClick={() => { setConfirming(true); }}>I’m ready</button>}
      </div>
    </>}
    {readiness.status === 'creating' || busy === 'launch' ? <p className="readiness-status" role="status">Creating your shared Google Meet…</p> : null}
    {(error || readiness.error) && <p className="notice error" role="alert">{error || readiness.error}</p>}
    {enabled && readiness.selfReady && readiness.allReady && (readiness.status === 'error' || error) && !readyToJoin && <button disabled={!!busy} onClick={launch}>{busy === 'launch' ? 'Trying again…' : 'Retry creating Meet'}</button>}
    {readyToJoin && <><p role="status" className="readiness-status">{opening || 'Your shared Google Meet is ready.'}</p><MeetingJoinLink meeting={nextMeeting} /></>}
    {!readyToJoin && <div className="google-connection">
      {!google?.configured ? <p className="muted">Automatic Google Meet links are not connected yet. The site owner needs to finish Google setup. Your readiness is still saved.</p> : google.connected ? <><p className="muted">Your Google account is connected and can organize the squad’s meetings.</p><button className="text-button" disabled={!!busy} onClick={disconnect}>{busy === 'disconnect' ? 'Disconnecting…' : 'Disconnect my Google account'}</button></> : <><p className="muted">{google.organizerAvailable ? 'A squad member has connected Google. Your shared Meet will be created when everyone is ready.' : 'One squad member needs to connect Google to create the shared Meet automatically.'}</p><button disabled={!!busy} onClick={connect}>{busy === 'connect' ? 'Opening Google…' : 'Connect Google to organize'}</button></>}
      <details className="manual-meet"><summary>Already have a Google Meet link?</summary><p className="muted">You can use an existing conference. It will open after everyone confirms readiness.</p><button className="text-button" disabled={!!busy} onClick={onManualLink}>Use an existing Meet link</button></details>
    </div>}
    {confirming && <Modal title="Ready to join Google Meet?" onClose={() => !busy && setConfirming(false)}>
      <p>You are confirming that you can join <strong>{nextMeeting.topic}</strong> now.</p>
      <p>When every current squad member is ready, this tab will automatically take you to the same Google Meet. Save any unfinished work before confirming.</p>
      {error && <p className="notice error" role="alert">{error}</p>}
      <div className="actions"><button disabled={!!busy} onClick={() => setConfirming(false)}>Not yet</button><button className="primary" disabled={!!busy} onClick={() => setReady(true)}>{busy === 'readiness' ? 'Confirming…' : 'Confirm I’m ready'}</button></div>
    </Modal>}
  </div>;
}

export function MeetingJoinLink({ meeting }) {
  if (!validMeetUrl(meeting?.meetUrl)) return null;
  if (new Date(meeting.endsAt).getTime() > Date.now() && !(meeting.readiness?.allReady && meeting.readiness?.status === 'ready')) return null;
  return <div className="meet-controls"><a className="button primary" href={meeting.meetUrl}>Join Google Meet</a>{meeting.organizerName && <small>Organized by {meeting.organizerName}</small>}</div>;
}
