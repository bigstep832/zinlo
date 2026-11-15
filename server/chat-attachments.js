import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { AppError, fail } from './scheduling.js';

export const attachmentLimit = 10 * 1024 * 1024;
export function createChatAttachments({ q, all, run, now, rate, authorizeMember, currentUser }) {
  const metadata = 'id,squad_id,name,mime,size';
  const dto = saved => ({ id: saved.id, name: saved.name, mime: saved.mime, size: saved.size, url: `/api/squads/${saved.squad_id}/chat/attachments/${saved.id}` });
  function access(squadId, user, edit = false) {
    if (!authorizeMember(squadId, user, edit).membership.active) throw new AppError(403, 'Attachments are private to current teammates.', 'forbidden');
  }
  function ids(value = []) {
    if (!Array.isArray(value) || value.length > 3 || new Set(value).size !== value.length || value.some(id => typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id))) fail('Choose up to three attachments.');
    return value;
  }
  return {
    ids,
    list: messageId => all(`SELECT ${metadata} FROM chat_attachments WHERE message_id=? ORDER BY id`, messageId).map(dto),
    claim(attachmentIds, messageId, squadId, userId) {
      for (const id of attachmentIds) {
        const saved = q('SELECT user_id,squad_id,message_id FROM chat_attachments WHERE id=?', id);
        if (!saved || saved.user_id !== userId || saved.squad_id !== squadId || saved.message_id !== null) fail('An attachment is unavailable. Remove it and upload it again.', 'invalid_attachment');
        run('UPDATE chat_attachments SET message_id=? WHERE id=?', messageId, id);
      }
    },
    async upload(req, squadId) {
      const user = currentUser(req); access(squadId, user, true);
      rate(`chat-upload:${user.id}`, 40, 3600000);
      run('DELETE FROM chat_attachments WHERE message_id IS NULL AND created_at<?', new Date(now().getTime() - 86400000).toISOString());
      let name;
      try { name = decodeURIComponent(req.headers['x-file-name'] || '').split(/[\\/]/).at(-1).trim(); } catch { fail('Invalid file name.'); }
      if (!name || name.length > 180 || /[\x00-\x1f\x7f]/.test(name)) fail('Choose a file with a shorter, valid name.');
      if (Number(req.headers['content-length']) > attachmentLimit) throw new AppError(413, 'Each file must be 10 MB or smaller.', 'too_large');
      const chunks = []; let size = 0;
      for await (const chunk of req) { size += chunk.length; if (size > attachmentLimit) throw new AppError(413, 'Each file must be 10 MB or smaller.', 'too_large'); chunks.push(chunk); }
      if (!size) fail('This file is empty.');
      let bytes = Buffer.concat(chunks), mime = 'application/octet-stream';
      if (['image/jpeg', 'image/png', 'image/webp'].includes(req.headers['content-type'])) {
        try {
          const input = sharp(bytes, { limitInputPixels: 40000000 });
          const info = await input.metadata();
          if (!['jpeg', 'png', 'webp'].includes(info.format) || (info.pages || 1) > 1) throw new Error();
          bytes = await input.rotate().resize(2000, 2000, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 85 }).toBuffer();
          mime = 'image/webp'; name = `${name.replace(/\.[^.]+$/, '')}.webp`;
        } catch { fail('This photo could not be read. Choose a JPEG, PNG or WebP image.', 'invalid_image'); }
      }
      const current = currentUser(req); access(squadId, current, true);
      if (current.id !== user.id) throw new AppError(401, 'Your session has expired.', 'session_required');
      if (q('SELECT COUNT(*) AS n FROM chat_attachments WHERE user_id=? AND squad_id=? AND message_id IS NULL', user.id, squadId).n >= 3) throw new AppError(409, 'You already have three draft attachments. Send or remove them first.', 'attachment_limit');
      const id = randomUUID();
      run('INSERT INTO chat_attachments(id,squad_id,user_id,name,mime,size,data,created_at) VALUES (?,?,?,?,?,?,?,?)', id, squadId, user.id, name, mime, bytes.length, bytes, now().toISOString());
      return dto({ id, squad_id: squadId, name, mime, size: bytes.length });
    },
    drafts(squadId, user) { access(squadId, user); return all(`SELECT ${metadata} FROM chat_attachments WHERE squad_id=? AND user_id=? AND message_id IS NULL ORDER BY id`, squadId, user.id).map(dto); },
    serve(req, res, squadId, id, user) {
      access(squadId, user);
      const saved = q('SELECT * FROM chat_attachments WHERE id=? AND squad_id=?', id, squadId);
      if (!saved || saved.message_id === null && saved.user_id !== user.id) throw new AppError(404, 'Attachment not found.', 'not_found');
      if (req.method === 'DELETE') {
        if (saved.user_id !== user.id || saved.message_id !== null) throw new AppError(403, 'Only your unsent attachments can be removed.', 'forbidden');
        run('DELETE FROM chat_attachments WHERE id=?', id); return false;
      }
      const inline = saved.mime === 'image/webp' && !new URL(req.url, 'http://localhost').searchParams.has('download');
      const encoded = encodeURIComponent(saved.name).replace(/[!'()*]/g, ch => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);
      res.writeHead(200, { 'content-type': saved.mime, 'content-length': saved.size, 'content-disposition': `${inline ? 'inline' : 'attachment'}; filename="attachment"; filename*=UTF-8''${encoded}`, 'cache-control': 'private, no-store', 'content-security-policy': "default-src 'none'; img-src 'self'; sandbox", 'x-content-type-options': 'nosniff' });
      res.end(Buffer.from(saved.data)); return true;
    },
  };
}
