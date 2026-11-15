import { randomUUID } from 'node:crypto';
import { AppError } from './scheduling.js';

export function createDemoSquads({ q, run, now, rate, transaction, createSquadRecord, squadRow, summary }) {
  const stamp = () => now().toISOString();
  const owned = (squadId, userId) => !!q('SELECT 1 FROM demo_runs WHERE squad_id=? AND owner_id=?', squadId, userId);
  return {
    owned,
    current(userId) { return q("SELECT d.squad_id FROM demo_runs d JOIN sprints s ON s.squad_id=d.squad_id JOIN memberships m ON m.squad_id=d.squad_id AND m.user_id=d.owner_id WHERE d.owner_id=? AND m.active=1 AND s.status IN ('ready','active')", userId)?.squad_id || null; },
    start(user, trackId = 'python', replace = false) {
      return transaction(() => {
        const existing = this.current(user.id);
        if (existing && !replace) return { squadId: existing, squad: summary(squadRow(existing)) };
        rate(`demo:${user.id}`, 6, 3600000);
        if (existing) { run("UPDATE sprints SET status='closed' WHERE squad_id=?", existing); run('UPDATE memberships SET active=0,left_at=? WHERE squad_id=? AND user_id=?', stamp(), existing, user.id); }
        const anchor = { ...user, name: user.name || 'Guest', trackId, level: 'beginner', timezone: user.timezone || 'UTC', learningMode: 'squad' };
        const people = [user.id];
        for (const name of ['Maya (demo)', 'Sam (demo)']) {
          const id = randomUUID(); people.push(id);
          run('INSERT INTO users VALUES (?,?,?)', id, JSON.stringify({ ...anchor, id: undefined, avatarUrl: undefined, name, isDemo: true }), stamp());
        }
        const meetings = Array.from({ length: 8 }, (_, index) => {
          const start = now().getTime() + (Math.floor(index / 2) * 7 + index % 2 * 3) * 86400000 + 300000;
          return { startsAt: new Date(start).toISOString(), endsAt: new Date(start + 3000000).toISOString(), windowEndsAt: new Date(start + 3600000).toISOString(), week: Math.floor(index / 2) + 1 };
        });
        const squadId = createSquadRecord(anchor, { startDate: stamp(), endDate: new Date(now().getTime() + 28 * 86400000).toISOString(), meetings }, people, false, { demo: true });
        run("UPDATE sprints SET status='active' WHERE squad_id=?", squadId);
        run('INSERT INTO demo_runs(owner_id,squad_id) VALUES (?,?) ON CONFLICT(owner_id) DO UPDATE SET squad_id=excluded.squad_id', user.id, squadId);
        for (let i = 1; i < people.length; i++) run('INSERT INTO chat_messages(squad_id,user_id,client_id,text,created_at) VALUES (?,?,?,?,?)', squadId, people[i], `demo-welcome-${i}`, i === 1 ? 'Welcome! I’m a simulated teammate. Try a lesson, share a file, or open the demo call.' : 'I’m a simulated teammate too. This sample squad lets you explore Zinlo with one device.', stamp());
        return { squadId, squad: summary(squadRow(squadId)) };
      });
    },
    reply(squadId, messageId) {
      const row = squadRow(squadId);
      if (!row.is_demo) return;
      const bot = q("SELECT m.user_id FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.squad_id=? AND m.active=1 AND json_extract(u.profile,'$.isDemo')=1 ORDER BY m.user_id LIMIT 1", squadId);
      if (bot) run('INSERT OR IGNORE INTO chat_messages(squad_id,user_id,client_id,text,created_at) VALUES (?,?,?,?,?)', squadId, bot.user_id, `demo-reply-${messageId}`, 'Sample reply: your message is saved. In a real squad, your teammates can respond here and discuss your work.', stamp());
    },
    shrink(squadId, user, count) {
      if (!owned(squadId, user.id)) throw new AppError(403, 'Only the owner can change this demo.', 'forbidden');
      if (![1, 2].includes(count)) throw new AppError(400, 'Choose one or two remaining learners.', 'invalid_demo');
      const bots = q("SELECT COUNT(*) AS n FROM memberships WHERE squad_id=? AND active=1", squadId).n;
      if (bots <= count) throw new AppError(409, 'This demo already has that many participants or fewer.', 'demo_state');
      run('UPDATE memberships SET active=0,left_at=? WHERE squad_id=? AND user_id IN (SELECT user_id FROM memberships WHERE squad_id=? AND active=1 AND user_id<>? ORDER BY user_id LIMIT ?)', stamp(), squadId, squadId, user.id, bots - count);
    },
  };
}
