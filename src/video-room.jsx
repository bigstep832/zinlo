import React, { useEffect, useRef, useState } from 'react';
import { SquadVideoMesh } from './video-peer.js';

function VideoTile({ stream, name, self, status }) {
  const element = useRef(null), [playBlocked, setPlayBlocked] = useState(false);
  useEffect(() => { const video = element.current; if (!video) return; video.srcObject = stream || null; if (stream) video.play().catch(() => setPlayBlocked(true)); return () => { video.srcObject = null; }; }, [stream]);
  return <div className="video-tile"><video ref={element} autoPlay playsInline muted={self} aria-label={`${name} video`} />{!stream && <div className="video-placeholder"><strong>{name}</strong><p>{status || 'Waiting to connect'}</p></div>}<span className="video-name">{name}{self ? ' (you)' : ''}{status ? ` · ${status}` : ''}</span>{playBlocked && <button className="video-play" onClick={() => element.current.play().then(() => setPlayBlocked(false)).catch(() => {})}>Play audio and video</button>}</div>;
}
export function VideoRoom({ squadId, meetingId, api, onLeave }) {
  const [session, setSession] = useState(null), [state, setState] = useState(null), [stream, setStream] = useState(null);
  const [remote, setRemote] = useState({}), [connections, setConnections] = useState({}), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [mic, setMic] = useState(true), [camera, setCamera] = useState(true), [ready, setReady] = useState(false), [retry, setRetry] = useState(0), [ended, setEnded] = useState(false);
  const mesh = useRef(null), local = useRef(null), live = useRef(true), generation = useRef(0), cursor = useRef(0), sessionRef = useRef(null), readyRef = useRef(false);
  const path = `/squads/${squadId}/meetings/${meetingId}/video`;
  useEffect(() => {
    live.current = true; generation.current++; let cancelled = false, polling = false, timer;
    setError(''); setBusy(false); setEnded(false); setSession(null); setState(null); setRemote({}); setConnections({}); setReady(false); readyRef.current = false; cursor.current = 0;
    const leaveSession = peerId => fetch(`/api${path}/leave`, { method: 'POST', credentials: 'same-origin', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ peerId }) }).catch(() => {});
    const stop = () => { mesh.current?.close(); mesh.current = null; local.current?.getTracks().forEach(track => track.stop()); local.current = null; };
    const poll = async current => {
      if (polling || cancelled) return;
      polling = true;
      try {
        const result = await api(`${path}/poll`, 'POST', { peerId: current.peerId, after: cursor.current });
        if (cancelled) return;
        setState(result);
        if (result.started && readyRef.current) {
          if (!mesh.current) mesh.current = new SquadVideoMesh({ peerId: current.peerId, iceServers: current.iceServers, stream: local.current, signal: (to, signal) => api(`${path}/signal`, 'POST', { peerId: current.peerId, to, signal }), onStream: (id, value) => { if (!cancelled) setRemote(existing => ({ ...existing, [id]: value })); }, onState: (id, value) => { if (!cancelled) setConnections(existing => ({ ...existing, [id]: value })); }, onError: e => { if (!cancelled) setError(e.message); } });
          const peers = result.participants.filter(person => person.ready && person.peerId !== current.peerId).map(person => person.peerId);
          await mesh.current.sync(peers);
          for (const item of result.signals) if (peers.includes(item.from)) await mesh.current.receive(item.from, item.signal);
        }
        cursor.current = result.cursor;
      } catch (e) {
        if (!cancelled) {
          setError(e.message);
          if (['video_session_ended', 'read_only', 'forbidden', 'meeting_not_eligible'].includes(e.code)) { generation.current++; clearInterval(timer); stop(); setStream(null); setBusy(false); setEnded(true); }
        }
      } finally { polling = false; }
    };
    api(`${path}/join`, 'POST', {}).then(current => {
      if (cancelled) { leaveSession(current.peerId); return; }
      sessionRef.current = current; setSession(current); poll(current); timer = setInterval(() => poll(current), 1000);
    }).catch(e => { if (!cancelled) { setError(e.message); setEnded(true); } });
    const onExit = () => { if (sessionRef.current) leaveSession(sessionRef.current.peerId); stop(); };
    window.addEventListener('pagehide', onExit);
    return () => { cancelled = true; live.current = false; clearInterval(timer); window.removeEventListener('pagehide', onExit); onExit(); sessionRef.current = null; };
  }, [squadId, meetingId, api, retry]);
  async function enableMedia(video) {
    const requestGeneration = generation.current;
    setBusy(true); setError('');
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera access needs HTTPS and a supported browser.');
      const value = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: video ? { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 24, max: 30 } } : false });
      if (!live.current || requestGeneration !== generation.current || readyRef.current) { value.getTracks().forEach(track => track.stop()); return; }
      local.current?.getTracks().forEach(track => track.stop()); local.current = value; setStream(value); setMic(true); setCamera(video);
    } catch (e) { if (live.current && requestGeneration === generation.current) setError(e.name === 'NotAllowedError' ? 'Camera or microphone permission was denied. Allow it in your browser, try microphone only, or join to listen.' : e.name === 'NotFoundError' ? 'No matching camera or microphone was found. You can join to listen.' : e.message); }
    finally { if (live.current && requestGeneration === generation.current) setBusy(false); }
  }
  async function confirmReady() {
    setBusy(true); setError('');
    try { const result = await api(`${path}/ready`, 'POST', { peerId: session.peerId, ready: true, after: cursor.current }); readyRef.current = true; setReady(true); setState(result); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  function toggle(kind) { const value = kind === 'audio' ? !mic : !camera; local.current?.getTracks().filter(track => track.kind === kind).forEach(track => { track.enabled = value; }); kind === 'audio' ? setMic(value) : setCamera(value); }
  const connected = Object.values(connections).filter(value => value === 'connected').length;
  return <section className="video-room"><div className="learning-intro"><p className="eyebrow">SQUAD VIDEO ROOM</p><h1>{ready && state?.started ? 'You’re here together.' : 'Ready when you are.'}</h1><p>No account needed. Your camera and microphone stay off until you enable them.</p></div>
    {error && <p className="notice error" role="alert">{error}</p>}
    {!session && !ended && <p role="status">Opening your private team room…</p>}
    <div className="video-grid"><VideoTile stream={stream} name="Your preview" self status={ready ? 'Ready' : 'Not ready yet'} />{state?.participants.filter(person => person.peerId !== session?.peerId).map(person => <VideoTile key={person.userId} stream={remote[person.peerId]} name={person.name} status={connections[person.peerId] || (person.ready ? 'Ready' : person.present ? 'In the waiting room' : 'Not here yet')} />)}</div>
    <p className="call-status" role="status">{ready && state?.started ? `${connected} teammate${connected === 1 ? '' : 's'} connected` : `${state?.participants.filter(person => person.ready).length || 0} of ${state?.participants.length || 0} ready. The call starts when everyone confirms.`}</p>
    <div className="call-controls">{!ready && !ended && <><button disabled={busy || !session} onClick={() => enableMedia(true)}>Enable camera and microphone</button><button disabled={busy || !session} onClick={() => enableMedia(false)}>Microphone only</button></>}{stream && <><button aria-pressed={!mic} disabled={!stream.getAudioTracks().length} onClick={() => toggle('audio')}>{mic ? 'Mute microphone' : 'Unmute microphone'}</button>{stream.getVideoTracks().length > 0 && <button aria-pressed={!camera} onClick={() => toggle('video')}>{camera ? 'Turn camera off' : 'Turn camera on'}</button>}</>}{!ready && !ended && <button className="primary" disabled={busy || !session} onClick={confirmReady}>{stream ? 'Confirm I’m ready' : 'Join to listen — I’m ready'}</button>}<button className="end-call" onClick={onLeave}>{ready ? 'Leave call and return home' : 'Back to squad home'}</button></div>
    {(ended || Object.values(connections).some(value => ['failed', 'disconnected'].includes(value))) && <button onClick={() => { setStream(null); setRetry(value => value + 1); }}>Reconnect to video room</button>}
    {!ready && <p className="muted">After confirming, your enabled camera and microphone will be shared when the team is ready. You can also join without either and listen. This site does not record calls.</p>}
    {ready && !stream && <p className="muted">You joined to listen. To enable a microphone or camera, leave and rejoin the room.</p>}
    {session && !session.relayConfigured && <p className="muted">Direct connection mode. If your network blocks the call, try another network or use Google Meet from the Meetings page.</p>}
  </section>;
}
