import { randomUUID } from 'node:crypto';
import { DateTime } from 'luxon';
import { AppError, fail } from './scheduling.js';
import { withLessonMaterials } from './curricula.js';

export function createSquadRecovery({ q, all, run, now, transaction, squadRow, members, current, createSquadRecord, demoSquads }) {
  const stamp = () => now().toISOString();
  const openCase = squadId => q("SELECT * FROM recovery_cases WHERE squad_id=? AND state='open' ORDER BY opened_at DESC LIMIT 1", squadId);
  function order(squadId, userId) {
    run("INSERT OR IGNORE INTO course_orders(squad_id,user_id,paid_cents,currency,mode,created_at) VALUES (?,?,0,'USD','demo',?)", squadId, userId, stamp());
    return q('SELECT * FROM course_orders WHERE squad_id=? AND user_id=?', squadId, userId);
  }
  function makeCase(row, reason) {
    const existing = openCase(row.id); if (existing) return existing;
    const total = q('SELECT COUNT(*) AS n FROM meetings WHERE sprint_id=?', row.sprint_id).n;
    const remaining = q('SELECT COUNT(*) AS n FROM meetings WHERE sprint_id=? AND starts_at>=?', row.sprint_id, stamp()).n;
    const deadline = Math.min(now().getTime() + 48 * 3600000, Date.parse(row.ends_at), Date.parse(row.starts_at) > now().getTime() ? Date.parse(row.starts_at) : Infinity);
    const id = randomUUID();
    run("INSERT INTO recovery_cases VALUES (?,?,?,?,?,?,?,'open',?)", id, row.id, stamp(), new Date(deadline).toISOString(), reason === 'team_not_formed' || row.starts_at > stamp() ? total || 8 : remaining, total || 8, reason, stamp());
    return q('SELECT * FROM recovery_cases WHERE id=?', id);
  }
  function recordRefund(incident, userId) {
    const existing = q('SELECT * FROM course_refunds WHERE case_id=? AND user_id=?', incident.id, userId); if (existing) return existing;
    const paid = order(incident.squad_id, userId);
    // No payment provider is connected. This endpoint must never claim money moved.
    if (paid.mode !== 'demo' || paid.paid_cents !== 0) throw new AppError(409, 'A real payment requires a configured refund provider.', 'refund_provider_required');
    run("INSERT INTO course_refunds VALUES (?,?,?,?,?,?,?,?,?,'demo_recorded',?)", randomUUID(), incident.id, userId, 0, paid.paid_cents, incident.remaining_meetings, incident.total_meetings, paid.currency, 'demo', stamp());
    return q('SELECT * FROM course_refunds WHERE case_id=? AND user_id=?', incident.id, userId);
  }
  function detach(row, userId) {
    run('UPDATE memberships SET active=0,left_at=? WHERE squad_id=? AND user_id=? AND active=1', stamp(), row.id, userId);
    run('DELETE FROM meeting_readiness WHERE user_id=? AND meeting_id IN (SELECT id FROM meetings WHERE sprint_id=?)', userId, row.sprint_id);
  }
  function decision(incident, userId, choice, target = null) {
    run('INSERT INTO recovery_choices VALUES (?,?,?,?,?) ON CONFLICT(case_id,user_id) DO UPDATE SET choice=excluded.choice,target_squad_id=excluded.target_squad_id,created_at=excluded.created_at', incident.id, userId, choice, target, stamp());
  }
  function refundAll(incident) {
    for (const member of members(incident.squad_id)) if (!member.isDemo) { recordRefund(incident, member.id); decision(incident, member.id, 'refund'); }
    run("UPDATE recovery_cases SET state='closed',updated_at=? WHERE id=?", stamp(), incident.id);
    run("UPDATE sprints SET status='closed' WHERE squad_id=?", incident.squad_id);
  }
  function copyWork(source, target, userId) {
    const from = withLessonMaterials(JSON.parse(source.plan), source.track_id), to = withLessonMaterials(JSON.parse(target.plan), target.track_id);
    const equivalent = new Set();
    for (const week of from.weeks) for (const task of week.tasks) {
      const match = to.weeks.flatMap(item => item.tasks).find(item => item.id === task.id);
      if (match && JSON.stringify(match) === JSON.stringify(task)) equivalent.add(task.id);
    }
    for (const taskId of equivalent) {
      run('INSERT OR IGNORE INTO progress SELECT ?,user_id,task_id,status,note,url FROM progress WHERE sprint_id=? AND user_id=? AND task_id=?', target.sprint_id, source.sprint_id, userId, taskId);
      run('INSERT OR IGNORE INTO quiz_results SELECT ?,user_id,task_id,answers,score,total,passed,attempts,updated_at FROM quiz_results WHERE sprint_id=? AND user_id=? AND task_id=?', target.sprint_id, source.sprint_id, userId, taskId);
      run('INSERT OR IGNORE INTO learning_credits SELECT ?,user_id,item_id FROM learning_credits WHERE sprint_id=? AND user_id=? AND item_id=?', target.sprint_id, source.sprint_id, userId, `lesson:${taskId}`);
    }
    for (const week of from.weeks) if (week.tasks.every(task => equivalent.has(task.id)) && JSON.stringify(week.assignment) === JSON.stringify(to.weeks.find(item => item.week === week.week)?.assignment)) {
      run('INSERT OR IGNORE INTO weekly_submissions SELECT ?,user_id,week,status,text,url,checked,updated_at FROM weekly_submissions WHERE sprint_id=? AND user_id=? AND week=?', target.sprint_id, source.sprint_id, userId, week.week);
      run('INSERT OR IGNORE INTO learning_credits SELECT ?,user_id,item_id FROM learning_credits WHERE sprint_id=? AND user_id=? AND item_id=?', target.sprint_id, source.sprint_id, userId, `assignment:${week.week}`);
    }
  }
  function solo(source, user) {
    const anchor = { ...user, trackId: source.track_id, level: source.level, timezone: source.timezone, learningMode: 'solo' };
    detach(source, user.id);
    const squadId = createSquadRecord(anchor, { startDate: source.starts_at, endDate: source.ends_at, meetings: [] }, [user.id], false, { demo: !!source.is_demo });
    run("UPDATE squads SET learning_mode='solo',created_at=? WHERE id=?", source.created_at, squadId);
    run("UPDATE sprints SET plan=?,status='active' WHERE squad_id=?", source.plan, squadId);
    const target = squadRow(squadId);
    copyWork(source, target, user.id);
    for (let week = 1; week <= 4; week++) {
      const saved = q('SELECT release_at FROM course_release_dates WHERE sprint_id=? AND week=?', source.sprint_id, week)?.release_at;
      const date = saved || (week === 1 ? source.created_at : q('SELECT starts_at FROM meetings WHERE sprint_id=? AND week=? ORDER BY starts_at LIMIT 1', source.sprint_id, week)?.starts_at || DateTime.fromISO(source.starts_at).setZone(source.timezone).plus({ weeks: week - 1 }).toUTC().toISO());
      run('INSERT INTO course_release_dates VALUES (?,?,?)', target.sprint_id, week, date);
    }
    if (source.is_demo) run('UPDATE demo_runs SET squad_id=? WHERE owner_id=?', squadId, user.id);
    else {
      const { id, avatarUrl, ...profile } = anchor;
      run('UPDATE users SET profile=? WHERE id=?', JSON.stringify(profile), user.id);
      run('DELETE FROM matchmaking_queue WHERE user_id=?', user.id);
    }
    return squadId;
  }
  return {
    order,
    sync() {
      for (const row of all("SELECT q.*,s.id AS sprint_id,s.starts_at,s.ends_at,s.status FROM squads q JOIN sprints s ON s.squad_id=q.id WHERE s.status IN ('forming','ready','active') AND q.learning_mode='squad'")) {
        const count = members(row.id).length;
        if (count >= 3 && !row.established) { run('UPDATE squads SET established=1 WHERE id=?', row.id); row.established = 1; }
        let incident = openCase(row.id);
        if (count >= row.min_members) {
          if (incident) run("UPDATE recovery_cases SET state='resolved',updated_at=? WHERE id=?", stamp(), incident.id);
          continue;
        }
        if (!count) { run("UPDATE sprints SET status='closed' WHERE squad_id=?", row.id); if (incident) run("UPDATE recovery_cases SET state='closed',updated_at=? WHERE id=?", stamp(), incident.id); continue; }
        if (!row.established && stamp() < row.starts_at) continue;
        incident ||= makeCase(row, row.established ? 'team_shrank' : 'team_not_formed');
        if (!row.established || stamp() >= incident.deadline_at) refundAll(incident);
      }
      // Pending replacements retain their entitlement even after leaving the old squad.
      for (const pending of all("SELECT c.* ,r.user_id FROM recovery_choices r JOIN recovery_cases c ON c.id=r.case_id WHERE r.choice='rematch' AND r.target_squad_id IS NULL AND c.deadline_at<=?", stamp())) {
        recordRefund(pending, pending.user_id); decision(pending, pending.user_id, 'refund');
        if (q('SELECT profile FROM users WHERE id=?', pending.user_id) && JSON.parse(q('SELECT profile FROM users WHERE id=?', pending.user_id).profile).trackId === squadRow(pending.squad_id).track_id) run('DELETE FROM matchmaking_queue WHERE user_id=?', pending.user_id);
      }
    },
    view(squadId, userId) {
      const incident = q('SELECT * FROM recovery_cases WHERE squad_id=? ORDER BY opened_at DESC,rowid DESC LIMIT 1', squadId);
      if (!incident) return null;
      const choice = q('SELECT * FROM recovery_choices WHERE case_id=? AND user_id=?', incident.id, userId);
      const active = !!q('SELECT 1 FROM memberships WHERE squad_id=? AND user_id=? AND active=1', squadId, userId);
      const refund = q('SELECT amount_cents AS amountCents,paid_cents AS paidCents,currency,mode,state,created_at AS createdAt FROM course_refunds WHERE case_id=? AND user_id=?', incident.id, userId);
      const pending = choice?.choice === 'rematch' && !choice.target_squad_id;
      const eligible = !refund && (active && incident.state === 'open' || pending);
      return { id: incident.id, state: incident.state, reason: incident.reason, deadlineAt: incident.deadline_at, remainingMeetings: incident.remaining_meetings, totalMeetings: incident.total_meetings, fraction: incident.remaining_meetings / incident.total_meetings, choice: choice?.choice || null, targetSquadId: choice?.target_squad_id || null, refund: refund || null, canChoose: eligible, canDuo: eligible && active && members(squadId).length === 2, duoVotes: q("SELECT COUNT(*) AS n FROM recovery_choices r JOIN memberships m ON m.user_id=r.user_id AND m.squad_id=? AND m.active=1 WHERE r.case_id=? AND r.choice='duo'", squadId, incident.id).n };
    },
    pending(userId) {
      const row = q("SELECT c.squad_id FROM recovery_choices r JOIN recovery_cases c ON c.id=r.case_id WHERE r.user_id=? AND r.choice='rematch' AND r.target_squad_id IS NULL ORDER BY r.created_at DESC LIMIT 1", userId);
      return row ? { squadId: row.squad_id, ...this.view(row.squad_id, userId) } : null;
    },
    attach(squadId, userId) {
      const target = squadRow(squadId); if (target.is_demo) return;
      const pending = q("SELECT c.*,r.user_id FROM recovery_choices r JOIN recovery_cases c ON c.id=r.case_id JOIN squads s ON s.id=c.squad_id WHERE r.user_id=? AND r.choice='rematch' AND r.target_squad_id IS NULL AND s.track_id=? AND s.level=? ORDER BY r.created_at DESC LIMIT 1", userId, target.track_id, target.level);
      if (!pending) return;
      copyWork(squadRow(pending.squad_id), target, userId);
      decision(pending, userId, 'rematch', squadId);
    },
    choose(squadId, user, data) {
      return transaction(() => {
        const row = squadRow(squadId), view = this.view(squadId, user.id);
        if (!view || data.caseId !== view.id) throw new AppError(409, 'This recovery option has changed. Refresh your squad.', 'recovery_changed');
        if (!['duo', 'solo', 'rematch', 'refund'].includes(data.choice)) fail('Choose how you would like to continue.');
        if (view.choice === data.choice && (view.targetSquadId || view.refund)) return { squadId: view.targetSquadId, recovery: view };
        if (!view.canChoose) throw new AppError(403, 'This recovery option is no longer available.', 'recovery_unavailable');
        if (!row.is_demo && current(user.id, row.track_id) && current(user.id, row.track_id) !== squadId) throw new AppError(409, 'You already have another active enrollment in this course.', 'active_squad');
        const incident = q('SELECT * FROM recovery_cases WHERE id=?', view.id);
        let target = null;
        if (data.choice === 'duo') {
          if (!view.canDuo) fail('Two current learners must agree to continue together.');
          decision(incident, user.id, 'duo');
          const roster = members(squadId);
          if (row.is_demo) for (const person of roster.filter(person => person.isDemo)) decision(incident, person.id, 'duo');
          if (roster.every(person => q("SELECT 1 FROM recovery_choices WHERE case_id=? AND user_id=? AND choice='duo'", incident.id, person.id))) { run('UPDATE squads SET min_members=2 WHERE id=?', squadId); run("UPDATE recovery_cases SET state='resolved',updated_at=? WHERE id=?", stamp(), incident.id); }
        } else if (data.choice === 'refund') {
          recordRefund(incident, user.id); decision(incident, user.id, 'refund'); detach(row, user.id);
          if (!row.is_demo) run('DELETE FROM matchmaking_queue WHERE user_id=?', user.id);
        } else if (data.choice === 'solo') {
          target = solo(row, user); decision(incident, user.id, 'solo', target);
        } else if (row.is_demo) {
          target = demoSquads.start(user, row.track_id, true).squadId;
          copyWork(row, squadRow(target), user.id); decision(incident, user.id, 'rematch', target);
        } else {
          detach(row, user.id); decision(incident, user.id, 'rematch');
          const { id, avatarUrl, ...profile } = user;
          run('UPDATE users SET profile=? WHERE id=?', JSON.stringify({ ...profile, trackId: row.track_id, level: row.level, learningMode: 'squad' }), user.id);
          run("INSERT INTO matchmaking_queue VALUES (?,'waiting',?,?) ON CONFLICT(user_id) DO UPDATE SET state='waiting',expires_at=excluded.expires_at", user.id, stamp(), new Date(now().getTime() + 120000).toISOString());
        }
        this.sync();
        return { squadId: target, recovery: this.view(squadId, user.id), searching: data.choice === 'rematch' && !target };
      });
    },
  };
}
