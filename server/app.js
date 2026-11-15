import http from 'node:http';
import sharp from 'sharp';
import { searchCities } from './locations.js';
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
import { gradeQuiz } from './assessments.js';
import { createVideoRooms } from './video-rooms.js';
import { createChatAttachments } from './chat-attachments.js';
import { createDemoSquads } from './demo-squads.js';
import { createSquadRecovery } from './squad-recovery.js';

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
    CREATE TABLE IF NOT EXISTS user_avatars (user_id TEXT PRIMARY KEY REFERENCES users(id), image BLOB NOT NULL, version TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS squads (id TEXT PRIMARY KEY, name TEXT NOT NULL, track_id TEXT NOT NULL, level TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sprints (id TEXT PRIMARY KEY, squad_id TEXT UNIQUE NOT NULL REFERENCES squads(id), status TEXT NOT NULL, starts_at TEXT NOT NULL, ends_at TEXT NOT NULL, timezone TEXT NOT NULL, plan TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS memberships (squad_id TEXT NOT NULL REFERENCES squads(id), user_id TEXT NOT NULL REFERENCES users(id), active INTEGER NOT NULL DEFAULT 1, joined_at TEXT NOT NULL, left_at TEXT, PRIMARY KEY(squad_id,user_id));
    CREATE TABLE IF NOT EXISTS meetings (id TEXT PRIMARY KEY, sprint_id TEXT NOT NULL REFERENCES sprints(id), starts_at TEXT NOT NULL, ends_at TEXT NOT NULL, window_ends_at TEXT NOT NULL, topic TEXT NOT NULL, week INTEGER NOT NULL, meet_url TEXT NOT NULL DEFAULT '', organizer_id TEXT REFERENCES users(id));
    CREATE TABLE IF NOT EXISTS progress (sprint_id TEXT NOT NULL REFERENCES sprints(id), user_id TEXT NOT NULL REFERENCES users(id), task_id TEXT NOT NULL, status TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', url TEXT NOT NULL DEFAULT '', PRIMARY KEY(sprint_id,user_id,task_id));
    CREATE TABLE IF NOT EXISTS quiz_results (sprint_id TEXT NOT NULL REFERENCES sprints(id), user_id TEXT NOT NULL REFERENCES users(id), task_id TEXT NOT NULL, answers TEXT NOT NULL, score INTEGER NOT NULL, total INTEGER NOT NULL, passed INTEGER NOT NULL, attempts INTEGER NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(sprint_id,user_id,task_id));
    CREATE TABLE IF NOT EXISTS weekly_submissions (sprint_id TEXT NOT NULL REFERENCES sprints(id), user_id TEXT NOT NULL REFERENCES users(id), week INTEGER NOT NULL, status TEXT NOT NULL, text TEXT NOT NULL, url TEXT NOT NULL, checked TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(sprint_id,user_id,week));
    CREATE TABLE IF NOT EXISTS learning_credits (sprint_id TEXT NOT NULL REFERENCES sprints(id), user_id TEXT NOT NULL REFERENCES users(id), item_id TEXT NOT NULL, PRIMARY KEY(sprint_id,user_id,item_id));
    CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS chat_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, squad_id TEXT NOT NULL REFERENCES squads(id), user_id TEXT NOT NULL REFERENCES users(id), client_id TEXT NOT NULL, text TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(squad_id,user_id,client_id));
    CREATE TABLE IF NOT EXISTS chat_reads (squad_id TEXT NOT NULL REFERENCES squads(id), user_id TEXT NOT NULL REFERENCES users(id), last_id INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(squad_id,user_id));
    CREATE INDEX IF NOT EXISTS chat_squad_id ON chat_messages(squad_id,id);
    CREATE TABLE IF NOT EXISTS chat_attachments (id TEXT PRIMARY KEY, squad_id TEXT NOT NULL REFERENCES squads(id), user_id TEXT NOT NULL REFERENCES users(id), message_id INTEGER REFERENCES chat_messages(id), name TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL, data BLOB NOT NULL, created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS chat_attachment_message ON chat_attachments(message_id);
    CREATE TABLE IF NOT EXISTS demo_runs (owner_id TEXT PRIMARY KEY REFERENCES users(id), squad_id TEXT UNIQUE NOT NULL REFERENCES squads(id));
    CREATE TABLE IF NOT EXISTS course_orders (squad_id TEXT NOT NULL REFERENCES squads(id),user_id TEXT NOT NULL REFERENCES users(id),paid_cents INTEGER NOT NULL,currency TEXT NOT NULL,mode TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(squad_id,user_id));
    CREATE TABLE IF NOT EXISTS recovery_cases (id TEXT PRIMARY KEY,squad_id TEXT NOT NULL REFERENCES squads(id),opened_at TEXT NOT NULL,deadline_at TEXT NOT NULL,remaining_meetings INTEGER NOT NULL,total_meetings INTEGER NOT NULL,reason TEXT NOT NULL,state TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE UNIQUE INDEX IF NOT EXISTS one_open_recovery ON recovery_cases(squad_id) WHERE state='open';
    CREATE TABLE IF NOT EXISTS recovery_choices (case_id TEXT NOT NULL REFERENCES recovery_cases(id),user_id TEXT NOT NULL REFERENCES users(id),choice TEXT NOT NULL,target_squad_id TEXT REFERENCES squads(id),created_at TEXT NOT NULL,PRIMARY KEY(case_id,user_id));
    CREATE TABLE IF NOT EXISTS course_refunds (id TEXT PRIMARY KEY,case_id TEXT NOT NULL REFERENCES recovery_cases(id),user_id TEXT NOT NULL REFERENCES users(id),amount_cents INTEGER NOT NULL,paid_cents INTEGER NOT NULL,remaining_meetings INTEGER NOT NULL,total_meetings INTEGER NOT NULL,currency TEXT NOT NULL,mode TEXT NOT NULL,state TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(case_id,user_id));
    CREATE TABLE IF NOT EXISTS course_release_dates (sprint_id TEXT NOT NULL REFERENCES sprints(id),week INTEGER NOT NULL,release_at TEXT NOT NULL,PRIMARY KEY(sprint_id,week));
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
  const videoRoom = createVideoRooms({ authorizeMember, meetingReadiness, members, now, rate });
  const demoSquads = createDemoSquads({ q, run, now, rate, transaction, createSquadRecord, squadRow, summary });
  const recovery = createSquadRecovery({ q, all, run, now, transaction, squadRow, members, current, createSquadRecord, demoSquads });
  const chatAttachments = createChatAttachments({ q, all, run, now, rate, authorizeMember, currentUser: req => { refreshLifecycle(); return requireUser(userFromRequest(req), false); } });
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
    if (!columns.has('learning_mode')) db.exec("ALTER TABLE squads ADD COLUMN learning_mode TEXT NOT NULL DEFAULT 'squad'");
    if (!columns.has('auto_matched')) db.exec('ALTER TABLE squads ADD COLUMN auto_matched INTEGER NOT NULL DEFAULT 0');
    if (!columns.has('is_demo')) db.exec('ALTER TABLE squads ADD COLUMN is_demo INTEGER NOT NULL DEFAULT 0');
    if (!columns.has('min_members')) db.exec('ALTER TABLE squads ADD COLUMN min_members INTEGER NOT NULL DEFAULT 3');
    if (!columns.has('established')) {
      db.exec('ALTER TABLE squads ADD COLUMN established INTEGER NOT NULL DEFAULT 0');
      run("UPDATE squads SET established=1 WHERE id IN (SELECT squad_id FROM sprints WHERE status IN ('ready','active','completed'))");
    }
    let next = q('SELECT COALESCE(MAX(display_number),0) AS n FROM squads').n;
    for (const squad of all('SELECT id,track_id,display_number FROM squads ORDER BY created_at,id')) {
      const number = squad.display_number || ++next;
      const name = `${trackById(squad.track_id)?.title || squad.track_id} #${String(number).padStart(3, '0')}`;
      run('UPDATE squads SET name=?,display_number=? WHERE id=?', name, number, squad.id);
    }
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS squads_display_number ON squads(display_number)');
    // JavaScript has been removed from the product. Retain its stored work for
    // recovery, but release memberships and let the same guests choose a course.
    run("UPDATE sprints SET status='closed' WHERE squad_id IN (SELECT id FROM squads WHERE track_id='javascript') AND status IN ('forming','ready','active')");
    run("UPDATE memberships SET active=0,left_at=COALESCE(left_at,?) WHERE active=1 AND squad_id IN (SELECT id FROM squads WHERE track_id='javascript')", stamp());
    for (const person of all('SELECT id,profile FROM users')) {
      const saved = JSON.parse(person.profile);
      if (saved.trackId !== 'javascript') continue;
      delete saved.trackId;
      saved.level = 'beginner';
      run('UPDATE users SET profile=? WHERE id=?', JSON.stringify(saved), person.id);
      run('DELETE FROM matchmaking_queue WHERE user_id=?', person.id);
    }
    retireArchivedSearches();
    if (!q("SELECT id FROM schema_migrations WHERE id='required-assessments-v1'")) {
      // Credit completed work once. A restart must never turn new unchecked work
      // into a pass or reopen a previously completed week for existing learners.
      for (const saved of all("SELECT sprint_id,user_id,task_id FROM progress WHERE status='done'")) {
        run('INSERT OR IGNORE INTO learning_credits VALUES (?,?,?)', saved.sprint_id, saved.user_id, `lesson:${saved.task_id}`);
      }
      for (const saved of all("SELECT sprint_id,user_id,task_id FROM progress WHERE status='done' AND task_id LIKE 'week-%-task-2'")) {
        const week = Number(saved.task_id.split('-')[1]);
        if (q("SELECT 1 FROM progress WHERE sprint_id=? AND user_id=? AND task_id=? AND status='done'", saved.sprint_id, saved.user_id, `week-${week}-task-1`)) run('INSERT OR IGNORE INTO learning_credits VALUES (?,?,?)', saved.sprint_id, saved.user_id, `assignment:${week}`);
      }
      run('INSERT INTO schema_migrations VALUES (?,?)', 'required-assessments-v1', stamp());
    }
  });
  function rate(key, limit, duration) {
    const time = now().getTime();
    run('DELETE FROM rate_events WHERE created_at < ?', time - 86400000);
    if (q('SELECT COUNT(*) AS count FROM rate_events WHERE key = ? AND created_at > ?', key, time - duration).count >= limit) throw new AppError(429, 'Too many requests. Please try again later.', 'rate_limited');
    run('INSERT INTO rate_events(key,created_at) VALUES (?,?)', key, time);
  }
  function refreshLifecycle() {
    return transaction(() => {
      recovery.sync();
      const time = stamp();
      for (const sprint of all("SELECT * FROM sprints WHERE status IN ('forming','ready','active')")) {
        const count = q('SELECT COUNT(*) AS n FROM memberships WHERE squad_id = ? AND active = 1', sprint.squad_id).n;
        let status = sprint.status;
        const config = q('SELECT learning_mode,min_members FROM squads WHERE id=?', sprint.squad_id);
        if (config.learning_mode === 'solo') {
          if (!count) status = 'closed';
          else if (time >= sprint.ends_at) status = 'completed';
          else status = 'active';
          if (status !== sprint.status) run('UPDATE sprints SET status=? WHERE id=?', status, sprint.id);
          continue;
        }
        if (status !== 'active') status = count >= config.min_members ? 'ready' : 'forming';
        if (status !== 'active' && (count === 0 || time >= sprint.starts_at)) status = count >= config.min_members ? 'active' : 'closed';
        if (status === 'active' && time >= sprint.ends_at) status = 'completed';
        if (status !== sprint.status) run('UPDATE sprints SET status = ? WHERE id = ?', status, sprint.id);
      }
    });
  }
  function avatarUrl(userId) { const saved = q('SELECT version FROM user_avatars WHERE user_id=?', userId); return saved ? `/api/avatars/${userId}?v=${saved.version}` : null; }
  function profile(userId) {
    const row = q('SELECT profile FROM users WHERE id = ?', userId);
    return row ? { ...JSON.parse(row.profile), id: userId, avatarUrl: avatarUrl(userId) } : null;
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
    if (trackId === 'javascript') throw new AppError(410, 'This course has been removed. Choose a current course to continue.', 'course_removed');
    if (!isActiveTrack(trackId)) throw new AppError(409, 'This course is archived. Choose an available course to find a new squad.', 'track_archived');
  }
  function current(userId, trackId = profile(userId)?.trackId) {
    return q("SELECT s.squad_id AS id FROM sprints s JOIN squads q ON q.id=s.squad_id JOIN memberships m ON m.squad_id = s.squad_id WHERE q.is_demo=0 AND q.track_id=? AND m.user_id = ? AND m.active = 1 AND s.status IN ('forming','ready','active') LIMIT 1", trackId || '', userId)?.id || null;
  }
  function occupiedMeetings(userId) {
    return all("SELECT m.starts_at AS startsAt,m.window_ends_at AS windowEndsAt FROM meetings m JOIN sprints s ON s.id=m.sprint_id JOIN squads q ON q.id=s.squad_id JOIN memberships member ON member.squad_id=q.id WHERE member.user_id=? AND member.active=1 AND q.is_demo=0 AND s.status IN ('forming','ready','active') ORDER BY m.starts_at", userId);
  }
  function occupiedConflicts(userId, meetings) {
    const busy = occupiedMeetings(userId);
    return meetings.filter(meeting => busy.some(other => Date.parse(meeting.startsAt) < Date.parse(other.windowEndsAt) && Date.parse(meeting.windowEndsAt) > Date.parse(other.startsAt)));
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
    return all(`SELECT m.*,u.profile FROM memberships m JOIN users u ON m.user_id=u.id WHERE m.squad_id = ? ${includeFormer ? '' : 'AND m.active = 1'} ORDER BY m.joined_at,m.user_id`, squadId).map(m => ({ id: m.user_id, name: JSON.parse(m.profile).name || 'Guest', isDemo: !!JSON.parse(m.profile).isDemo, avatarUrl: avatarUrl(m.user_id), ...(includeFormer ? { active: !!m.active, isSelf: m.user_id === selfId } : {}) }));
  }
  function summary(row) {
    const roster = members(row.id);
    const name = `${trackById(row.track_id).title} #${String(row.display_number).padStart(3, '0')}`;
    return { id: row.id, isDemo: !!row.is_demo, minimumMembers: row.min_members, learningMode: row.learning_mode || 'squad', name, number: row.display_number, trackId: row.track_id, level: row.level, status: row.status, memberCount: roster.length, capacity: 4, members: roster, meetings: meetingRows(row.sprint_id), startDate: row.starts_at, endDate: row.ends_at };
  }
  function bootstrap(user) {
    const currentSquadId = user ? current(user.id) : null;
    const activeCourses = user ? all("SELECT q.id FROM squads q JOIN sprints s ON s.squad_id=q.id JOIN memberships m ON m.squad_id=q.id WHERE m.user_id=? AND m.active=1 AND q.is_demo=0 AND s.status IN ('forming','ready','active') ORDER BY m.joined_at DESC,q.display_number DESC", user.id).map(row => summary(squadRow(row.id))) : [];
    const history = user ? all("SELECT m.squad_id FROM memberships m JOIN squads q ON q.id=m.squad_id WHERE m.user_id=? AND q.is_demo=0 AND q.track_id<>'javascript' ORDER BY m.joined_at DESC", user.id).filter(m => !activeCourses.some(course => course.id === m.squad_id)).map(m => summary(squadRow(m.squad_id))) : [];
    return { user, tracks: tracks.map(coursePreview), archivedTracks: archivedTracks.filter(track => track.id !== 'javascript').map(coursePreview), currentSquadId, activeCourses, demoHistory: user ? all("SELECT m.squad_id FROM memberships m JOIN squads q ON q.id=m.squad_id WHERE m.user_id=? AND q.is_demo=1 ORDER BY m.joined_at DESC,q.display_number DESC", user.id).filter(m => m.squad_id !== demoSquads.current(user.id)).map(m => summary(squadRow(m.squad_id))) : [], demoSquadId: user ? demoSquads.current(user.id) : null, pendingRecovery: user ? recovery.pending(user.id) : null, history, aiAvailable: !!adapter, matchmaking: user ? searchState(user.id) : { status: 'idle' } };
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
  function createSquadRecord(anchor, schedule, participantIds, automatic = false, { demo = false } = {}) {
    requireActiveTrack(anchor.trackId);
    if (participantIds.length < 1 || participantIds.length > 4 || new Set(participantIds).size !== participantIds.length) throw new Error('Invalid team membership');
    for (const userId of participantIds) if (!demo && current(userId, anchor.trackId)) throw new AppError(409, 'A learner already has an active enrollment in this course.', 'active_squad');
    if (!demo && participantIds.some(userId => occupiedConflicts(userId, schedule.meetings).length)) throw new AppError(409, 'These meeting times overlap another course you have joined. Choose different times.', 'course_time_conflict');
    const squadId = id(), sprintId = id(), plan = basePlan(anchor.trackId, anchor.level);
    const number = q('SELECT COALESCE(MAX(display_number),0)+1 AS n FROM squads').n;
    const name = `${trackById(anchor.trackId).title} #${String(number).padStart(3, '0')}`;
    run('INSERT INTO squads(id,name,track_id,level,created_at,display_number,auto_matched,is_demo) VALUES (?,?,?,?,?,?,?,?)', squadId, name, anchor.trackId, anchor.level, stamp(), number, automatic ? 1 : 0, Number(demo));
    run('INSERT INTO sprints(id,squad_id,status,starts_at,ends_at,timezone,plan) VALUES (?,?,?,?,?,?,?)', sprintId, squadId, participantIds.length >= 3 ? 'ready' : 'forming', schedule.startDate, schedule.endDate, anchor.timezone, JSON.stringify(plan));
    for (const userId of participantIds) {
      run('INSERT INTO memberships(squad_id,user_id,active,joined_at) VALUES (?,?,1,?)', squadId, userId, stamp());
      recovery.order(squadId, userId);
      if (!demo) recovery.attach(squadId, userId);
      if (!demo) run('DELETE FROM matchmaking_queue WHERE user_id=?', userId);
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
      run("DELETE FROM matchmaking_queue WHERE user_id IN (SELECT m.user_id FROM memberships m JOIN sprints s ON s.squad_id=m.squad_id JOIN squads q ON q.id=s.squad_id JOIN users u ON u.id=m.user_id WHERE q.is_demo=0 AND q.track_id=json_extract(u.profile,'$.trackId') AND m.active=1 AND s.status IN ('forming','ready','active'))");
      let queued = all("SELECT u.id,u.profile,m.queued_at FROM matchmaking_queue m JOIN users u ON u.id=m.user_id WHERE m.state='waiting' ORDER BY m.queued_at,m.rowid").map(row => ({ ...JSON.parse(row.profile), id: row.id, queuedAt: row.queued_at, busyMeetings: occupiedMeetings(row.id) }));
      const open = all("SELECT q.*,s.id AS sprint_id,s.status,s.starts_at,s.ends_at,s.timezone,s.plan FROM squads q JOIN sprints s ON s.squad_id=q.id WHERE q.auto_matched=1 AND s.status='ready' AND s.starts_at > ? ORDER BY s.starts_at,q.display_number", stamp()).filter(row => isActiveTrack(row.track_id) && members(row.id).length === 3);
      const fingerprint = JSON.stringify([queued.map(person => [person.id, person.trackId, person.level, person.timezone, person.availability, person.busyMeetings, person.queuedAt, cohortStart(person.timezone, now())]), open.map(row => [row.id, members(row.id).map(member => member.id)])]);
      if (fingerprint === lastMatchFingerprint) return;
      lastMatchFingerprint = fingerprint;
      // A fourth searching learner may join an automatically created future team.
      for (const row of open) {
        const candidate = queued.find(person => {
          try { canJoin(person, row); return hasSeparateMeetingDays(person, meetingRows(row.sprint_id)); } catch (error) { if (error instanceof AppError) return false; throw error; }
        });
        if (!candidate) continue;
        run('INSERT INTO memberships(squad_id,user_id,active,joined_at,left_at) VALUES (?,?,1,?,NULL) ON CONFLICT(squad_id,user_id) DO UPDATE SET active=1,joined_at=excluded.joined_at,left_at=NULL', row.id, candidate.id, stamp());
        recovery.order(row.id, candidate.id); recovery.attach(row.id, candidate.id);
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
    if (row.track_id === 'javascript') throw new AppError(410, 'This course has been removed. Choose a current course to continue.', 'course_removed');
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
    const learning = learningState(row, user.id, canEdit, plan);
    const connection = { configured: meetConfigured, connected: !!meetAdapter || googleMeet.connected(user.id), organizerAvailable: !!meetingOrganizer(squadId), ...(!meetConfigured ? { message: 'Automatic Google Meet is not configured on this installation yet.' } : {}) };
    const meetings = meetingRows(row.sprint_id, true).map(meeting => {
      const readiness = meetingReadiness(row, meeting.id, user.id, !!membership.active);
      const past = meeting.endsAt <= stamp();
      return { ...meeting, meetUrl: past || (membership.active && readiness.allReady && readiness.status === 'ready') ? meeting.meetUrl : '', readiness };
    });
    return { recovery: recovery.view(squadId, user.id), chatUnread: membership.active ? q('SELECT COUNT(*) AS n FROM chat_messages WHERE squad_id=? AND user_id<>? AND id>COALESCE((SELECT last_id FROM chat_reads WHERE squad_id=? AND user_id=?),0)', squadId,user.id,squadId,user.id).n : 0, squad: summary(row), members: roster, meetings, googleMeet: connection, plan: learning.plan, learningProgress: learning.learningProgress, progress, teamProgress: roster.map(m => { const p = results(row.sprint_id, m.id, plan); return { userId: m.id, name: m.name, done: p.filter(x => x.status === 'done').length, total: p.length, results: p.map(result => learning.accessByTask.get(result.taskId)?.unlocked ? result : { ...result, note: '', url: '', locked: true }), assignments: assignmentResults(row.sprint_id, m.id).filter(result => result.status === 'submitted').map(result => learning.accessByAssignment.get(result.week)?.unlocked ? result : { week: result.week, status: result.status, locked: true }) }; }), isMember: !!membership.active, canEdit };
  }
  function assignmentResults(sprintId, userId) {
    return all('SELECT * FROM weekly_submissions WHERE sprint_id=? AND user_id=? ORDER BY week', sprintId, userId).map(saved => ({ week: saved.week, status: saved.status, text: saved.text, url: saved.url, checkedCriteria: JSON.parse(saved.checked), updatedAt: saved.updated_at }));
  }
  function learningState(row, userId, canEdit, plan = withLessonMaterials(JSON.parse(row.plan), row.track_id)) {
    const quizResults = all('SELECT * FROM quiz_results WHERE sprint_id=? AND user_id=?', row.sprint_id, userId).map(saved => {
      const answers = JSON.parse(saved.answers), quiz = plan.weeks.flatMap(week => week.tasks).find(task => task.id === saved.task_id)?.quiz;
      return { taskId: saved.task_id, answers, score: saved.score, total: saved.total, passed: !!saved.passed, attempts: saved.attempts, updatedAt: saved.updated_at, feedback: quiz ? gradeQuiz(quiz, answers)?.feedback || [] : [] };
    });
    return planAccess({ plan, progress: results(row.sprint_id, userId, plan), squad: { createdAt: row.created_at, startsAt: row.starts_at, endsAt: row.ends_at, timezone: row.timezone, status: row.status, learningMode: row.learning_mode, releaseDates: Object.fromEntries(all('SELECT week,release_at FROM course_release_dates WHERE sprint_id=?', row.sprint_id).map(item => [item.week,item.release_at])) }, meetings: meetingRows(row.sprint_id), quizResults, assignments: assignmentResults(row.sprint_id, userId), credits: all('SELECT item_id FROM learning_credits WHERE sprint_id=? AND user_id=?', row.sprint_id, userId).map(item => item.item_id), now: now(), canEdit });
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
    if (row.is_demo) throw new AppError(403, 'Demo squads are private examples and cannot recruit real learners.', 'demo_squad');
    requireActiveTrack(row.track_id);
    if (row.learning_mode === 'solo' || user.learningMode === 'solo') throw new AppError(409, 'Choose squad learning before joining a team.', 'solo_course');
    if (!['forming', 'ready'].includes(row.status) || row.starts_at <= stamp()) throw new AppError(409, 'Recruitment has closed for this squad.', 'recruitment_closed');
    if (members(row.id).length >= 4) throw new AppError(409, 'This squad just filled up. Search for another squad.', 'squad_full');
    if (user.trackId !== row.track_id || user.level !== row.level || scheduleConflicts({ ...user, busyMeetings: occupiedMeetings(user.id) }, meetingRows(row.sprint_id)).length) throw new AppError(409, 'This squad does not fit your track, level, or all eight meeting windows.', 'incompatible_schedule');
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
    const attachmentUpload = pathname.match(/^\/api\/squads\/([^/]+)\/chat\/attachments$/);
    if (attachmentUpload && method === 'POST') return json(res, 201, { attachment: await chatAttachments.upload(req, attachmentUpload[1]) });
    if (pathname === '/api/profile/avatar' && method === 'PUT') {
      const owner = requireUser(userFromRequest(req), false);
      rate(`avatar:${owner.id}`, 12, 3600000);
      if (!['image/jpeg','image/png','image/webp'].includes(req.headers['content-type'])) throw new AppError(415, 'Choose a JPEG, PNG or WebP photo.', 'invalid_image');
      const chunks = []; let length = 0;
      for await (const chunk of req) { length += chunk.length; if (length > 2 * 1024 * 1024) throw new AppError(413, 'Choose a smaller photo.', 'too_large'); chunks.push(chunk); }
      let image;
      try {
        const input = sharp(Buffer.concat(chunks), { limitInputPixels: 16000000 });
        const meta = await input.metadata();
        if (!['jpeg','png','webp'].includes(meta.format) || (meta.pages || 1) > 1) throw new Error('Unsupported image');
        image = await input.rotate().resize(256,256,{fit:'cover'}).webp({quality:80}).toBuffer();
      } catch { fail('This photo could not be read. Choose a JPEG, PNG or WebP image.', 'invalid_image'); }
      // Recheck the session after an asynchronous decode; never retain original bytes or metadata.
      if (userFromRequest(req)?.id !== owner.id) throw new AppError(401, 'Your session has expired.', 'session_required');
      run('INSERT INTO user_avatars VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET image=excluded.image,version=excluded.version', owner.id, image, hash(image).slice(0,16));
      return json(res,200,{avatarUrl:avatarUrl(owner.id)});
    }
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
    if (method === 'POST' && ['/api/solo', '/api/matchmaking', '/api/matchmaking/poll'].includes(pathname) && data.trackId !== undefined && data.trackId !== user.trackId) throw new AppError(409, 'Your selected course changed in another page. Refresh before continuing.', 'course_selection_changed');
    if (pathname === '/api/demo/start' && method === 'POST') return json(res, 200, demoSquads.start(user, data.trackId || 'python', data.restart === true));
    const recoveryRoute = pathname.match(/^\/api\/squads\/([^/]+)\/recovery$/);
    if (recoveryRoute && method === 'POST') {
      authorizeMember(recoveryRoute[1], user);
      const result = recovery.choose(recoveryRoute[1], user, data);
      lastMatchFingerprint = null; refreshLifecycle();
      if (result.searching) attemptMatchmaking();
      return json(res, 200, { ...result, squadId: result.squadId || (result.searching ? current(user.id, squadRow(recoveryRoute[1]).track_id) : null) });
    }
    const demoScenario = pathname.match(/^\/api\/squads\/([^/]+)\/demo-scenario$/);
    if (demoScenario && method === 'POST') {
      transaction(() => { authorizeMember(demoScenario[1], user, true); demoSquads.shrink(demoScenario[1], user, data.remaining); refreshLifecycle(); });
      return json(res, 200, dashboard(demoScenario[1], user));
    }
    if (attachmentUpload && method === 'GET') return json(res, 200, { attachments: chatAttachments.drafts(attachmentUpload[1], user) });
    const attachmentRoute = pathname.match(/^\/api\/squads\/([^/]+)\/chat\/attachments\/([a-f0-9-]{36})$/);
    if (attachmentRoute && ['GET', 'DELETE'].includes(method)) {
      if (!chatAttachments.serve(req, res, attachmentRoute[1], attachmentRoute[2], user)) return json(res, 200, { ok: true });
      return;
    }
    if (method === 'GET' && pathname === '/api/cities') {
      rate(`cities:${user.id}`, 90, 60000);
      return json(res,200,{cities:searchCities(new URL(req.url,'http://localhost').searchParams.get('q') || '')});
    }
    if (method === 'DELETE' && pathname === '/api/profile/avatar') { run('DELETE FROM user_avatars WHERE user_id=?',user.id); return json(res,200,{avatarUrl:null}); }
    const avatar = pathname.match(/^\/api\/avatars\/([a-f0-9-]+)$/);
    if (method === 'GET' && avatar) {
      const owner = avatar[1];
      if (owner !== user.id && !q('SELECT 1 FROM memberships a JOIN memberships b ON a.squad_id=b.squad_id WHERE a.user_id=? AND b.user_id=? AND a.active=1 AND b.active=1',owner,user.id)) throw new AppError(403,'This photo is private.','forbidden');
      const saved = q('SELECT image FROM user_avatars WHERE user_id=?',owner);
      if (!saved) throw new AppError(404,'Photo not found.','not_found');
      res.writeHead(200,{'content-type':'image/webp','cache-control':'private, no-store','x-content-type-options':'nosniff'}); return res.end(Buffer.from(saved.image));
    }
    if (method === 'POST' && pathname === '/api/solo') {
      requireUser(user); requireActiveTrack(user.trackId);
      const squadId = transaction(() => {
        if (current(user.id)) throw new AppError(409,'You already have an active enrollment in this course.','active_squad');
        if (user.learningMode !== 'solo') fail('Choose independent learning in your profile.');
        rate(`solo:${user.id}`,5,3600000);
        const start = stamp();
        const schedule = { startDate:start, endDate:new Date(now().getTime()+28*86400000).toISOString(), meetings:[] };
        const created = createSquadRecord(user,schedule,[user.id]);
        run("UPDATE squads SET learning_mode='solo' WHERE id=?",created);
        run("UPDATE sprints SET status='active' WHERE squad_id=?",created);
        return created;
      });
      return json(res,201,{squadId});
    }
    if (method === 'POST' && pathname === '/api/google-meet/connect') {
      if (typeof data.squadId !== 'string') fail('Choose your squad before connecting Google Meet.');
      if (authorizeMember(data.squadId, user, true).row.is_demo) throw new AppError(409, 'Use the simulated call in this demo squad.', 'demo_squad');
      if (!googleMeet.configured) throw new AppError(503, 'Automatic Google Meet needs to be configured by the site owner first.', 'meet_setup_required');
      rate(`google-connect:${user.id}`, 8, 3600000);
      try { return json(res, 200, await googleMeet.begin(user.id, data.squadId)); }
      catch { throw new AppError(503, 'Google Meet could not be connected. Please try again.', 'google_connect_failed'); }
    }
    if (method === 'DELETE' && pathname === '/api/google-meet/connection') {
      await googleMeet.disconnect(user.id);
      return json(res, 200, { ok: true });
    }
    const videoRoute = pathname.match(/^\/api\/squads\/([^/]+)\/meetings\/([^/]+)\/video\/(join|poll|ready|signal|leave)$/);
    if (videoRoute && method === 'POST') {
      const [, squadId, meetingId, action] = videoRoute;
      return json(res, 200, await videoRoom({ squadId, meetingId, action, data, user }));
    }
    const chatRoute = pathname.match(/^\/api\/squads\/([^/]+)\/chat(?:\/(read))?$/);
    if (chatRoute) {
      const [, squadId, action] = chatRoute;
      const { row, membership } = authorizeMember(squadId, user, method === 'POST');
      if (!membership.active) throw new AppError(403, 'Chat is only available to current squad members.', 'forbidden');
      const message = saved => ({ id: saved.id, userId: saved.user_id, name: profile(saved.user_id).name, avatarUrl: avatarUrl(saved.user_id), text: saved.text, attachments: chatAttachments.list(saved.id), createdAt: saved.created_at, clientId: saved.user_id === user.id ? saved.client_id : undefined });
      if (method === 'GET' && !action) {
        const params = new URL(req.url, 'http://localhost').searchParams;
        const before = params.get('before'), after = params.get('after');
        if (before && after || [before, after].some(value => value !== null && (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))))) fail('Use one valid message cursor.');
        const saved = after !== null ? all('SELECT * FROM chat_messages WHERE squad_id=? AND id>? ORDER BY id LIMIT 51', squadId, Number(after)) : all('SELECT * FROM chat_messages WHERE squad_id=? AND id<? ORDER BY id DESC LIMIT 51', squadId, before === null ? Number.MAX_SAFE_INTEGER : Number(before));
        const page = saved.slice(0, 50);
        if (after === null) page.reverse();
        return json(res, 200, { messages: page.map(message), hasMore: saved.length > 50, canSend: unfinished.includes(row.status) });
      }
      if (method === 'POST' && !action) {
        const attachmentIds = chatAttachments.ids(data.attachments);
        const text = textField(data.text ?? '', 2000, 'Message', !attachmentIds.length);
        const clientId = textField(data.clientId, 80, 'Message identifier', true);
        if (!/^[a-zA-Z0-9_-]{8,80}$/.test(clientId)) fail('Invalid message identifier.');
        const existing = q('SELECT * FROM chat_messages WHERE squad_id=? AND user_id=? AND client_id=?', squadId, user.id, clientId);
        if (existing) {
          if (existing.text !== text || JSON.stringify(chatAttachments.list(existing.id).map(item => item.id).sort()) !== JSON.stringify([...attachmentIds].sort())) throw new AppError(409, 'This message identifier was already used. Start a new message.', 'duplicate_message');
          return json(res, 200, { message: message(existing) });
        }
        rate(`chat:${user.id}`, 20, 60000);
        const messageId = transaction(() => {
          const result = run('INSERT INTO chat_messages(squad_id,user_id,client_id,text,created_at) VALUES (?,?,?,?,?)', squadId, user.id, clientId, text, stamp());
          const created = Number(result.lastInsertRowid);
          chatAttachments.claim(attachmentIds, created, squadId, user.id);
          return created;
        });
        demoSquads.reply(squadId, messageId);
        return json(res, 201, { message: message(q('SELECT * FROM chat_messages WHERE id=?', messageId)) });
      }
      if (method === 'PUT' && action === 'read') {
        if (!Number.isSafeInteger(data.lastId) || data.lastId < 0 || data.lastId > 0 && !q('SELECT id FROM chat_messages WHERE squad_id=? AND id=?', squadId, data.lastId)) fail('Invalid last read message.');
        run('INSERT INTO chat_reads VALUES (?,?,?) ON CONFLICT(squad_id,user_id) DO UPDATE SET last_id=MAX(last_id,excluded.last_id)', squadId, user.id, data.lastId);
        return json(res, 200, { ok: true });
      }
      throw new AppError(405, 'Method not allowed.', 'method_not_allowed');
    }
    const readinessRoute = pathname.match(/^\/api\/squads\/([^/]+)\/meetings\/([^/]+)\/(readiness|launch)$/);
    if (readinessRoute) {
      const [, squadId, meetingId, action] = readinessRoute;
      if (squadRow(squadId).is_demo) throw new AppError(409, 'Use the simulated call in this demo squad.', 'demo_squad');
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
          if (user.learningMode === 'solo') fail('Use independent checkout to start your course.', 'solo_course');
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
        const activeId = current(user.id, data.trackId);
        const next = validateProfile(data, { allowedArchivedTrackId: activeId ? squadRow(activeId).track_id : undefined });
        if (activeId) {
          const active = squadRow(activeId);
          if ((next.learningMode || 'squad') !== active.learning_mode) throw new AppError(409, 'This enrolled course keeps its current format. Choose another course to add more learning.', 'active_squad');
          if (active.track_id !== next.trackId || active.level !== next.level) throw new AppError(409, 'This enrolled course keeps its starting level. You can enroll in a different course separately.', 'active_squad');
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
      if (user.learningMode === 'solo') fail('Independent courses do not have squad meetings.');
      const preview = generateSchedule({ ...user, busyMeetings: occupiedMeetings(user.id) }, data.slots, now());
      const tasks = trackById(user.trackId).weeks.flatMap(w => w.tasks);
      preview.meetings.forEach((meeting, i) => meeting.topic = tasks[i].title);
      return json(res, 200, preview);
    }
    if (method === 'POST' && pathname === '/api/squads') {
      requireUser(user);
      const created = transaction(() => {
        if (current(user.id)) throw new AppError(409, 'You already have an active enrollment in this course.', 'active_squad');
        rate(`create:${user.id}`, 5, 3600000);
        if (user.learningMode === 'solo') fail('Start your independent course from checkout.');
        const schedule = generateSchedule(user, data.slots, now());
        const squadId = createSquadRecord(user, schedule, [user.id]);
        return { squadId };
      });
      return json(res, 201, created);
    }
    const match = pathname.match(/^\/api\/squads\/([^/]+)(?:\/(join|leave|adapt|meetings|progress|quizzes|assignments)(?:\/([^/]+))?)?$/);
    if (!match) throw new AppError(404, 'Endpoint not found.', 'not_found');
    const [, squadId, action, resourceId] = match;
    if (method === 'GET' && !action) return json(res, 200, dashboard(squadId, user));
    if (method === 'POST' && action === 'join') {
      requireUser(user);
      transaction(() => {
        const row = squadRow(squadId);
        const existing = q('SELECT * FROM memberships WHERE squad_id = ? AND user_id = ?', squadId, user.id);
        if (existing?.active) { run('DELETE FROM matchmaking_queue WHERE user_id=?', user.id); return; }
        if (current(user.id, row.track_id)) throw new AppError(409, 'You already have an active enrollment in this course.', 'active_squad');
        canJoin(user, row);
        run('INSERT INTO memberships(squad_id,user_id,active,joined_at,left_at) VALUES (?,?,1,?,NULL) ON CONFLICT(squad_id,user_id) DO UPDATE SET active=1,joined_at=excluded.joined_at,left_at=NULL', squadId, user.id, stamp());
        recovery.order(squadId, user.id); recovery.attach(squadId, user.id);
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
      if (row.is_demo) throw new AppError(409, 'Google Meet is not used in demo squads.', 'demo_squad');
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
        const learning = learningState(row, user.id, true);
        const access = learning.accessByTask.get(resourceId);
        if (!access) throw new AppError(404, 'Task not found.', 'not_found');
        if (!access.canEdit) throw new AppError(409, access.message || 'This lesson is not available yet.', 'lesson_locked', { access });
        const task = learning.plan.weeks.flatMap(week => week.tasks).find(task => task.id === resourceId);
        if (data.status === 'done' && task.quiz && !task.quiz.credited && !task.quiz.result?.passed) throw new AppError(409, 'Pass this lesson’s quiz before marking it complete.', 'quiz_required');
        run('INSERT INTO progress(sprint_id,user_id,task_id,status,note,url) VALUES (?,?,?,?,?,?) ON CONFLICT(sprint_id,user_id,task_id) DO UPDATE SET status=excluded.status,note=excluded.note,url=excluded.url', row.sprint_id, user.id, resourceId, data.status, note, url);
      });
      return json(res, 200, { ok: true });
    }
    if (method === 'POST' && action === 'quizzes' && resourceId) {
      const result = transaction(() => {
        const { row } = authorizeMember(squadId, user, true);
        const plan = withLessonMaterials(JSON.parse(row.plan), row.track_id);
        const task = plan.weeks.flatMap(week => week.tasks).find(task => task.id === resourceId);
        if (!task?.quiz) throw new AppError(404, 'Quiz not found.', 'not_found');
        const access = learningState(row, user.id, true, plan).accessByTask.get(resourceId);
        if (!access?.canEdit) throw new AppError(409, access?.message || 'This lesson is not available yet.', 'lesson_locked');
        const graded = gradeQuiz(task.quiz, data.answers);
        if (!graded) fail('Choose one valid answer for every quiz question.');
        const previous = q('SELECT passed FROM quiz_results WHERE sprint_id=? AND user_id=? AND task_id=?', row.sprint_id, user.id, resourceId);
        if (!previous?.passed) {
          rate(`quiz:${user.id}`, 40, 300000);
          run('INSERT INTO quiz_results VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(sprint_id,user_id,task_id) DO UPDATE SET answers=excluded.answers,score=excluded.score,total=excluded.total,passed=excluded.passed,attempts=quiz_results.attempts+1,updated_at=excluded.updated_at', row.sprint_id, user.id, resourceId, JSON.stringify(data.answers), graded.score, graded.total, Number(graded.passed), 1, stamp());
        }
        if (previous?.passed || graded.passed) run("INSERT INTO progress(sprint_id,user_id,task_id,status) VALUES (?,?,?,'done') ON CONFLICT(sprint_id,user_id,task_id) DO UPDATE SET status='done'", row.sprint_id, user.id, resourceId);
        return learningState(row, user.id, true, plan).plan.weeks.flatMap(week => week.tasks).find(task => task.id === resourceId).quiz.result;
      });
      return json(res, 200, result);
    }
    if (method === 'PUT' && action === 'assignments' && resourceId) {
      if (!/^[1-4]$/.test(resourceId)) fail('Choose a valid week.');
      const week = Number(resourceId);
      if (!['draft', 'submitted'].includes(data.status)) fail('Choose draft or submitted.');
      const text = textField(data.text ?? '', 12000, 'Your assignment');
      const url = resultUrl(data.url);
      transaction(() => {
        const { row } = authorizeMember(squadId, user, true);
        const learning = learningState(row, user.id, true);
        const assignment = learning.plan.weeks.find(item => item.week === week)?.assignment;
        if (!assignment) throw new AppError(404, 'Assignment not found.', 'not_found');
        if (!assignment.access.canEdit) throw new AppError(409, assignment.access.message, 'assignment_locked');
        const checked = data.checkedCriteria;
        if (!Array.isArray(checked) || new Set(checked).size !== checked.length || checked.some(id => !assignment.checklist.some(item => item.id === id))) fail('Use the assignment’s checklist items.');
        if (data.status === 'submitted' && (text.length < 40 || checked.length !== assignment.checklist.length)) fail('Add at least 40 characters describing your work and confirm every checklist item before submitting.');
        if (assignment.result?.status === 'submitted' && data.status !== 'submitted') throw new AppError(409, 'This work is already submitted. You can update the submitted version.', 'assignment_submitted');
        run('INSERT INTO weekly_submissions VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(sprint_id,user_id,week) DO UPDATE SET status=excluded.status,text=excluded.text,url=excluded.url,checked=excluded.checked,updated_at=excluded.updated_at', row.sprint_id, user.id, week, data.status, text, url, JSON.stringify(checked), stamp());
      });
      return json(res, 200, { ok: true, status: data.status });
    }
    if (method === 'POST' && action === 'adapt') {
      const { row } = authorizeMember(squadId, user, true);
      const existing = withLessonMaterials(JSON.parse(row.plan), row.track_id);
      if (existing.source === 'ai') return json(res, 200, { source: 'ai', message: 'This saved plan is already AI-adapted.' });
      const started = () => q("SELECT COUNT(*) AS n FROM progress WHERE sprint_id=? AND (status != 'not_started' OR note != '' OR url != '')", row.sprint_id).n > 0 || q('SELECT COUNT(*) AS n FROM quiz_results WHERE sprint_id=?', row.sprint_id).n > 0 || q('SELECT COUNT(*) AS n FROM weekly_submissions WHERE sprint_id=?', row.sprint_id).n > 0;
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
    res.setHeader('Permissions-Policy', 'camera=(self), microphone=(self), geolocation=()');
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
  const lifecycleTimer = setInterval(() => { try { refreshLifecycle(); } catch (error) { console.error('Lifecycle refresh failed:', error.message); } }, 60000);
  lifecycleTimer.unref();
  function close() {
    clearInterval(lifecycleTimer);
    if (closed) return Promise.resolve();
    closed = true;
    return new Promise(resolve => {
      const finish = () => { db.close(); resolve(); };
      if (server.listening) { server.close(finish); server.closeIdleConnections(); } else finish();
    });
  }
  return { server, db, close };
}
