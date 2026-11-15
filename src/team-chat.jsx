import React, { useEffect, useRef, useState } from 'react';

export function TeamChat({ squadId, selfId, api, active, canSend, isMember }) {
  const [messages, setMessages] = useState([]), [draft, setDraft] = useState('');
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [loading, setLoading] = useState(true), [older, setOlder] = useState(false);
  const [more, setMore] = useState(false);
  const messagesRef = useRef([]), list = useRef(null), pending = useRef(null), mounted = useRef(true), nearEnd = useRef(true);
  const merge = incoming => {
    const all = new Map(messagesRef.current.map(item => [item.id, item]));
    incoming.forEach(item => all.set(item.id, item));
    messagesRef.current = [...all.values()].sort((a, b) => a.id - b.id);
    setMessages(messagesRef.current);
  };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (!isMember) { messagesRef.current = []; setMessages([]); setDraft(''); pending.current = null; }
  }, [isMember]);
  useEffect(() => {
    if (!draft.trim()) return;
    const warn = event => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [draft]);
  useEffect(() => {
    if (!active || !isMember) return;
    let stopped = false, fetching = false;
    const poll = async () => {
      if (fetching || document.visibilityState !== 'visible') return;
      fetching = true;
      try {
        const after = messagesRef.current.at(-1)?.id;
        const result = await api(`/squads/${squadId}/chat${after ? `?after=${after}` : ''}`);
        if (stopped) return;
        if (!after) setMore(result.hasMore);
        merge(result.messages); setError(''); setLoading(false);
        // Mark only messages delivered to the visible chat as read.
        const lastId = messagesRef.current.at(-1)?.id;
        if (lastId) await api(`/squads/${squadId}/chat/read`, 'PUT', { lastId });
      } catch (e) { if (!stopped) { setError(e.message); setLoading(false); } }
      finally { fetching = false; }
    };
    poll(); const timer = setInterval(poll, 2500);
    document.addEventListener('visibilitychange', poll);
    return () => { stopped = true; clearInterval(timer); document.removeEventListener('visibilitychange', poll); };
  }, [active, squadId, isMember, api]);
  useEffect(() => { if (active && nearEnd.current && list.current) list.current.scrollTop = list.current.scrollHeight; }, [messages, active]);
  async function loadOlder() {
    setOlder(true);
    const element = list.current, oldHeight = element?.scrollHeight || 0;
    nearEnd.current = false;
    try {
      const result = await api(`/squads/${squadId}/chat?before=${messagesRef.current[0].id}`);
      if (!mounted.current) return;
      merge(result.messages); setMore(result.hasMore);
      requestAnimationFrame(() => { if (element) element.scrollTop += element.scrollHeight - oldHeight; });
    } catch (e) { if (mounted.current) setError(e.message); }
    finally { if (mounted.current) setOlder(false); }
  }
  async function send(e) {
    e.preventDefault(); if (busy || !draft.trim()) return;
    const text = draft.trim();
    if (!pending.current || pending.current.text !== text) pending.current = { clientId: crypto.randomUUID(), text };
    setBusy(true); setError('');
    try {
      const result = await api(`/squads/${squadId}/chat`, 'POST', pending.current);
      if (!mounted.current) return;
      nearEnd.current = true; merge([result.message]); setDraft(current => current.trim() === text ? '' : current); pending.current = null;
    } catch (e) { if (mounted.current) setError(`${e.message} Your message is kept; try sending again.`); }
    finally { if (mounted.current) setBusy(false); }
  }
  if (!active) return null;
  if (!isMember) return <section className="panel"><h2>Team chat</h2><p>The chat is available to current teammates.</p></section>;
  return <section className="chat-page"><div className="learning-intro"><h2>Team chat</h2><p>Ask a question, share a small win, or plan your next session.</p></div>
    <div className="panel chat-panel">
      <div className="chat-history" ref={list} onScroll={() => { const el = list.current; nearEnd.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }}>
        {more && <button className="text-button" disabled={older} onClick={loadOlder}>{older ? 'Loading…' : 'Load earlier messages'}</button>}
        {loading ? <p role="status">Loading your conversation…</p> : !messages.length && <div className="chat-empty"><h3>Start the conversation.</h3><p>Say hello and tell your squad what you would like to learn.</p></div>}
        <ol className="chat-messages" aria-label="Team messages" aria-live="polite" aria-relevant="additions">{messages.map(message => <li key={message.id} className={message.userId === selfId ? 'message-self' : ''}><div className="message-meta"><strong>{message.userId === selfId ? 'You' : message.name}</strong><time dateTime={message.createdAt}>{new Date(message.createdAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</time></div><p className="message-text">{message.text}</p></li>)}</ol>
      </div>
      {error && <p className="notice error" role="alert">{error}</p>}
      {canSend ? <form className="chat-compose" onSubmit={send}><label htmlFor="team-message">Message your squad<textarea id="team-message" rows={3} maxLength={2000} value={draft} onChange={e => setDraft(e.target.value)} placeholder="Write a message…" onKeyDown={e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') send(e); }} /></label><div className="row"><small className="muted">{draft.length}/2000 · Ctrl+Enter to send</small><button className="primary" disabled={busy || !draft.trim()}>{busy ? 'Sending…' : 'Send message'}</button></div></form> : <p className="muted">This sprint has ended. Your conversation is read-only.</p>}
    </div>
  </section>;
}
