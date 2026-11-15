import { Avatar } from './avatar.jsx';
import React, { useEffect, useRef, useState } from 'react';
import { SquadVideoMesh } from './video-peer.js';
import { Mic, MicOff, Video, VideoOff, PhoneOff, Check, Volume2, RotateCw, Users } from 'lucide-react';
import './video-room.css';

function VideoTile({ stream, name, avatarUrl, self, status, cameraOff = false }) {
  const element = useRef(null), [playBlocked, setPlayBlocked] = useState(false);
  useEffect(() => { const video = element.current; if (!video) return; let cancelled = false; setPlayBlocked(false); video.srcObject = stream || null; if (stream) video.play().catch(() => { if (!cancelled) setPlayBlocked(true); }); return () => { cancelled = true; video.srcObject = null; }; }, [stream]);
  const noPicture = !stream?.getVideoTracks().length || cameraOff;
  return <div className={`video-tile${self ? ' video-tile-self' : ''}`}>
    <video ref={element} autoPlay playsInline muted={self} aria-label={`${name} video`} />
    {noPicture && <div className="video-placeholder"><Avatar name={name} src={avatarUrl} size={64}/><p>{status}</p></div>}
    <span className="video-name" title={name}>{name}{self && <span> (you)</span>}</span>
    {playBlocked && <button className="video-play" onClick={() => element.current.play().then(() => setPlayBlocked(false)).catch(() => {})}><Volume2 size={16} aria-hidden="true" />Play audio</button>}
  </div>;
}
function CallControl({ label, icon: Icon, tone = '', ...props }) {
  return <span className="call-control-wrap"><button type="button" className={`call-icon ${tone}`} aria-label={label} title={label} {...props}><Icon size={20} strokeWidth={1.8} aria-hidden="true" /></button><span className="call-tooltip" aria-hidden="true">{label}</span></span>;
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
      const micEnabled = local.current?.getAudioTracks()[0]?.enabled ?? true;
      value.getAudioTracks().forEach(track => { track.enabled = micEnabled; });
      local.current?.getTracks().forEach(track => track.stop()); local.current = value; setStream(value); setMic(micEnabled); setCamera(video);
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
  const hasAudio = !!stream?.getAudioTracks().length, hasVideo = !!stream?.getVideoTracks().length;
  const inCall = ready && state?.started;
  const readyCount = state?.participants.filter(person => person.ready).length || 0;
  const needsReconnect = ended || Object.values(connections).some(value => ['failed', 'disconnected'].includes(value));
  const selfName = state?.participants.find(person => person.peerId === session?.peerId)?.name || 'You';
  return <section className="video-room" aria-labelledby="video-room-title">
    <header className="video-room-heading"><div><h1 id="video-room-title">Your squad room</h1><p>{inCall ? 'A little time to learn together.' : 'Settle in. Let your team know you’re ready.'}</p></div>{state && <span className="room-people"><Users size={16} aria-hidden="true" />{state.participants.length} people</span>}</header>
    {error && <p className="notice error" role="alert">{error}</p>}
    <div className="video-stage">
      <div className="video-grid">
        <VideoTile stream={stream} name={selfName} avatarUrl={state?.participants.find(person => person.peerId === session?.peerId)?.avatarUrl} self cameraOff={!camera} status={hasVideo && !camera ? 'Camera off' : ready ? 'Ready' : 'Your preview'} />
        {state?.participants.filter(person => person.peerId !== session?.peerId).map(person => <VideoTile key={person.userId} stream={remote[person.peerId]} name={person.name} avatarUrl={person.avatarUrl} status={connections[person.peerId] === 'connected' ? 'Connected' : person.ready ? 'Ready' : person.present ? 'Getting ready' : 'Not here yet'} />)}
      </div>
      <div className="call-controls" role="group" aria-label="Call controls">
        <p className={`call-status${inCall ? ' call-status-live' : ''}`} role="status"><span className="call-status-dot" aria-hidden="true" />{ended ? 'Call disconnected' : !state ? 'Opening room…' : inCall ? `${connected} connected` : `${readyCount} of ${state.participants.length} ready`}</p>
        <div className="call-actions">
          <CallControl label={hasAudio ? (mic ? 'Mute microphone' : 'Unmute microphone') : 'Enable microphone'} icon={hasAudio && mic ? Mic : MicOff} tone={!hasAudio || !mic ? 'call-device-off' : ''} aria-pressed={hasAudio && mic} disabled={busy || !session || ended || (ready && !hasAudio)} onClick={() => hasAudio ? toggle('audio') : enableMedia(false)} />
          <CallControl label={hasVideo ? (camera ? 'Turn camera off' : 'Turn camera on') : 'Enable camera and microphone'} icon={hasVideo && camera ? Video : VideoOff} tone={!hasVideo || !camera ? 'call-device-off' : ''} aria-pressed={hasVideo && camera} disabled={busy || !session || ended || (ready && !hasVideo)} onClick={() => hasVideo ? toggle('video') : enableMedia(true)} />
          <span className="call-divider" aria-hidden="true" />
          {!ready && !ended && <button className="call-ready" disabled={busy || !session} onClick={confirmReady}><Check size={17} aria-hidden="true" />{busy ? 'One moment…' : 'I’m ready'}</button>}
          {ready && !inCall && !ended && <span className="call-confirmed"><Check size={17} aria-hidden="true" />Ready</span>}
          {needsReconnect && <CallControl label="Reconnect to video room" icon={RotateCw} onClick={() => { setStream(null); setRetry(value => value + 1); }} />}
          <CallControl label="Leave call and return home" icon={PhoneOff} tone="call-leave" onClick={onLeave} />
        </div>
      </div>
    </div>
    <p className="room-hint">{!ready ? 'Turn on your mic or camera, or join to listen. The call starts when everyone is ready.' : !stream ? 'Listening only. Leave and rejoin to enable your mic or camera.' : !inCall ? 'You’re ready. Your mic and camera are shared when everyone joins.' : 'Leave the call any time to return to your squad.'}</p>
    <details className="room-help"><summary>Call details</summary><p>This site does not record calls. Camera and microphone access starts only when you enable it.</p>{session && !session.relayConfigured && <p>If your network blocks the call, try another network or Google Meet from the Meetings page.</p>}</details>
  </section>;
}
