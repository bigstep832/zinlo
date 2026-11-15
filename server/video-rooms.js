import { randomUUID, createHmac } from 'node:crypto';
import { AppError, fail } from './scheduling.js';

// Signalling is transient: no audio, video or SDP is written to disk.
export function createVideoRooms({ authorizeMember, meetingReadiness, members, now, rate, config = process.env }) {
  const rooms = new Map();
  const aliveFor = 45000;
  function cleanup() {
    const time = now().getTime();
    for (const [key, room] of rooms) {
      for (const [id, peer] of room.peers) if (time - peer.seen > aliveFor) room.peers.delete(id);
      room.signals = room.signals.filter(signal => time - signal.time < 60000 && room.peers.has(signal.to) && room.peers.has(signal.from));
      if (!room.peers.size) rooms.delete(key);
    }
  }
  async function iceServers(userId) {
    const result = [{ urls: ['stun:stun.l.google.com:19302'] }];
    if (config.TURN_URLS && config.TURN_SECRET) {
      const username = `${Math.floor(now().getTime() / 1000) + 7200}:${userId}`;
      result.push({ urls: config.TURN_URLS.split(',').map(url => url.trim()).filter(Boolean), username, credential: createHmac('sha1', config.TURN_SECRET).update(username).digest('base64') });
    } else if (config.CLOUDFLARE_TURN_KEY_ID && config.CLOUDFLARE_TURN_API_TOKEN) {
      let response;
      try {
        response = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(config.CLOUDFLARE_TURN_KEY_ID)}/credentials/generate-ice-servers`, { method: 'POST', headers: { Authorization: `Bearer ${config.CLOUDFLARE_TURN_API_TOKEN}`, 'content-type': 'application/json' }, body: JSON.stringify({ ttl: 7200 }), signal: AbortSignal.timeout(10000) });
        if (!response.ok) throw new Error();
        const data = await response.json();
        const servers = Array.isArray(data.iceServers) ? data.iceServers : [data.iceServers];
        if (!servers.some(server => server?.urls && server?.credential)) throw new Error();
        result.push(...servers.filter(server => server?.urls));
      } catch { throw new AppError(503, 'The video relay is unavailable. Please try again.', 'relay_unavailable'); }
    }
    return result;
  }
  return async function handle({ squadId, meetingId, action, data, user }) {
    cleanup();
    const { row } = authorizeMember(squadId, user, true);
    const readiness = meetingReadiness(row, meetingId, user.id);
    if (!readiness.eligible) throw new AppError(409, 'Only your next squad meeting can open a video room.', 'meeting_not_eligible');
    const key = `${squadId}:${meetingId}`;
    let room = rooms.get(key);
    if (action === 'join') {
      rate(`video-join:${user.id}`, 12, 60000);
      const servers = await iceServers(user.id);
      // Membership and the next eligible meeting can change during the relay request.
      const current = authorizeMember(squadId, user, true);
      if (!meetingReadiness(current.row, meetingId, user.id).eligible) throw new AppError(409, 'Only your next squad meeting can open a video room.', 'meeting_not_eligible');
      room = rooms.get(key);
      if (!room) { room = { peers: new Map(), signals: [], sequence: 0, started: false }; rooms.set(key, room); }
      // One active device per teammate, so a second tab cannot impersonate an extra person.
      for (const [id, peer] of room.peers) if (peer.userId === user.id) room.peers.delete(id);
      const peer = { id: randomUUID(), userId: user.id, name: user.name, ready: false, seen: now().getTime() };
      room.peers.set(peer.id, peer);
      return { peerId: peer.id, iceServers: servers, relayConfigured: servers.some(server => JSON.stringify(server.urls).includes('turn:') || JSON.stringify(server.urls).includes('turns:')) };
    }
    const peer = room?.peers.get(data.peerId);
    if (!peer || peer.userId !== user.id) throw new AppError(409, 'This video session ended. Join the room again.', 'video_session_ended');
    const roster = members(squadId);
    for (const [id, person] of room.peers) if (!roster.some(member => member.id === person.userId)) room.peers.delete(id);
    if (action === 'leave') { room.peers.delete(peer.id); return { ok: true }; }
    peer.seen = now().getTime();
    if (['poll', 'ready'].includes(action) && data.media !== undefined) {
      if (!data.media || typeof data.media.audio !== 'boolean' || typeof data.media.video !== 'boolean') fail('Provide microphone and camera states.');
      peer.media = { audio: data.media.audio, video: data.media.video };
    }
    if (action === 'ready') {
      if (typeof data.ready !== 'boolean') fail('Choose your readiness.');
      peer.ready = data.ready;
    }
    const allReady = roster.length >= 2 && roster.every(member => [...room.peers.values()].some(person => person.userId === member.id && person.ready));
    if (allReady) room.started = true;
    if (action === 'signal') {
      rate(`video-signal:${user.id}`, 400, 60000);
      const target = room.peers.get(data.to);
      if (!room.started || !peer.ready || !target?.ready || target.id === peer.id) throw new AppError(409, 'The other participant is not ready.', 'peer_not_ready');
      const signal = data.signal;
      if (!signal || !['offer', 'answer', 'candidate'].includes(signal.type)) fail('Invalid video signal.');
      if (JSON.stringify(signal).length > 20000) fail('Video signal is too large.');
      if (signal.type !== 'candidate' && (typeof signal.sdp !== 'string' || !signal.sdp.startsWith('v='))) fail('Invalid session description.');
      if (signal.type === 'candidate' && (!signal.candidate || typeof signal.candidate.candidate !== 'string' || signal.candidate.candidate.length > 3000)) fail('Invalid connection candidate.');
      if (room.signals.length > 2000) throw new AppError(429, 'Too many video signals. Rejoin the room.', 'rate_limit');
      room.signals.push({ id: ++room.sequence, from: peer.id, to: target.id, signal, time: now().getTime() });
      return { ok: true };
    }
    if (!['poll', 'ready'].includes(action)) throw new AppError(404, 'Video action not found.', 'not_found');
    if (data.after !== undefined && (!Number.isSafeInteger(data.after) || data.after < 0)) fail('Invalid signal cursor.');
    return {
      started: room.started, allReady,
      participants: roster.map(member => { const person = [...room.peers.values()].find(item => item.userId === member.id); return { userId: member.id, name: member.name, avatarUrl: member.avatarUrl, peerId: person?.id, ready: !!person?.ready, present: !!person, media: person?.media || null }; }),
      signals: room.signals.filter(signal => signal.to === peer.id && signal.id > (data.after || 0)).map(({ id, from, signal }) => ({ id, from, signal })),
      cursor: room.sequence,
    };
  };
}
