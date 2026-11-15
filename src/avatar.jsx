import React, { useEffect, useRef, useState } from 'react';
import { Camera, LoaderCircle } from 'lucide-react';
import './avatar.css';

export function Avatar({ name = '', src, size = 44 }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  const initials = name.trim().split(/\s+/).slice(0,2).map(word => word[0]).join('').toUpperCase() || '?';
  const tone = [...name].reduce((n,c) => n+c.charCodeAt(0),0) % 4;
  return <span className={`profile-avatar tone-${tone}`} style={{width:size,height:size,fontSize:Math.max(14,size*.32)}} aria-hidden="true">{src && !failed ? <img src={src} alt="" onError={() => setFailed(true)} /> : initials}</span>;
}

export function AvatarPicker({ name, value, onChange, onBusy }) {
  const input = useRef(null);
  const [busy,setBusy] = useState(false), [error,setError] = useState('');
  async function upload(file) {
    if (!file || busy) return;
    setError('');
    if (!['image/jpeg','image/png','image/webp'].includes(file.type) || file.size > 8*1024*1024) { setError('Choose a JPG, PNG or WebP photo under 8 MB.'); return; }
    setBusy(true); onBusy?.(true);
    try {
      const bitmap = await createImageBitmap(file);
      const canvas = document.createElement('canvas'); canvas.width=canvas.height=256;
      const side = Math.min(bitmap.width,bitmap.height);
      canvas.getContext('2d').drawImage(bitmap,(bitmap.width-side)/2,(bitmap.height-side)/2,side,side,0,0,256,256); bitmap.close();
      const photo = await new Promise(resolve => canvas.toBlob(resolve,'image/webp',.85));
      if (!photo) throw new Error('This photo could not be read. Try another image.');
      const response = await fetch('/api/profile/avatar',{method:'PUT',credentials:'same-origin',headers:{'Content-Type':photo.type},body:photo,signal:AbortSignal.timeout(20000)});
      const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Photo could not be uploaded.');
      onChange(data.avatarUrl);
    } catch (e) { setError(e.name === 'TimeoutError' ? 'Upload timed out. Try again.' : e.message); }
    finally { setBusy(false); onBusy?.(false); if (input.current) input.current.value=''; }
  }
  async function remove() {
    setBusy(true); onBusy?.(true); setError('');
    try { const response=await fetch('/api/profile/avatar',{method:'DELETE',headers:{'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(20000)}); if(!response.ok) throw new Error('Could not remove the photo. Try again.'); onChange(null); }
    catch(e) { setError(e.message); } finally {setBusy(false);onBusy?.(false);}
  }
  return <div className="avatar-picker"><div className="avatar-picker-row"><Avatar name={name} src={value} size={64} /><div><div className="actions"><button type="button" disabled={busy} onClick={() => input.current.click()}>{busy ? <LoaderCircle size={16} className="spin" /> : <Camera size={16} />} {busy ? 'Saving photo…' : value ? 'Change photo' : 'Add a photo'}</button>{value && <button type="button" className="text-button" disabled={busy} onClick={remove}>Remove</button>}</div><small>Optional. Your initials work too.</small></div></div><input ref={input} type="file" accept="image/jpeg,image/png,image/webp" aria-label="Profile photo" hidden onChange={event => upload(event.target.files?.[0])} />{error && <p role="alert" className="notice error">{error}</p>}</div>;
}
