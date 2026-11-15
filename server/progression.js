import { DateTime } from 'luxon';
import { publicQuiz } from './assessments.js';

// Catalog responses are previews, never an alternate endpoint for locked lessons.
export function coursePreview(course) {
  const { weeks, ...metadata } = course;
  return { ...metadata, weeks: weeks.map(week => ({ week: week.week, title: week.title, lessonCount: week.tasks.length })) };
}

function releaseForWeek(week, squad, meetings) {
  if (squad.releaseDates?.[week]) return squad.releaseDates[week];
  if (week === 1) return squad.createdAt;
  const scheduled = meetings.filter(meeting => meeting.week === week).map(meeting => meeting.startsAt).sort()[0];
  if (scheduled) return scheduled;
  // Old saved plans can predate meeting records. Use their original local cohort
  // clock for the fallback, preserving DST rather than adding fixed UTC days.
  return DateTime.fromISO(squad.startsAt).setZone(squad.timezone || 'UTC').plus({ weeks: week - 1 }).toUTC().toISO();
}

export function planAccess({ plan, progress, squad, meetings, quizResults = [], assignments = [], credits = [], now = new Date(), canEdit = false }) {
  const results = new Map(progress.map(result => [result.taskId, result]));
  const quizzes = new Map(quizResults.map(result => [result.taskId, result]));
  const submissions = new Map(assignments.map(result => [result.week, result]));
  const credited = new Set(credits);
  const tasks = plan.weeks.flatMap(week => week.tasks);
  const taskDone = task => results.get(task.id)?.status === 'done' && (!task.quiz || quizzes.get(task.id)?.passed || credited.has(`lesson:${task.id}`));
  const assignmentDone = week => !week.assignment || submissions.get(week.week)?.status === 'submitted' || credited.has(`assignment:${week.week}`);
  const completedHistory = squad.status === 'completed' && Date.parse(squad.endsAt) <= now.getTime();
  const accessByTask = new Map();
  const accessByAssignment = new Map();
  let firstIncomplete = null;
  const weeks = plan.weeks.map(week => {
    const releaseAt = releaseForWeek(week.week, squad, meetings);
    const released = !!releaseAt && Date.parse(releaseAt) <= now.getTime();
    const priorIncomplete = firstIncomplete;
    const visibleTasks = week.tasks.map(task => {
      const saved = results.get(task.id);
      const earned = !!saved && (saved.status !== 'not_started' || !!saved.note || !!saved.url);
      const unlocked = completedHistory || earned || (released && !firstIncomplete);
      const reason = unlocked ? null : !released ? 'week_not_released' : firstIncomplete?.kind === 'assignment' ? 'previous_assignment_incomplete' : 'previous_lesson_incomplete';
      const message = unlocked ? '' : reason === 'week_not_released' ? (squad.learningMode === 'solo' ? 'This week opens on its weekly release date.' : 'This week opens at its first scheduled meeting.') : reason === 'previous_assignment_incomplete' ? `Submit the Week ${firstIncomplete.week} assignment before continuing.` : 'Complete the earlier lesson and its quiz before continuing.';
      const access = { unlocked, canEdit: unlocked && canEdit, releaseAt, reason, message, ...(firstIncomplete?.taskId ? { previousTaskId: firstIncomplete.taskId } : {}), ...(firstIncomplete?.kind === 'assignment' ? { previousAssignmentWeek: firstIncomplete.week } : {}), ...(earned ? { earned: true } : {}) };
      accessByTask.set(task.id, access);
      if (!taskDone(task) && !firstIncomplete) firstIncomplete = { kind: 'lesson', taskId: task.id, week: week.week };
      return unlocked ? { ...task, ...(task.quiz ? { quiz: { ...publicQuiz(task.quiz), result: quizzes.get(task.id) || null, credited: credited.has(`lesson:${task.id}`) } } : {}), access } : { id: task.id, week: task.week, title: task.title, access };
    });
    let assignment;
    if (week.assignment) {
      const result = submissions.get(week.week) || null;
      const earned = !!result && (result.status === 'submitted' || result.text || result.url);
      const unlocked = completedHistory || credited.has(`assignment:${week.week}`) || earned || (released && !priorIncomplete && week.tasks.every(taskDone));
      const reason = unlocked ? null : !released ? 'week_not_released' : 'lessons_incomplete';
      const access = { unlocked, canEdit: unlocked && canEdit, releaseAt, reason, message: unlocked ? '' : reason === 'week_not_released' ? 'This assignment opens with its scheduled week, after the lessons.' : 'Complete this week’s lessons and all earlier work to open the assignment.' };
      accessByAssignment.set(week.week, access);
      assignment = { ...(unlocked ? week.assignment : { title: week.assignment.title }), access, ...(unlocked ? { result, credited: credited.has(`assignment:${week.week}`) } : {}) };
      if (!assignmentDone(week) && !firstIncomplete) firstIncomplete = { kind: 'assignment', week: week.week };
    }
    const unlocked = visibleTasks.some(task => task.access.unlocked);
    const firstLocked = visibleTasks.find(task => !task.access.unlocked);
    // Week preparation can itself contain instructions or answers. Keep it behind
    // the same boundary as the first accessible lesson.
    return { week: week.week, title: week.title, ...(unlocked && week.preparation ? { preparation: week.preparation } : {}), access: { released, unlocked, releaseAt, reason: unlocked ? null : firstLocked?.access.reason || null, message: unlocked ? '' : firstLocked?.access.message || '' }, tasks: visibleTasks, ...(assignment ? { assignment } : {}) };
  });
  const unfinished = tasks.filter(task => !taskDone(task));
  const nextAvailableTaskId = unfinished.find(task => accessByTask.get(task.id)?.unlocked)?.id || null;
  const nextReleaseAt = weeks.map(week => week.access.releaseAt).filter(value => value && Date.parse(value) > now.getTime()).sort()[0] || null;
  return {
    plan: { ...plan, weeks }, accessByTask, accessByAssignment,
    learningProgress: { done: tasks.length - unfinished.length, total: tasks.length, nextTaskId: unfinished[0]?.id || null, nextAvailableTaskId, nextReleaseAt, assignmentsDone: plan.weeks.filter(week => week.assignment && assignmentDone(week)).length, totalAssignments: plan.weeks.filter(week => week.assignment).length, nextAssignmentWeek: firstIncomplete?.kind === 'assignment' && accessByAssignment.get(firstIncomplete.week)?.unlocked ? firstIncomplete.week : null },
  };
}
