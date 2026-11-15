import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tracks, archivedTracks, trackById, isActiveTrack, basePlan, withLessonMaterials } from './curricula.js';
import { AppError, fail, validateProfile, generateSchedule, scheduleConflicts, cohortStart } from './scheduling.js';
import { findAutomaticGroup, hasSeparateMeetingDays } from './matchmaking.js';
import { createGoogleMeetService } from './google-meet.js';
import { coursePreview, planAccess } from './progression.js';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const unfinished = ['forming', 'ready', 'active'];
const hash = token => createHash('sha256').update(token).digest('hex');
const id = () => randomUUID();
const textField = (v, max, label, required = false) => {
  if (typeof v !== 'string' || v.length > max || (required && !v.trim())) fail(`${label} must ${required ? 'not be empty and ' : ''}contain at most ${max} characters.`);
  return v.trim();
};
function resultUrl(value) {
  const valueString = textField(value ?? '', 2048, 'Result URL');
  if (!valueString) return '';
  let url; try { url = new URL(valueString); } catch { fail('Enter a complete http:// or https:// result link.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) fail('Use an http:// or https:// result link without credentials.');
  return url.href;
}
function meetUrl(value) {
  const valueString = textField(value ?? '', 2048, 'Meeting URL');
  if (!valueString) return '';
  let url; try { url = new URL(valueString); } catch { fail('Enter a valid Google Meet link.'); }
  if (url.protocol !== 'https:' || url.hostname !== 'meet.google.com' || url.port || url.username || url.password || !/^\/[a-z]{3}-[a-z]{4}-[a-z]{3}\/?$/.test(url.pathname)) fail('Use a Google Meet meeting link such as https://meet.google.com/abc-defg-hij.');
  return url.href;
}
function validateAIWeeks(input, previous) {
  const weeks = Array.isArray(input) ? input : input?.weeks;
  if (!Array.isArray(weeks) || weeks.length !== 4) throw new Error('Invalid AI plan');
  return weeks.map((week, i) => {
    if (week.week !== i + 1 || !Array.isArray(week.tasks) || week.tasks.length !== 2) throw new Error('Invalid AI week');
    return { ...previous[i], week: i + 1, title: textField(week.title, 160, 'Week title', true), preparation: textField(week.preparation, 1600, 'Preparation', true), tasks: week.tasks.map((task, j) => {
      if (task.id !== previous[i].tasks[j].id) throw new Error('AI changed task identity');
      return { ...previous[i].tasks[j], id: task.id, week: i + 1, title: textField(task.title, 200, 'Task title', true), description: textField(task.description, 2400, 'Description', true), criteria: textField(task.criteria, 1600, 'Criteria', true) };
    }) };
  });
}
function configuredAIAdapter() {
  if (!process.env.AI_CHAT_ENDPOINT || !process.env.AI_API_KEY || !process.env.AI_MODEL) return null;
  return async input => {
    const url = new URL(process.env.AI_CHAT_ENDPOINT);
    if (url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error('AI provider requires HTTPS');
    const response = await fetch(url, {
      method: 'POST', signal: AbortSignal.timeout(20000),
      headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.AI_API_KEY}` },
      body: JSON.stringify({ model: process.env.AI_MODEL, response_format: { type: 'json_object' }, messages: [
        { role: 'system', content: 'Adapt a four-week peer-learning curriculum. Return JSON {weeks:[{week,title,preparation,tasks:[{id,week,title,description,criteria}]}]}. Preserve exactly four weeks, two tasks per week, all task ids and week numbers. Keep the same attainable outcome, task intent, scope and prerequisites. Existing step-by-step guidance, practice questions, examples and extension challenges stay fixed; your wording must remain consistent with them. Each meeting is 50 minutes; independent practice is two hours per week. Do not imply a teacher, certification or guaranteed mastery. Use English for explanations; retain target-language examples for a language course. Do not require paid tools or introduce coding prerequisites into a non-coding course. Existing programming AI projects must retain a free mock mode.' },
        { role: 'user', content: JSON.stringify(input) }
      ] })
    });
    if (!response.ok) throw new Error('AI provider unavailable');
    const raw = await response.text();
    if (raw.length > 200000) throw new Error('AI response too large');
    const data = JSON.parse(raw);
    return JSON.parse(data.choices?.[0]?.message?.content ?? '{}');
  };
}

export function createApp({ dbPath = process.env.DB_PATH || path.join(projectRoot, 'data', 'learning-squads.sqlite'), now = () => new Date(), aiAdapter = undefined, meetAdapter, googleMeetConfig, googleOAuthClientFactory } = {}) {
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, profile TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS squads (id TEXT PRIMARY KEY, name TEXT NOT NULL, track_id TEXT NOT NULL, level TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sprints (id TEXT PRIMARY KEY, squad_id TEXT UNIQUE NOT NULL REFERENCES squads(id), status TEXT NOT NULL, starts_at TEXT NOT NULL, ends_at TEXT NOT NULL, timezone TEXT NOT NULL, plan TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS memberships (squad_id TEXT NOT NULL REFERENCES squads(id), user_id TEXT NOT NULL REFERENCES users(id), active INTEGER NOT NULL DEFAULT 1, joined_at TEXT NOT NULL, left_at TEXT, PRIMARY KEY(squad_id,user_id));
    CREATE TABLE IF NOT EXISTS meetings (id TEXT PRIMARY KEY, sprint_id TEXT NOT NULL REFERENCES sprints(id), starts_at TEXT NOT NULL, ends_at TEXT NOT NULL, window_ends_at TEXT NOT NULL, topic TEXT NOT NULL, week INTEGER NOT NULL, meet_url TEXT NOT NULL DEFAULT '', organizer_id TEXT REFERENCES users(id));
    CREATE TABLE IF NOT EXISTS progress (sprint_id TEXT NOT NULL REFERENCES sprints(id), user_id TEXT NOT NULL REFERENCES users(id), task_id TEXT NOT NULL, status TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', url TEXT NOT NULL DEFAULT '', PRIMARY KEY(sprint_id,user_id,task_id));
    CREATE TABLE IF NOT EXISTS rate_events (key TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS matchmaking_queue (user_id TEXT PRIMARY KEY REFERENCES users(id), state TEXT NOT NULL, queued_at TEXT NOT NULL, expires_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS meeting_readiness (meeting_id TEXT NOT NULL REFERENCES meetings(id), user_id TEXT NOT NULL REFERENCES users(id), ready_at TEXT NOT NULL, PRIMARY KEY(meeting_id,user_id));
    CREATE TABLE IF NOT EXISTS meeting_launches (meeting_id TEXT PRIMARY KEY REFERENCES meetings(id), state TEXT NOT NULL, launch_id TEXT NOT NULL, started_at TEXT NOT NULL, space_name TEXT, error TEXT);
    CREATE INDEX IF NOT EXISTS rate_events_key_time ON rate_events(key,created_at);
    CREATE INDEX IF NOT EXISTS memberships_user ON memberships(user_id,active);
    CREATE INDEX IF NOT EXISTS meetings_sprint ON meetings(sprint_id);
  `);
  const q = (sql, ...args) => db.prepare(sql).get(...args);
  const all = (sql, ...args) => db.prepare(sql).all(...args);
  const run = (sql, ...args) => db.prepare(sql).run(...args);
  const stamp = () => now().toISOString();
  const adapter = aiAdapter === undefined ? configuredAIAdapter() : aiAdapter;
  const googleMeet = createGoogleMeetService({ db, now, config: googleMeetConfig, oauthClientFactory: googleOAuthClientFactory });
  const meetConfigured = typeof meetAdapter === 'function' || googleMeet.configured;
  const aiPending = new Set();
  let closed = false;
  let inTransaction = false;
  let lastMatchFingerprint = null;
  function transaction(action) {
    if (inTransaction) return action();
    db.exec('BEGIN IMMEDIATE');
    inTransaction = true;
    try { const result = action(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); lastMatchFingerprint = null; throw error; }
    finally { inTransaction = false; }
  }
  // Preserve existing identities, memberships, meetings, and progress. Numbering
  // is a display-only migration and is assigned once, under a database lock.
  transaction(() => {
    const columns = new Set(all('PRAGMA table_info(squads)').map(column => column.name));
    if (!columns.has('display_number')) db.exec('ALTER TABLE squads ADD COLUMN display_number INTEGER');
    if (!columns.has('auto_matched')) db.exec('ALTER TABLE squads ADD COLUMN auto_matched INTEGER NOT NULL DEFAULT 0');
    let next = q('SELECT COALESCE(MAX(display_number),0) AS n FROM squads').n;
    for (const squad of all('SELECT id,track_id,display_number FROM squads ORDER BY created_at,id')) {
      const number = squad.display_number || ++next;
      const name = `${trackById(squad.track_id)?.title || squad.track_id} #${String(number).padStart(3, '0')}`;
      run('UPDATE squads SET name=?,display_number=? WHERE id=?', name, number, squad.id);
    }
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS squads_display_number ON squads(display_number)');
    retireArchivedSearches();
  });
  function rate(key, limit, duration) {
    const time = now().getTime();
    run('DELETE FROM rate_events WHERE created_at < ?', time - 86400000);
    if (q('SELECT COUNT(*) AS count FROM rate_events WHERE key = ? AND created_at > ?', key, time - duration).count >= limit) throw new AppError(429, 'Too many requests. Please try again later.', 'rate_limited');
    run('INSERT INTO rate_events(key,created_at) VALUES (?,?)', key, time);
  }
  function refreshLifecycle() {
    return transaction(() => {
      const time = stamp();
      for (const sprint of all("SELECT * FROM sprints WHERE status IN ('forming','ready','active')")) {
        const count = q('SELECT COUNT(*) AS n FROM memberships WHERE squad_id = ? AND active = 1', sprint.squad_id).n;
        let status = sprint.status;
        if (status !== 'active') status = count >= 3 ? 'ready' : 'forming';
        if (status !== 'active' && (count === 0 || time >= sprint.starts_at)) status = count >= 3 ? 'active' : 'closed';
        if (status === 'active' && time >= sprint.ends_at) status = 'completed';
        if (status !== sprint.status) run('UPDATE sprints SET status = ? WHERE id = ?', status, sprint.id);
      }
    });
  }
  function profile(userId) {
    const row = q('SELECT profile FROM users WHERE id = ?', userId);
    return row ? { ...JSON.parse(row.profile), id: userId } : null;
  }
  function userFromRequest(req) {
    const cookie = req.headers.cookie?.split(';').map(s => s.trim()).find(s => s.startsWith('ls_session='));
    if (!cookie) return null;
    const token = cookie.slice('ls_session='.length);
    if (!/^[a-f0-9]{64}$/.test(token)) return null;
    const session = q('SELECT user_id FROM sessions WHERE token_hash = ? AND expires_at > ?', hash(token), stamp());
    return session ? profile(session.user_id) : null;
  }
  function requireUser(user, complete = true) {
    if (!user) throw new AppError(401, 'Start a guest session to continue.', 'session_required');
    if (complete && !user.trackId) throw new AppError(400, 'Complete your profile first.', 'profile_required');
    return user;
  }
  function requireActiveTrack(trackId) {
    if (!isActiveTrack(trackId)) throw new AppError(409, 'This course is archived. Choose an available course to find a new squad.', 'track_archived');
  }
  function current(userId) {
    return q("SELECT s.squad_id AS id FROM sprints s JOIN memberships m ON m.squad_id = s.squad_id WHERE m.user_id = ? AND m.active = 1 AND s.status IN ('forming','ready','active') LIMIT 1", userId)?.id || null;
  }
  function squadRow(squadId) {
    const row = q('SELECT q.*,s.id AS sprint_id,s.status,s.starts_at,s.ends_at,s.timezone,s.plan FROM squads q JOIN sprints s ON s.squad_id = q.id WHERE q.id = ?', squadId);
    if (!row) throw new AppError(404, 'Squad not found.', 'not_found');
    return row;
  }
  function meetingRows(sprintId, privateFields = false) {
    return all('SELECT m.*,u.profile AS organizer_profile FROM meetings m LEFT JOIN users u ON u.id = m.organizer_id WHERE m.sprint_id = ? ORDER BY m.starts_at', sprintId).map(m => ({ id: m.id, startsAt: m.starts_at, endsAt: m.ends_at, windowEndsAt: m.window_ends_at, topic: m.topic, week: m.week, ...(privateFields ? { meetUrl: m.meet_url, organizerName: m.organizer_profile ? JSON.parse(m.organizer_profile).name : null } : {}) }));
  }
  function members(squadId, includeFormer = false, selfId = null) {
    return all(`SELECT m.*,u.profile FROM memberships m JOIN users u ON m.user_id=u.id WHERE m.squad_id = ? ${includeFormer ? '' : 'AND m.active = 1'} ORDER BY m.joined_at,m.user_id`, squadId).map(m => ({ id: m.user_id, name: JSON.parse(m.profile).name, ...(includeFormer ? { active: !!m.active, isSelf: m.user_id === selfId } : {}) }));
  }
  function summary(row) {
    const roster = members(row.id);
    const name = `${trackById(row.track_id).title} #${String(row.display_number).padStart(3, '0')}`;
    return { id: row.id, name, number: row.display_number, trackId: row.track_id, level: row.level, status: row.status, memberCount: roster.length, capacity: 4, members: roster, meetings: meetingRows(row.sprint_id), startDate: row.starts_at, endDate: row.ends_at };
  }
  function bootstrap(user) {
    const currentSquadId = user ? current(user.id) : null;
    const history = user ? all('SELECT squad_id FROM memberships WHERE user_id = ? ORDER BY joined_at DESC', user.id).filter(m => m.squad_id !== currentSquadId).map(m => summary(squadRow(m.squad_id))) : [];
    return { user, tracks: tracks.map(coursePreview), archivedTracks: archivedTracks.map(coursePreview), currentSquadId, history, aiAvailable: !!adapter, matchmaking: user ? searchState(user.id) : { status: 'idle' } };
  }
  function retireArchivedSearches() {
    for (const person of all("SELECT m.user_id,u.profile FROM matchmaking_queue m JOIN users u ON u.id=m.user_id WHERE m.state='waiting'")) {
      if (!isActiveTrack(JSON.parse(person.profile).trackId)) run("UPDATE matchmaking_queue SET state='expired' WHERE user_id=? AND state='waiting'", person.user_id);
    }
  }
  function expireSearches() {
    run("UPDATE matchmaking_queue SET state='expired' WHERE state='waiting' AND expires_at <= ?", stamp());
    retireArchivedSearches();
  }
  function searchState(userId) {
    const squadId = current(userId);
    if (squadId) return { status: 'matched', squadId, squad: summary(squadRow(squadId)), message: 'Your place is reserved. All eight meeting windows match the preferences used for your search.' };
    expireSearches();
    const search = q('SELECT * FROM matchmaking_queue WHERE user_id=?', userId);
    if (!search) return { status: 'idle' };
    if (search.state === 'expired') return { status: 'expired', message: 'Your search expired while this page was inactive. Start again when you are ready.' };
    return { status: 'waiting', waitingSince: search.queued_at, expiresAt: search.expires_at, message: 'Looking for at least three learners with the same course, level, and eight compatible meeting windows. Keep this page open.' };
  }
  function createSquadRecord(anchor, schedule, participantIds, automatic = false) {
    requireActiveTrack(anchor.trackId);
    if (participantIds.length < 1 || participantIds.length > 4 || new Set(participantIds).size !== participantIds.length) throw new Error('Invalid team membership');
    for (const userId of participantIds) if (current(userId)) throw new AppError(409, 'A learner has already joined another unfinished sprint.', 'active_squad');
    const squadId = id(), sprintId = id(), plan = basePlan(anchor.trackId, anchor.level);
    const number = q('SELECT COALESCE(MAX(display_number),0)+1 AS n FROM squads').n;
    const name = `${trackById(anchor.trackId).title} #${String(number).padStart(3, '0')}`;
    run('INSERT INTO squads(id,name,track_id,level,created_at,display_number,auto_matched) VALUES (?,?,?,?,?,?,?)', squadId, name, anchor.trackId, anchor.level, stamp(), number, automatic ? 1 : 0);
    run('INSERT INTO sprints(id,squad_id,status,starts_at,ends_at,timezone,plan) VALUES (?,?,?,?,?,?,?)', sprintId, squadId, participantIds.length >= 3 ? 'ready' : 'forming', schedule.startDate, schedule.endDate, anchor.timezone, JSON.stringify(plan));
    for (const userId of participantIds) {
      run('INSERT INTO memberships(squad_id,user_id,active,joined_at) VALUES (?,?,1,?)', squadId, userId, stamp());
      run('DELETE FROM matchmaking_queue WHERE user_id=?', userId);
    }
    const tasks = plan.weeks.flatMap(week => week.tasks);
    for (const [index, meeting] of schedule.meetings.entries()) run('INSERT INTO meetings(id,sprint_id,starts_at,ends_at,window_ends_at,topic,week) VALUES (?,?,?,?,?,?,?)', id(), sprintId, meeting.startsAt, meeting.endsAt, meeting.windowEndsAt, tasks[index].title, meeting.week);
    lastMatchFingerprint = null;
    return squadId;
  }
  function attemptMatchmaking() {
    return transaction(() => {
      refreshLifecycle();
      expireSearches();
      // Membership changes and queue consumption share this BEGIN IMMEDIATE lock.
      run("DELETE FROM matchmaking_queue WHERE user_id IN (SELECT m.user_id FROM memberships m JOIN sprints s ON s.squad_id=m.squad_id WHERE m.active=1 AND s.status IN ('forming','ready','active'))");
      let queued = all("SELECT u.id,u.profile,m.queued_at FROM matchmaking_queue m JOIN users u ON u.id=m.user_id WHERE m.state='waiting' ORDER BY m.queued_at,m.rowid").map(row => ({ ...JSON.parse(row.profile), id: row.id, queuedAt: row.queued_at }));
      const open = all("SELECT q.*,s.id AS sprint_id,s.status,s.starts_at,s.ends_at,s.timezone,s.plan FROM squads q JOIN sprints s ON s.squad_id=q.id WHERE q.auto_matched=1 AND s.status='ready' AND s.starts_at > ? ORDER BY s.starts_at,q.display_number", stamp()).filter(row => isActiveTrack(row.track_id) && members(row.id).length === 3);
      const fingerprint = JSON.stringify([queued.map(person => [person.id, person.trackId, person.level, person.timezone, person.availability, person.queuedAt, cohortStart(person.timezone, now())]), open.map(row => [row.id, members(row.id).map(member => member.id)])]);
      if (fingerprint === lastMatchFingerprint) return;
      lastMatchFingerprint = fingerprint;
      // A fourth searching learner may join an automatically created future team.
      for (const row of open) {
        const candidate = queued.find(person => {
          try { canJoin(person, row); return hasSeparateMeetingDays(person, meetingRows(row.sprint_id)); } catch (error) { if (error instanceof AppError) return false; throw error; }
        });
        if (!candidate) continue;
        run('INSERT INTO memberships(squad_id,user_id,active,joined_at,left_at) VALUES (?,?,1,?,NULL) ON CONFLICT(squad_id,user_id) DO UPDATE SET active=1,joined_at=excluded.joined_at,left_at=NULL', row.id, candidate.id, stamp());
        run('DELETE FROM matchmaking_queue WHERE user_id=?', candidate.id);
        queued = queued.filter(person => person.id !== candidate.id);
      }
      const partitions = new Map();
      for (const person of queued) {
        const key = `${person.trackId}:${person.level}`;
        if (!partitions.has(key)) partitions.set(key, []);
        partitions.get(key).push(person);
      }
      for (let people of partitions.values()) {
        while (people.length >= 3) {
          const group = findAutomaticGroup(people, now());
          if (!group) break;
          const selected = new Set(group.participants.map(person => person.id));
          createSquadRecord(group.anchor, group.schedule, [...selected], true);
          people = people.filter(person => !selected.has(person.id));
        }
      }
    });
  }
  function authorizeMember(squadId, user, edit = false) {
    requireUser(user, false);
    const row = squadRow(squadId);
    const membership = q('SELECT * FROM memberships WHERE squad_id = ? AND user_id = ?', squadId, user.id);
    if (!membership) throw new AppError(403, 'Only this squad’s members can access its workspace.', 'forbidden');
    if (edit && (!membership.active || !unfinished.includes(row.status))) throw new AppError(403, 'This sprint is read-only for you.', 'read_only');
    return { row, membership };
  }
  function results(sprintId, userId, plan) {
    const stored = new Map(all('SELECT * FROM progress WHERE sprint_id = ? AND user_id = ?', sprintId, userId).map(p => [p.task_id, p]));
    return plan.weeks.flatMap(w => w.tasks).map(task => { const p = stored.get(task.id); return { taskId: task.id, status: p?.status || 'not_started', note: p?.note || '', url: p?.url || '' }; });
  }
  function dashboard(squadId, user) {
    const { row, membership } = authorizeMember(squadId, user);
    const plan = withLessonMaterials(JSON.parse(row.plan), row.track_id);
    const roster = members(squadId, true, user.id);
    const progress = results(row.sprint_id, user.id, plan);
    const canEdit = !!membership.active && unfinished.includes(row.status);
    const learning = planAccess({ plan, progress, squad: { createdAt: row.created_at, startsAt: row.starts_at, endsAt: row.ends_at, timezone: row.timezone, status: row.status }, meetings: meetingRows(row.sprint_id), now: now(), canEdit });
    const connection = { configured: meetConfigured, connected: !!meetAdapter || googleMeet.connected(user.id), organizerAvailable: !!meetingOrganizer(squadId), ...(!meetConfigured ? { message: 'Automatic Google Meet is not configured on this installation yet.' } : {}) };
    const meetings = meetingRows(row.sprint_id, true).map(meeting => {
      const readiness = meetingReadiness(row, meeting.id, user.id, !!membership.active);
      const past = meeting.endsAt <= stamp();
      return { ...meeting, meetUrl: past || (membership.active && readiness.allReady && readiness.status === 'ready') ? meeting.meetUrl : '', readiness };
    });
    return { squad: summary(row), members: roster, meetings, googleMeet: connection, plan: learning.plan, learningProgress: learning.learningProgress, progress, teamProgress: roster.map(m => { const p = results(row.sprint_id, m.id, plan); return { userId: m.id, name: m.name, done: p.filter(x => x.status === 'done').length, total: p.length, results: p.map(result => learning.accessByTask.get(result.taskId)?.unlocked ? result : { ...result, note: '', url: '', locked: true }) }; }), isMember: !!membership.active, canEdit };
  }
  function meetingOrganizer(squadId) {
    return members(squadId).find(member => !!meetAdapter || googleMeet.connected(member.id))?.id || null;
  }
  function meetingReadiness(row, meetingId, selfId, activeMember = true) {
    const meeting = q('SELECT * FROM meetings WHERE id=? AND sprint_id=?', meetingId, row.sprint_id);
    if (!meeting) throw new AppError(404, 'Meeting not found.', 'not_found');
    const nearest = q('SELECT id FROM meetings WHERE sprint_id=? AND ends_at > ? ORDER BY starts_at LIMIT 1', row.sprint_id, stamp());
    const eligible = activeMember && ['ready', 'active'].includes(row.status) && nearest?.id === meetingId;
    const saved = new Map(all('SELECT user_id,ready_at FROM meeting_readiness WHERE meeting_id=?', meetingId).map(person => [person.user_id, person.ready_at]));
    const roster = all('SELECT m.user_id,m.joined_at,u.profile FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.squad_id=? AND m.active=1 ORDER BY m.joined_at,m.user_id', row.id).map(person => ({ id: person.user_id, name: JSON.parse(person.profile).name, ready: saved.has(person.user_id) && saved.get(person.user_id) >= person.joined_at }));
    const readyCount = roster.filter(person => person.ready).length;
    const allReady = eligible && roster.length > 0 && readyCount === roster.length;
    const launch = q('SELECT * FROM meeting_launches WHERE meeting_id=?', meetingId);
    const creating = launch?.state === 'creating' && Date.parse(launch.started_at) + 60000 > now().getTime();
    let status = 'waiting';
    let error;
    if (allReady && meeting.meet_url && launch?.state !== 'error' && !creating) status = 'ready';
    else if (creating) status = 'creating';
    else if (launch?.state === 'error' || launch?.state === 'creating') { status = 'error'; error = launch.error || 'Conference creation was interrupted. Please retry.'; }
    else if (!meeting.meet_url && !meetConfigured) status = 'setup_required';
    else if (!meeting.meet_url && !meetingOrganizer(row.id)) status = 'connection_required';
    return { eligible, selfReady: activeMember && !!roster.find(person => person.id === selfId)?.ready, readyCount, totalCount: roster.length, members: activeMember ? roster : [], allReady, status, ...(error ? { error } : {}), ...(meeting.meet_url ? { launchId: launch?.launch_id || `${meetingId}:${hash(meeting.meet_url).slice(0,16)}` } : {}) };
  }
  function canJoin(user, row) {
    requireActiveTrack(row.track_id);
    if (!['forming', 'ready'].includes(row.status) || row.starts_at <= stamp()) throw new AppError(409, 'Recruitment has closed for this squad.', 'recruitment_closed');
    if (members(row.id).length >= 4) throw new AppError(409, 'This squad just filled up. Search for another squad.', 'squad_full');
    if (user.trackId !== row.track_id || user.level !== row.level || scheduleConflicts(user, meetingRows(row.sprint_id)).length) throw new AppError(409, 'This squad does not fit your track, level, or all eight meeting windows.', 'incompatible_schedule');
  }
  function json(res, status, value) { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(value)); }
  async function body(req) {
    if (!req.headers['content-type']?.toLowerCase().startsWith('application/json')) throw new AppError(415, 'Send JSON content.', 'invalid_content_type');
    const chunks = []; let size = 0;
    for await (const chunk of req) { size += chunk.length; if (size > 32768) throw new AppError(413, 'Request is too large.', 'too_large'); chunks.push(chunk); }
    const raw = Buffer.concat(chunks).toString('utf8');
    let parsed; try { parsed = JSON.parse(raw || '{}'); } catch { fail('The request is not valid JSON.'); }
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') fail('Provide a JSON object.');
    return parsed;
  }
  function validateOrigin(req) {
    if (req.headers['sec-fetch-site'] === 'cross-site') throw new AppError(403, 'Cross-site requests are not allowed.', 'invalid_origin');
    if (req.headers.origin) {
      let origin; try { origin = new URL(req.headers.origin); } catch { throw new AppError(403, 'Invalid request origin.', 'invalid_origin'); }
      const configured = process.env.APP_ORIGIN;
      if (configured ? origin.origin !== configured : origin.host !== req.headers.host) throw new AppError(403, 'Cross-site requests are not allowed.', 'invalid_origin');
    }
  }
  async function handleAPI(req, res, pathname) {
    const method = req.method;
    const mutation = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
    if (mutation) validateOrigin(req);
    const data = mutation ? await body(req) : null;
    // Resolve state only after consuming the body: other requests may have changed
    // the profile, membership, or lifecycle while a slow upload was in flight.
    refreshLifecycle();
    let user = userFromRequest(req);
    if (method === 'GET' && pathname === '/api/health') return json(res, 200, { ok: true });
    if (method === 'GET' && pathname === '/api/bootstrap') return json(res, 200, bootstrap(user));
    if (method === 'GET' && pathname === '/api/google-meet/callback') {
      const result = await googleMeet.callback(new URL(req.url, 'http://localhost'), user?.id, (squadId, userId) => { refreshLifecycle(); authorizeMember(squadId, profile(userId), true); });
      res.writeHead(303, { location: result.squadId ? `/squads/${encodeURIComponent(result.squadId)}?googleMeet=${result.connected ? 'connected' : 'error'}` : '/?googleMeet=error', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' });
      return res.end();
    }
    if (method === 'POST' && pathname === '/api/session') {
      if (!user) {
        rate(`session:${req.socket.remoteAddress}`, 60, 3600000);
        const userId = id(), token = randomBytes(32).toString('hex');
        const fresh = { name: '', trackId: '', level: '', timezone: 'UTC', availability: [] };
        transaction(() => { run('INSERT INTO users VALUES (?,?,?)', userId, JSON.stringify(fresh), stamp()); run('INSERT INTO sessions VALUES (?,?,?)', hash(token), userId, new Date(now().getTime() + 365 * 86400000).toISOString()); });
        const secure = process.env.NODE_ENV === 'production' || process.env.COOKIE_SECURE === 'true' || !!req.socket.encrypted;
        res.setHeader('Set-Cookie', `ls_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${secure ? '; Secure' : ''}`);
        user = profile(userId);
      }
      return json(res, 200, bootstrap(user));
    }
    requireUser(user, false);
    if (method === 'POST' && pathname === '/api/google-meet/connect') {
      if (typeof data.squadId !== 'string') fail('Choose your squad before connecting Google Meet.');
      authorizeMember(data.squadId, user, true);
      if (!googleMeet.configured) throw new AppError(503, 'Automatic Google Meet needs to be configured by the site owner first.', 'meet_setup_required');
      rate(`google-connect:${user.id}`, 8, 3600000);
      try { return json(res, 200, await googleMeet.begin(user.id, data.squadId)); }
      catch { throw new AppError(503, 'Google Meet could not be connected. Please try again.', 'google_connect_failed'); }
    }
    if (method === 'DELETE' && pathname === '/api/google-meet/connection') {
      await googleMeet.disconnect(user.id);
      return json(res, 200, { ok: true });
    }
    const readinessRoute = pathname.match(/^\/api\/squads\/([^/]+)\/meetings\/([^/]+)\/(readiness|launch)$/);
    if (readinessRoute) {
      const [, squadId, meetingId, action] = readinessRoute;
      if (method === 'PUT' && action === 'readiness') {
        if (typeof data.ready !== 'boolean') fail('Readiness must be true or false.');
        transaction(() => {
          const { row } = authorizeMember(squadId, user, true);
          if (!meetingReadiness(row, meetingId, user.id).eligible) throw new AppError(409, 'Only your next meeting can accept readiness.', 'meeting_not_eligible');
          if (data.ready) run('INSERT INTO meeting_readiness VALUES (?,?,?) ON CONFLICT(meeting_id,user_id) DO UPDATE SET ready_at=excluded.ready_at', meetingId, user.id, stamp());
          else run('DELETE FROM meeting_readiness WHERE meeting_id=? AND user_id=?', meetingId, user.id);
        });
        return json(res, 200, dashboard(squadId, user));
      }
      if (method === 'POST' && action === 'launch') {
        const claim = transaction(() => {
          const { row } = authorizeMember(squadId, user, true);
          const readiness = meetingReadiness(row, meetingId, user.id);
          if (!readiness.eligible || !readiness.allReady) throw new AppError(409, 'Every current teammate must confirm readiness for this meeting first.', 'teammates_not_ready');
          const meeting = q('SELECT * FROM meetings WHERE id=?', meetingId);
          if (readiness.status === 'ready' || readiness.status === 'creating') return null;
          const organizerId = meetingOrganizer(squadId);
          if (!meetConfigured || !organizerId) return null;
          if (meeting.meet_url && members(squadId).some(member => member.id === meeting.organizer_id) && (meetAdapter || googleMeet.connected(meeting.organizer_id))) {
            run("UPDATE meeting_launches SET state='ready',error=NULL WHERE meeting_id=?", meetingId);
            return null;
          }
          rate(`meet-create:${meetingId}`, 5, 600000);
          const launchId = id();
          // An old space whose organizer lost authorization before completion is
          // never released. An explicit retry may choose a new connected organizer.
          if (meeting.meet_url) run("UPDATE meetings SET meet_url='',organizer_id=NULL WHERE id=?", meetingId);
          run("INSERT INTO meeting_launches(meeting_id,state,launch_id,started_at,error) VALUES (?,'creating',?,?,NULL) ON CONFLICT(meeting_id) DO UPDATE SET state='creating',launch_id=excluded.launch_id,started_at=excluded.started_at,error=NULL", meetingId, launchId, stamp());
          return { organizerId, launchId };
        });
        if (!claim) return json(res, 200, dashboard(squadId, user));
        try {
          let timer;
          const operation = meetAdapter ? () => meetAdapter({ meetingId, squadId, organizerId: claim.organizerId }) : () => googleMeet.createMeeting(claim.organizerId);
          const result = await Promise.race([Promise.resolve().then(operation), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Creation timeout')), 25000); timer.unref?.(); })]).finally(() => clearTimeout(timer));
          const url = meetUrl(result?.url);
          if (!url) throw new Error('Missing meeting URL');
          transaction(() => {
            refreshLifecycle();
            const currentLaunch = q('SELECT launch_id FROM meeting_launches WHERE meeting_id=?', meetingId);
            if (currentLaunch?.launch_id !== claim.launchId) return;
            // Keep the successfully created space even when readiness changed during
            // the network call. Dashboard gating rechecks the current roster before
            // exposing it, and a later retry reuses this URL instead of creating another.
            const organizerStillAuthorized = members(squadId).some(member => member.id === claim.organizerId) && (!!meetAdapter || googleMeet.connected(claim.organizerId));
            run('UPDATE meetings SET meet_url=?,organizer_id=? WHERE id=?', url, claim.organizerId, meetingId);
            run('UPDATE meeting_launches SET state=?,space_name=?,error=? WHERE meeting_id=? AND launch_id=?', organizerStillAuthorized ? 'ready' : 'error', typeof result.spaceName === 'string' ? result.spaceName.slice(0,500) : null, organizerStillAuthorized ? null : 'The organizer left or disconnected during conference creation. Connect a current organizer and retry.', meetingId, claim.launchId);
          });
        } catch {
          run("UPDATE meeting_launches SET state='error',error=? WHERE meeting_id=? AND launch_id=?", 'Google Meet could not create this conference. Check the organizer connection and try again.', meetingId, claim.launchId);
        }
        refreshLifecycle();
        return json(res, 200, dashboard(squadId, profile(user.id)));
      }
      throw new AppError(405, 'Method not allowed.', 'method_not_allowed');
    }
    if (pathname === '/api/matchmaking' && method === 'GET') return json(res, 200, searchState(user.id));
    if (pathname === '/api/matchmaking' && method === 'DELETE') {
      const state = transaction(() => {
        run('DELETE FROM matchmaking_queue WHERE user_id=?', user.id);
        lastMatchFingerprint = null;
        return searchState(user.id);
      });
      return json(res, 200, state);
    }
    if (method === 'POST' && ['/api/matchmaking', '/api/matchmaking/poll'].includes(pathname)) {
      requireUser(user);
      const state = transaction(() => {
        expireSearches();
        if (current(user.id)) return searchState(user.id);
        requireActiveTrack(user.trackId);
        const existing = q('SELECT * FROM matchmaking_queue WHERE user_id=?', user.id);
        const expiresAt = new Date(now().getTime() + 120000).toISOString();
        if (pathname.endsWith('/poll')) {
          if (existing?.state !== 'waiting') return searchState(user.id);
          run('UPDATE matchmaking_queue SET expires_at=? WHERE user_id=?', expiresAt, user.id);
        } else if (existing?.state === 'waiting') {
          run('UPDATE matchmaking_queue SET expires_at=? WHERE user_id=?', expiresAt, user.id);
        } else {
          rate(`search:${user.id}`, 30, 3600000);
          run("INSERT INTO matchmaking_queue(user_id,state,queued_at,expires_at) VALUES (?,'waiting',?,?) ON CONFLICT(user_id) DO UPDATE SET state='waiting',queued_at=excluded.queued_at,expires_at=excluded.expires_at", user.id, stamp(), expiresAt);
        }
        attemptMatchmaking();
        return searchState(user.id);
      });
      return json(res, 200, state);
    }
    if (method === 'PUT' && pathname === '/api/profile') {
      transaction(() => {
        const activeId = current(user.id);
        const next = validateProfile(data, { allowedArchivedTrackId: activeId ? squadRow(activeId).track_id : undefined });
        if (activeId) {
          const active = squadRow(activeId);
          if (active.track_id !== next.trackId || active.level !== next.level) throw new AppError(409, 'Leave your current squad before changing track or level.', 'active_squad');
          const conflicts = scheduleConflicts(next, meetingRows(active.sprint_id));
          if (conflicts.length && data.confirmConflict !== true) throw new AppError(409, 'Your new availability conflicts with the existing squad schedule. Keep the commitment explicitly or leave the squad.', 'schedule_conflict', { conflicts });
        }
        run('UPDATE users SET profile = ? WHERE id = ?', JSON.stringify(next), user.id);
        run('DELETE FROM matchmaking_queue WHERE user_id=?', user.id);
        lastMatchFingerprint = null;
      });
      return json(res, 200, bootstrap(profile(user.id)));
    }
    if (method === 'GET' && pathname === '/api/matches') {
      requireUser(user);
      if (!current(user.id)) requireActiveTrack(user.trackId);
      const compatible = current(user.id) ? [] : all("SELECT q.*,s.id AS sprint_id,s.status,s.starts_at,s.ends_at,s.timezone,s.plan FROM squads q JOIN sprints s ON s.squad_id=q.id WHERE q.track_id=? AND q.level=? AND s.status IN ('forming','ready') ORDER BY s.starts_at,q.created_at", user.trackId, user.level).filter(row => {
        try { canJoin(user, row); return true; } catch (error) { if (error instanceof AppError) return false; throw error; }
      }).map(summary).sort((a, b) => Number(b.memberCount === 2) - Number(a.memberCount === 2) || a.startDate.localeCompare(b.startDate));
      return json(res, 200, { squads: compatible.slice(0, 3), cohortStart: cohortStart(user.timezone, now()) });
    }
    if (method === 'POST' && pathname === '/api/squads/preview') {
      requireUser(user);
      requireActiveTrack(user.trackId);
      const preview = generateSchedule(user, data.slots, now());
      const tasks = trackById(user.trackId).weeks.flatMap(w => w.tasks);
      preview.meetings.forEach((meeting, i) => meeting.topic = tasks[i].title);
      return json(res, 200, preview);
    }
    if (method === 'POST' && pathname === '/api/squads') {
      requireUser(user);
      const created = transaction(() => {
        if (current(user.id)) throw new AppError(409, 'You already have an unfinished sprint.', 'active_squad');
        rate(`create:${user.id}`, 5, 3600000);
        const schedule = generateSchedule(user, data.slots, now());
        const squadId = createSquadRecord(user, schedule, [user.id]);
        return { squadId };
      });
      return json(res, 201, created);
    }
    const match = pathname.match(/^\/api\/squads\/([^/]+)(?:\/(join|leave|adapt|meetings|progress)(?:\/([^/]+))?)?$/);
    if (!match) throw new AppError(404, 'Endpoint not found.', 'not_found');
    const [, squadId, action, resourceId] = match;
    if (method === 'GET' && !action) return json(res, 200, dashboard(squadId, user));
    if (method === 'POST' && action === 'join') {
      requireUser(user);
      transaction(() => {
        const row = squadRow(squadId);
        const existing = q('SELECT * FROM memberships WHERE squad_id = ? AND user_id = ?', squadId, user.id);
        if (existing?.active) { run('DELETE FROM matchmaking_queue WHERE user_id=?', user.id); return; }
        if (current(user.id)) throw new AppError(409, 'You already have an unfinished sprint.', 'active_squad');
        canJoin(user, row);
        run('INSERT INTO memberships(squad_id,user_id,active,joined_at,left_at) VALUES (?,?,1,?,NULL) ON CONFLICT(squad_id,user_id) DO UPDATE SET active=1,joined_at=excluded.joined_at,left_at=NULL', squadId, user.id, stamp());
        run('DELETE FROM matchmaking_queue WHERE user_id=?', user.id);
        lastMatchFingerprint = null;
        refreshLifecycle();
      });
      return json(res, 200, { squadId });
    }
    if (method === 'POST' && action === 'leave') {
      transaction(() => { const { row } = authorizeMember(squadId, user); run('UPDATE memberships SET active=0,left_at=? WHERE squad_id=? AND user_id=? AND active=1', stamp(), squadId, user.id); run('DELETE FROM meeting_readiness WHERE user_id=? AND meeting_id IN (SELECT id FROM meetings WHERE sprint_id=?)', user.id, row.sprint_id); lastMatchFingerprint = null; refreshLifecycle(); });
      return json(res, 200, { ok: true });
    }
    if (method === 'PUT' && action === 'meetings' && resourceId) {
      const { row } = authorizeMember(squadId, user, true);
      if (!q('SELECT id FROM meetings WHERE id=? AND sprint_id=?', resourceId, row.sprint_id)) throw new AppError(404, 'Meeting not found.', 'not_found');
      const url = meetUrl(data.url);
      if (q("SELECT meeting_id FROM meeting_launches WHERE meeting_id=? AND state='creating' AND started_at > ?", resourceId, new Date(now().getTime() - 60000).toISOString())) throw new AppError(409, 'A conference is being created. Please wait.', 'meet_creation_pending');
      run('UPDATE meetings SET meet_url=?,organizer_id=? WHERE id=?', url, url ? user.id : null, resourceId);
      run('INSERT INTO meeting_launches(meeting_id,state,launch_id,started_at) VALUES (?,?,?,?) ON CONFLICT(meeting_id) DO UPDATE SET state=excluded.state,launch_id=excluded.launch_id,started_at=excluded.started_at,error=NULL', resourceId, url ? 'ready' : 'waiting', id(), stamp());
      return json(res, 200, { ok: true });
    }
    if (method === 'PUT' && action === 'progress' && resourceId) {
      if (!['not_started', 'in_progress', 'done'].includes(data.status)) fail('Choose a valid task status.');
      const note = textField(data.note ?? '', 3000, 'Your notes');
      const url = resultUrl(data.url);
      transaction(() => {
        const { row } = authorizeMember(squadId, user, true);
        const plan = JSON.parse(row.plan);
        const access = planAccess({ plan, progress: results(row.sprint_id, user.id, plan), squad: { createdAt: row.created_at, startsAt: row.starts_at, endsAt: row.ends_at, timezone: row.timezone, status: row.status }, meetings: meetingRows(row.sprint_id), now: now(), canEdit: true }).accessByTask.get(resourceId);
        if (!access) throw new AppError(404, 'Task not found.', 'not_found');
        if (!access.canEdit) throw new AppError(409, access.message || 'This lesson is not available yet.', 'lesson_locked', { access });
        run('INSERT INTO progress(sprint_id,user_id,task_id,status,note,url) VALUES (?,?,?,?,?,?) ON CONFLICT(sprint_id,user_id,task_id) DO UPDATE SET status=excluded.status,note=excluded.note,url=excluded.url', row.sprint_id, user.id, resourceId, data.status, note, url);
      });
      return json(res, 200, { ok: true });
    }
    if (method === 'POST' && action === 'adapt') {
      const { row } = authorizeMember(squadId, user, true);
      const existing = withLessonMaterials(JSON.parse(row.plan), row.track_id);
      if (existing.source === 'ai') return json(res, 200, { source: 'ai', message: 'This saved plan is already AI-adapted.' });
      const started = () => q("SELECT COUNT(*) AS n FROM progress WHERE sprint_id=? AND (status != 'not_started' OR note != '' OR url != '')", row.sprint_id).n > 0;
      if (started()) throw new AppError(409, 'Work has already started. The saved plan will stay unchanged.', 'plan_locked');
      if (!adapter) return json(res, 200, { source: 'base', message: 'AI adaptation is not configured. Your complete base plan is ready to use.' });
      if (aiPending.has(row.sprint_id)) throw new AppError(409, 'Plan adaptation is already running. Try again shortly.', 'adaptation_pending');
      rate(`ai:${user.id}`, 3, 3600000);
      rate(`ai-sprint:${row.sprint_id}`, 5, 3600000);
      aiPending.add(row.sprint_id);
      try {
        const input = { trackId: row.track_id, track: trackById(row.track_id).title, category: trackById(row.track_id).category, prerequisite: trackById(row.track_id).prerequisite, level: row.level, project: trackById(row.track_id).project, durationWeeks: 4, meetingsPerWeek: 2, meetingMinutes: 50, independentHoursPerWeek: 2, weeks: existing.weeks, basePlan: existing };
        let timer;
        const result = await Promise.race([Promise.resolve().then(() => adapter(input)), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('AI timeout')), 22000); timer.unref?.(); })]).finally(() => clearTimeout(timer));
        const weeks = validateAIWeeks(result, existing.weeks);
        transaction(() => {
          refreshLifecycle(); authorizeMember(squadId, profile(user.id), true);
          if (started()) throw new AppError(409, 'Work started while adaptation was running. Your original plan is preserved.', 'plan_locked');
          if (JSON.parse(squadRow(squadId).plan).source === 'ai') return;
          run('UPDATE sprints SET plan=? WHERE id=?', JSON.stringify({ ...existing, source: 'ai', weeks }), row.sprint_id);
          const meetings = meetingRows(row.sprint_id);
          weeks.flatMap(w => w.tasks).forEach((task, index) => run('UPDATE meetings SET topic=? WHERE id=?', task.title, meetings[index].id));
        });
        return json(res, 200, { source: 'ai', message: 'Your adapted plan is saved for this sprint.' });
      } catch (error) {
        if (error instanceof AppError && ['plan_locked', 'read_only', 'forbidden'].includes(error.code)) throw error;
        return json(res, 200, { source: 'base', message: 'AI adaptation is temporarily unavailable. Your complete base plan is unchanged.' });
      } finally { aiPending.delete(row.sprint_id); }
    }
    throw new AppError(404, 'Endpoint not found.', 'not_found');
  }
  const mimeTypes = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    try {
      const pathname = new URL(req.url, 'http://localhost').pathname;
      if (pathname.startsWith('/api/')) return await handleAPI(req, res, pathname);
      if (!['GET', 'HEAD'].includes(req.method)) return json(res, 405, { error: 'Method not allowed.' });
      let decoded; try { decoded = decodeURIComponent(pathname); } catch { return json(res, 400, { error: 'Invalid URL.' }); }
      const dist = path.join(projectRoot, 'dist');
      let filename = path.resolve(dist, `.${decoded}`);
      if (!filename.startsWith(`${dist}${path.sep}`) && filename !== dist) return json(res, 403, { error: 'Invalid path.' });
      if (!fs.existsSync(filename) || !fs.statSync(filename).isFile()) {
        if (path.extname(decoded)) return json(res, 404, { error: 'File not found.' });
        filename = path.join(dist, 'index.html');
      }
      if (!fs.existsSync(filename)) return json(res, 503, { error: 'Frontend not built. Run npm run build, or use npm run dev.' });
      res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'");
      res.writeHead(200, { 'content-type': mimeTypes[path.extname(filename)] || 'application/octet-stream', 'cache-control': decoded.startsWith('/assets/') ? 'public,max-age=31536000,immutable' : 'no-cache' });
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(filename).on('error', () => res.destroy()).pipe(res);
    } catch (error) {
      if (res.headersSent) return res.end();
      if (!(error instanceof AppError)) console.error('Request failed:', error.message);
      json(res, error instanceof AppError ? error.status : 500, { error: error instanceof AppError ? error.message : 'Something went wrong. Please try again.', ...(error.code && error instanceof AppError ? { code: error.code } : {}), ...(error instanceof AppError ? error.extra : {}) });
    }
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 10000;
  function close() {
    if (closed) return Promise.resolve();
    closed = true;
    return new Promise(resolve => {
      const finish = () => { db.close(); resolve(); };
      if (server.listening) { server.close(finish); server.closeIdleConnections(); } else finish();
    });
  }
  return { server, db, close };
}
