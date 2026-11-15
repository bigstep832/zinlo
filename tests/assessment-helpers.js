import { courseQuizzes } from '../server/assessments.js';

export async function passQuiz(person, squadId, taskId, trackId = 'python') {
  const quiz = courseQuizzes[trackId]?.[taskId];
  if (!quiz) return;
  return person.ok(`/api/squads/${squadId}/quizzes/${taskId}`, 'POST', { answers: Object.fromEntries(quiz.questions.map(question => [question.id, question.correctOptionId])) });
}

export async function submitAssignment(person, squadId, week) {
  const detail = await person.ok(`/api/squads/${squadId}`);
  const assignment = detail.plan.weeks.find(item => item.week === week).assignment;
  if (!assignment) return;
  return person.ok(`/api/squads/${squadId}/assignments/${week}`, 'PUT', { status: 'submitted', text: 'Test learner work: completed the practical exercise, checked each requirement and recorded the actual results.', url: '', checkedCriteria: assignment.checklist.map(item => item.id) });
}
