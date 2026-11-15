import React from 'react';

export const emptyAssignment = { text: '', url: '', checkedCriteria: [] };
export const assignmentValue = result => ({ text: result?.text || '', url: result?.url || '', checkedCriteria: result?.checkedCriteria || [] });

function Feedback({ state }) {
  return <>{state?.error && <p className="notice error" role="alert">{state.error}</p>}{state?.success && <p className="notice" role="status">{state.success}</p>}</>;
}

export function QuizPanel({ task, answers, onAnswer, onSubmit, editable, state, next }) {
  const { quiz } = task;
  const result = quiz.result;
  const disabled = !editable || state?.busy || result?.passed;
  const answered = quiz.questions.every(question => answers[question.id] !== undefined);
  return <>
    <form className="panel quiz-panel" onSubmit={event => { event.preventDefault(); onSubmit(); }}>
      <h3>Lesson quiz</h3>
      <p>Three short questions. Answer all three correctly to complete this lesson. You can retry after reviewing the explanations.</p>
      {quiz.credited && <p className="notice">You completed this lesson before quizzes were added. That completion is kept; a retake is optional.</p>}
      {result && <p className="notice" role="status"><strong>{result.passed ? 'Quiz passed' : 'Keep practising'} · {result.score} of {result.total}</strong>{result.passed ? '. Your lesson is complete.' : '. Review your last attempt below, change your answers and try again.'}</p>}
      {!editable && <p className="muted">This quiz is read-only for this sprint.</p>}
      {quiz.questions.map((question, index) => {
        const feedback = result?.feedback.find(item => item.questionId === question.id);
        return <fieldset className="quiz-question" key={question.id} disabled={disabled}>
          <legend>{index + 1}. {question.prompt}</legend>
          {question.options.map(option => <label className="choice" key={option.id}><input type="radio" name={`${task.id}-${question.id}`} value={option.id} checked={answers[question.id] === option.id} onChange={() => onAnswer(question.id, option.id)} /><span>{option.text}</span></label>)}
          {feedback && <div className="quiz-explanation"><p><strong>Last attempt: {feedback.correct ? 'Correct' : 'Review this answer'}.</strong> {feedback.explanation}</p>{!feedback.correct && <p>Answer: {question.options.find(option => option.id === feedback.correctOptionId)?.text}</p>}</div>}
        </fieldset>;
      })}
      {editable && !result?.passed && <div className="actions"><button className="primary" disabled={state?.busy || !answered}>{state?.busy ? 'Checking…' : result ? 'Check answers again' : 'Check answers'}</button>{!answered && <span className="muted">Choose an answer for every question.</span>}</div>}
      <Feedback state={state} />
    </form>
    {(result?.passed || quiz.credited) && next}
  </>;
}

export function AssignmentPanel({ assignment, value, dirty, onChange, onSave, editable, state, next, solo }) {
  const submitted = assignment.result?.status === 'submitted';
  const checked = value.checkedCriteria;
  const canSubmit = value.text.trim().length >= 40 && assignment.checklist.every(item => checked.includes(item.id));
  return <>
    <article className="panel assignment-brief">
      <h3>Your weekly assignment</h3><p>{assignment.prompt}</p>
      <h4>What to hand in</h4><ul>{assignment.deliverables.map((item, index) => <li key={index}>{item}</li>)}</ul>
      <p className="muted">{solo ? 'Submit your own work after checking it against every requirement.' : 'Submit your own work, then discuss it with your squad.'} Submission unlocks the next scheduled week. The checklist is your self-review; practical work is not automatically graded or reviewed by an instructor.</p>
      {assignment.credited && <p className="notice">Your previously completed week is already credited. Submitting this new assignment is optional.</p>}
    </article>
    <form className="panel assignment-form" onSubmit={event => { event.preventDefault(); onSave('submitted'); }}>
      <h3>{submitted ? 'Your submitted work' : 'Your work'}</h3>
      {submitted && <p className="notice">{solo ? 'Submitted. Your work is saved; you can improve and update this version.' : 'Submitted. You can improve and update this version; your squad can read it.'}</p>}
      {!editable && <p className="muted">Your saved work is read-only.</p>}
      <fieldset disabled={!editable || state?.busy}>
        <label>Your work and a short explanation<textarea rows={9} maxLength={12000} value={value.text} onChange={event => onChange('text', event.target.value)} placeholder="Paste your work, code or dialogue. If you link to a project, describe what you built, how you checked it and what you learned." /></label>
        <p className="muted">At least 40 characters when submitting. Do not include private data or passwords. Code is saved as text; this site does not run it.</p>
        <label>Project or document link (optional)<input type="url" maxLength={1000} value={value.url} onChange={event => onChange('url', event.target.value)} placeholder="https://…" /></label>
        <fieldset className="assignment-checklist"><legend>Check your work</legend>{assignment.checklist.map(item => <label className="choice" key={item.id}><input type="checkbox" checked={checked.includes(item.id)} onChange={event => onChange('checkedCriteria', event.target.checked ? [...checked, item.id] : checked.filter(id => id !== item.id))} /><span>{item.text}</span></label>)}</fieldset>
        {editable && <div className="actions">{!submitted && <button type="button" disabled={state?.busy} onClick={() => onSave('draft')}>Save draft</button>}<button className="primary" disabled={state?.busy || !canSubmit}>{state?.busy ? 'Saving…' : submitted ? 'Update submission' : 'Submit assignment'}</button></div>}
      </fieldset>
      {dirty && <p className="muted">Unsaved changes. Save your draft before leaving this squad page.</p>}
      <Feedback state={state} />
    </form>
    <section className="panel"><h3>{solo ? 'Reflect on your work' : 'Discuss with your squad'}</h3><p>{solo ? 'Explain your approach out loud. What worked, what did you change, and what would you do differently next time? Save these reflections with your result.' : assignment.discussion}</p><p className="muted">{solo ? 'Your submitted work is available in Progress.' : 'Submitted work is shared in Progress. Each learner’s progress is independent.'}</p></section>
    {(submitted || assignment.credited) && next}
  </>;
}
