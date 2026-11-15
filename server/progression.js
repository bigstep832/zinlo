import { DateTime } from 'luxon';

// Catalog responses are previews, never an alternate endpoint for locked lessons.
export function coursePreview(course) {
  const { weeks, ...metadata } = course;
  return { ...metadata, weeks: weeks.map(week => ({ week: week.week, title: week.title, lessonCount: week.tasks.length })) };
}

function releaseForWeek(week, squad, meetings) {
  if (week === 1) return squad.createdAt;
  const scheduled = meetings.filter(meeting => meeting.week === week).map(meeting => meeting.startsAt).sort()[0];
  if (scheduled) return scheduled;
  // Old saved plans can predate meeting records. Use their original local cohort
  // clock for the fallback, preserving DST rather than adding fixed UTC days.
  return DateTime.fromISO(squad.startsAt).setZone(squad.timezone || 'UTC').plus({ weeks: week - 1 }).toUTC().toISO();
}

export function planAccess({ plan, progress, squad, meetings, now = new Date(), canEdit = false }) {
  const results = new Map(progress.map(result => [result.taskId, result]));
  const tasks = plan.weeks.flatMap(week => week.tasks);
  const completedHistory = squad.status === 'completed' && Date.parse(squad.endsAt) <= now.getTime();
  const accessByTask = new Map();
  let firstIncomplete = null;
  const weeks = plan.weeks.map(week => {
    const releaseAt = releaseForWeek(week.week, squad, meetings);
    const released = !!releaseAt && Date.parse(releaseAt) <= now.getTime();
    const visibleTasks = week.tasks.map(task => {
      const saved = results.get(task.id);
      const earned = !!saved && (saved.status !== 'not_started' || !!saved.note || !!saved.url);
      const unlocked = completedHistory || earned || (released && !firstIncomplete);
      const reason = unlocked ? null : !released ? 'week_not_released' : 'previous_lesson_incomplete';
      const message = unlocked ? '' : reason === 'week_not_released' ? 'This week opens at its first scheduled meeting.' : 'Complete the earlier lesson before continuing.';
      const access = { unlocked, canEdit: unlocked && canEdit, releaseAt, reason, message, ...(firstIncomplete ? { previousTaskId: firstIncomplete } : {}), ...(earned ? { earned: true } : {}) };
      accessByTask.set(task.id, access);
      if (saved?.status !== 'done' && !firstIncomplete) firstIncomplete = task.id;
      return unlocked ? { ...task, access } : { id: task.id, week: task.week, title: task.title, access };
    });
    const unlocked = visibleTasks.some(task => task.access.unlocked);
    const firstLocked = visibleTasks.find(task => !task.access.unlocked);
    // Week preparation can itself contain instructions or answers. Keep it behind
    // the same boundary as the first accessible lesson.
    return { week: week.week, title: week.title, ...(unlocked && week.preparation ? { preparation: week.preparation } : {}), access: { released, unlocked, releaseAt, reason: unlocked ? null : firstLocked?.access.reason || null, message: unlocked ? '' : firstLocked?.access.message || '' }, tasks: visibleTasks };
  });
  const unfinished = tasks.filter(task => results.get(task.id)?.status !== 'done');
  const nextAvailableTaskId = unfinished.find(task => accessByTask.get(task.id)?.unlocked)?.id || null;
  const nextReleaseAt = weeks.map(week => week.access.releaseAt).filter(value => value && Date.parse(value) > now.getTime()).sort()[0] || null;
  return {
    plan: { ...plan, weeks }, accessByTask,
    learningProgress: { done: tasks.length - unfinished.length, total: tasks.length, nextTaskId: unfinished[0]?.id || null, nextAvailableTaskId, nextReleaseAt },
  };
}
