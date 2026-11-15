import { Avatar } from './avatar.jsx';
import React, { useEffect, useRef, useState } from 'react';
import { Send, LoaderCircle, Paperclip, X, FileText, Download } from 'lucide-react';
import './team-chat.css';

const fileSize = bytes => bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
function Attachment({ item, onRemove, disabled }) {
  const photo = item.mime === 'image/webp';
  return <div className={`chat-attachment${photo ? ' chat-photo' : ''}`}>
    {photo && <a href={item.url} target="_blank" rel="noreferrer" aria-label={`Open photo: ${item.name}`}><img src={item.url} alt={item.name} loading="lazy" /></a>}
    <div className="chat-file-info"><FileText size={19} aria-hidden="true"/><div><span title={item.name}>{item.name}</span><small>{fileSize(item.size)}</small></div>{onRemove ? <button type="button" className="chat-file-action" aria-label={`Remove ${item.name}`} disabled={disabled} onClick={onRemove}><X size={18} aria-hidden="true"/></button> : <a className="chat-file-action" href={`${item.url}?download=1`} download={item.name} aria-label={`Download ${item.name}`}><Download size={18} aria-hidden="true"/></a>}</div>
  </div>;
}
export function TeamChat({ squadId, selfId, api, active, canSend, isMember }) {
  const [messages, setMessages] = useState([]), [draft, setDraft] = useState('');
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [loading, setLoading] = useState(true), [older, setOlder] = useState(false), [more, setMore] = useState(false);
  const [attachments, setAttachments] = useState([]), [uploading, setUploading] = useState(''), [draftsLoading, setDraftsLoading] = useState(true), [pollError, setPollError] = useState('');
  const picker = useRef(null), uploadLock = useRef(false), uploadController = useRef(null);
  const messagesRef = useRef([]), list = useRef(null), pending = useRef(null), mounted = useRef(true), nearEnd = useRef(true);
  const merge = incoming => {
    const all = new Map(messagesRef.current.map(item => [item.id, item]));
    incoming.forEach(item => all.set(item.id, item));
    messagesRef.current = [...all.values()].sort((a, b) => a.id - b.id);
    setMessages(messagesRef.current);
  };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; uploadController.current?.abort(); }; }, []);
  useEffect(() => {
    if (!isMember) { messagesRef.current = []; setMessages([]); setDraft(''); setAttachments([]); pending.current = null; uploadController.current?.abort(); return; }
    let cancelled = false;
    setDraftsLoading(true);
    api(`/squads/${squadId}/chat/attachments`).then(result => { if (!cancelled) setAttachments(result.attachments); }).catch(e => { if (!cancelled) setError(e.message); }).finally(() => { if (!cancelled) setDraftsLoading(false); });
    return () => { cancelled = true; };
  }, [squadId, isMember, api]);
  useEffect(() => {
    if (!draft.trim() && !uploading) return;
    const warn = event => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [draft, uploading]);
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
        merge(result.messages); setPollError(''); setLoading(false);
        const lastId = messagesRef.current.at(-1)?.id;
        if (lastId) await api(`/squads/${squadId}/chat/read`, 'PUT', { lastId });
      } catch (e) { if (!stopped) { setPollError(e.message); setLoading(false); } }
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
  async function upload(files) {
    if (uploadLock.current || busy || draftsLoading) return;
    if (attachments.length + files.length > 3) { setError('You can attach up to three files to one message.'); return; }
    if (files.some(file => file.size > 10 * 1024 * 1024 || !file.size)) { setError('Choose non-empty files up to 10 MB each.'); return; }
    uploadLock.current = true; setError('');
    const controller = new AbortController(); uploadController.current = controller;
    try {
      for (const file of files) {
        setUploading(file.name);
        const response = await fetch(`/api/squads/${squadId}/chat/attachments`, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': file.type || 'application/octet-stream', 'x-file-name': encodeURIComponent(file.name) }, body: file, signal: controller.signal });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Upload failed. Try again.');
        if (!mounted.current || controller.signal.aborted) return;
        setAttachments(current => [...current, result.attachment]);
      }
    } catch (e) { if (mounted.current && e.name !== 'AbortError') setError(e.message); }
    finally { uploadLock.current = false; if (mounted.current) setUploading(''); }
  }
  async function remove(item) {
    if (busy || uploadLock.current) return;
    setBusy(true); setError('');
    try { await api(`/squads/${squadId}/chat/attachments/${item.id}`, 'DELETE', {}); if (mounted.current) setAttachments(current => current.filter(file => file.id !== item.id)); }
    catch (e) { if (mounted.current) setError(e.message); }
    finally { if (mounted.current) setBusy(false); }
  }
  async function send(e) {
    e.preventDefault(); if (!canSend || busy || uploadLock.current || draftsLoading || !draft.trim() && !attachments.length) return;
    const text = draft.trim(), ids = attachments.map(item => item.id).sort();
    if (!pending.current || pending.current.text !== text || JSON.stringify(pending.current.attachments) !== JSON.stringify(ids)) pending.current = { clientId: crypto.randomUUID(), text, attachments: ids };
    setBusy(true); setError('');
    try {
      const result = await api(`/squads/${squadId}/chat`, 'POST', pending.current);
      if (!mounted.current) return;
      nearEnd.current = true; merge([result.message]); setDraft(current => current.trim() === text ? '' : current); setAttachments(current => current.filter(item => !ids.includes(item.id))); pending.current = null;
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
        <ol className="chat-messages" aria-label="Team messages" aria-live="polite" aria-relevant="additions">{messages.map(message => <li key={message.id} className={message.userId === selfId ? 'message-self' : ''}><div className="message-meta"><Avatar name={message.name} src={message.avatarUrl} size={24}/><strong>{message.userId === selfId ? 'You' : message.name}</strong><time dateTime={message.createdAt}>{new Date(message.createdAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</time></div>{message.text && <p className="message-text">{message.text}</p>}{!!message.attachments?.length && <div className="chat-attachments">{message.attachments.map(item => <Attachment key={item.id} item={item}/>)}</div>}</li>)}</ol>
      </div>
      {(error || pollError) && <p className="notice error" role="alert">{error || pollError}</p>}
      {canSend ? <form className="chat-compose" onSubmit={send}>
        {!!attachments.length && <div className="chat-attachments chat-drafts" aria-label="Attachments to send">{attachments.map(item => <Attachment key={item.id} item={item} disabled={busy || !!uploading} onRemove={() => remove(item)}/>)}</div>}
        {uploading && <p className="chat-uploading" role="status"><LoaderCircle className="chat-send-spinner" size={16} aria-hidden="true"/>Uploading {uploading}…</p>}
        <label htmlFor="team-message">Message your squad<textarea id="team-message" rows={3} maxLength={2000} value={draft} onChange={e => setDraft(e.target.value)} placeholder="Write a message or share a file…" aria-describedby="chat-send-hint" onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) { e.preventDefault(); send(e); } }} /></label>
        <input ref={picker} type="file" multiple hidden aria-label="Files or photos" onChange={e => { const files = [...e.target.files]; e.target.value = ''; if (files.length) upload(files); }}/>
        <div className="chat-compose-footer"><div><small id="chat-send-hint">Enter to send · Shift+Enter for a new line</small><small>Up to 3 files · 10 MB each</small></div><div className="chat-compose-actions"><button type="button" className="chat-attach" aria-label="Attach files or photos" title="Attach files or photos" disabled={busy || !!uploading || draftsLoading || attachments.length >= 3} onClick={() => picker.current?.click()}><Paperclip size={20} aria-hidden="true"/></button><button type="submit" className="chat-send" disabled={busy || !!uploading || draftsLoading || !draft.trim() && !attachments.length} aria-label={busy ? 'Sending message' : 'Send message'} title={busy ? 'Sending…' : 'Send message'}>{busy ? <LoaderCircle className="chat-send-spinner" size={19} aria-hidden="true" /> : <Send size={19} strokeWidth={1.8} aria-hidden="true" />}</button></div></div>
      </form> : <p className="muted">This sprint has ended. Your conversation is read-only.</p>}
    </div>
  </section>;
}
