// Small mesh: a squad has at most four participants. Media never passes through our HTTP server.
export class SquadVideoMesh {
  constructor({ peerId, iceServers, stream, signal, onStream, onState, onError, iceTransportPolicy = 'all' }) {
    Object.assign(this, { peerId, iceServers, stream, signal, onStream, onState, onError, iceTransportPolicy });
    this.peers = new Map(); this.closed = false;
  }
  create(id) {
    if (this.peers.has(id)) return this.peers.get(id);
    const pc = new RTCPeerConnection({ iceServers: this.iceServers, iceTransportPolicy: this.iceTransportPolicy });
    const entry = { pc, candidates: [], queue: Promise.resolve(), makingOffer: false };
    this.peers.set(id, entry);
    for (const track of this.stream?.getTracks() || []) pc.addTrack(track, this.stream);
    const send = value => { entry.queue = entry.queue.then(() => this.closed ? undefined : this.signal(id, value)).catch(error => { if (!this.closed && this.peers.has(id)) this.onError(error); }); };
    entry.send = send;
    pc.onicecandidate = event => { if (event.candidate) send({ type: 'candidate', candidate: event.candidate.toJSON() }); };
    pc.ontrack = event => { entry.stream ||= new MediaStream(); if (!entry.stream.getTracks().includes(event.track)) entry.stream.addTrack(event.track); this.onStream(id, entry.stream); };
    pc.onconnectionstatechange = () => { this.onState(id, pc.connectionState); };
    return entry;
  }
  async offer(id) {
    const entry = this.create(id);
    if (entry.makingOffer || entry.pc.signalingState !== 'stable') return;
    entry.makingOffer = true;
    try {
      for (const kind of ['audio', 'video']) if (!entry.pc.getTransceivers().some(item => item.receiver.track.kind === kind)) entry.pc.addTransceiver(kind, { direction: 'recvonly' });
      await entry.pc.setLocalDescription(await entry.pc.createOffer()); entry.send({ type: 'offer', sdp: entry.pc.localDescription.sdp });
    }
    finally { entry.makingOffer = false; }
  }
  async sync(ids) {
    for (const [id, entry] of this.peers) if (!ids.includes(id)) { entry.pc.close(); this.peers.delete(id); this.onStream(id, null); }
    for (const id of ids) if (id !== this.peerId && !this.peers.has(id)) { this.create(id); if (this.peerId < id) await this.offer(id); }
  }
  async receive(from, signal) {
    const entry = this.create(from), pc = entry.pc;
    if (signal.type === 'candidate') {
      if (pc.remoteDescription) await pc.addIceCandidate(signal.candidate);
      else entry.candidates.push(signal.candidate);
      return;
    }
    await pc.setRemoteDescription({ type: signal.type, sdp: signal.sdp });
    for (const candidate of entry.candidates.splice(0)) await pc.addIceCandidate(candidate);
    if (signal.type === 'offer') { await pc.setLocalDescription(await pc.createAnswer()); entry.send({ type: 'answer', sdp: pc.localDescription.sdp }); }
  }
  close() { this.closed = true; for (const entry of this.peers.values()) entry.pc.close(); this.peers.clear(); }
}
