import React, { useEffect, useRef, useState } from 'react';

const emptyResult = { status: 'not_started', note: '', url: '' };
const statusLabel = status => status === 'done' ? 'Done' : status === 'in_progress' ? 'In progress' : 'Not started';
const textList = value => Array.isArray(value) ? value.filter(item => typeof item === 'string') : [];
const resultValue = result => ({ status: result?.status || 'not_started', note: result?.note || '', url: result?.url || '' });
const sameResult = (left, right) => left.status === right.status && left.note === right.note && left.url === right.url;

function availableDate(value, zone) {
  if (!value) return '';
  try { return new Intl.DateTimeFormat('en-US', { timeZone: zone, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date(value)); }
  catch { return ''; }
}

function AccessMessage({ access, zone }) {
  if (!access || access.unlocked) return null;
  const date = availableDate(access.releaseAt, zone);
  return <p className="lesson-lock"><strong>Locked.</strong> {access.message || (access.reason === 'previous_lesson_incomplete' ? 'Complete the earlier lessons first.' : 'This lesson opens with its scheduled week.')}{access.reason === 'week_not_released' && date ? ` Opens ${date}.` : ''}</p>;
}

function LessonMaterials({ task, level, part }) {
  const lesson = task.lesson;
  const criteria = Array.isArray(task.criteria) ? task.criteria.join(' · ') : task.criteria;
  return <article className="panel lesson-material">
    {lesson ? <>
      {part === 'learn' && textList(lesson.objectives).length > 0 && <section><h3>What you will learn</h3><ul>{lesson.objectives.map((objective, index) => <li key={index}>{objective}</li>)}</ul></section>}
      {part === 'learn' && (lesson.sections || []).map((section, index) => <section key={index}><h3>{section.title}</h3>{textList(section.paragraphs).map((paragraph, number) => <p key={number}>{paragraph}</p>)}{typeof section.example === 'string' && <pre className="lesson-example">{section.example}</pre>}</section>)}
      {part === 'practice' && lesson.exercise && <section><h3>Try it yourself</h3><p>{lesson.exercise.prompt}</p>{textList(lesson.exercise.checklist).length > 0 && <ol>{lesson.exercise.checklist.map((item, index) => <li key={index}>{item}</li>)}</ol>}{typeof lesson.exercise.sampleAnswer === 'string' && <details><summary>Show a sample answer</summary><pre className="lesson-example">{lesson.exercise.sampleAnswer}</pre></details>}</section>}
      {part === 'practice' && Array.isArray(lesson.checks) && lesson.checks.length > 0 && <section><h3>Check your understanding</h3><p className="muted">Think through each question before revealing the answer.</p>{lesson.checks.map((check, index) => <div className="lesson-check" key={index}><p><strong>{index + 1}. {check.question}</strong></p><details><summary>Show answer</summary><p>{check.answer}</p>{check.explanation && <p>{check.explanation}</p>}</details></div>)}</section>}
      {part === 'learn' && textList(lesson.recap).length > 0 && <section><h3>Remember</h3><ul>{lesson.recap.map((item, index) => <li key={index}>{item}</li>)}</ul></section>}
    </> : <>
      {part === 'learn' && textList(task.steps).length > 0 && <section><h3>Follow these steps</h3><ol>{task.steps.map((step, index) => <li key={index}>{step}</li>)}</ol></section>}
      {part === 'learn' && typeof task.example === 'string' && <section><h3>Example</h3><pre className="lesson-example">{task.example}</pre></section>}
      {part === 'learn' && !textList(task.steps).length && !task.example && <p>Start with the task brief above. Open Practice to see the completion goal, then save what you tried in My result.</p>}
    </>}
    {part === 'practice' && textList(task.practice).length > 0 && <section><h3>Practice with your squad</h3><ul>{task.practice.map((activity, index) => <li key={index}>{activity}</li>)}</ul></section>}
    {part === 'practice' && level === 'basics' && typeof task.extension === 'string' && <section><h3>Extra challenge</h3><p>{task.extension}</p></section>}
    {part === 'practice' && criteria && <section className="lesson-completion"><h3>You are done when</h3><p>{criteria}</p></section>}
    {part === 'learn' && Array.isArray(lesson?.sources) && lesson.sources.length > 0 && <details><summary>Further reading</summary><ul>{lesson.sources.filter(source => /^https?:\/\//.test(source.url || '')).map((source, index) => <li key={index}><a href={source.url} target="_blank" rel="noopener noreferrer">{source.title}</a></li>)}</ul></details>}
  </article>;
}

function ResultEditor({ value, saved, editable, draft, state, onChange, onSave }) {
  return <form className="panel lesson-result" onSubmit={event => { event.preventDefault(); onSave(); }}>
    <h3>Your result for this lesson</h3>
    <p className="muted">Save what you tried and mark the lesson Done when you meet its goal. Your squad can see saved results.</p>
    {!editable && <p className="notice">Your saved result is read-only.</p>}
    <fieldset disabled={!editable || state?.busy}>
      <label>Status<select value={value.status} onChange={event => onChange('status', event.target.value)}><option value="not_started">Not started</option><option value="in_progress">In progress</option><option value="done">Done</option></select></label>
      <label>Your notes or result (optional)<textarea rows={4} maxLength={2000} value={value.note} onChange={event => onChange('note', event.target.value)} placeholder="What did you learn or practise? What would you like to ask your squad?" /></label>
      <label>Result link (optional)<input type="url" maxLength={1000} value={value.url} onChange={event => onChange('url', event.target.value)} placeholder="https://…" /></label>
      {editable && <button className="primary" disabled={state?.busy}>{state?.busy ? 'Saving…' : value.status === 'done' && saved.status !== 'done' ? 'Save and complete lesson' : 'Save result'}</button>}
    </fieldset>
    {draft?.dirty && <p className="muted">Unsaved draft. It stays while you move between weeks and tabs; save it before leaving this squad page.</p>}
    {state?.error && <p className="notice error" role="alert">{state.error}</p>}
    {state?.success && <p className="notice" role="status">{state.success}</p>}
  </form>;
}

export function LearningWorkspace({ activeTab, data, track, zone, selfId, request, openPlan, api, onSaved, aiAvailable, adapt, adapting, working }) {
  const [selection, setSelection] = useState({ week: null, taskId: null });
  const [lessonPart, setLessonPart] = useState('learn');
  const [drafts, setDrafts] = useState({});
  const [saveStates, setSaveStates] = useState({});
  const headingRef = useRef(null);
  const focusPending = useRef(false);
  const partRef = useRef(null);
  const partTabs = useRef([]);
  const focusPart = useRef(false);
  const mounted = useRef(true);
  const { squad, plan, progress, canEdit } = data;
  const tasks = plan.weeks.flatMap(week => week.tasks);
  const savedByTask = new Map(progress.map(result => [result.taskId, resultValue(result)]));
  const done = data.learningProgress?.done ?? progress.filter(result => result.status === 'done').length;
  const total = data.learningProgress?.total ?? tasks.length;
  const suggested = tasks.find(task => task.id === data.learningProgress?.nextAvailableTaskId && task.access?.unlocked);
  const nextTask = tasks.find(task => task.id === data.learningProgress?.nextTaskId);
  const selectedWeek = plan.weeks.find(week => week.week === selection.week);
  const selectedTask = selectedWeek?.tasks.find(task => task.id === selection.taskId);
  const draftCount = Object.values(drafts).filter(draft => draft.dirty).length;

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (!draftCount) return;
    const warn = event => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [draftCount]);
  useEffect(() => {
    setDrafts(existing => {
      let changed = false;
      const next = { ...existing };
      for (const [taskId, draft] of Object.entries(existing)) {
        if (!draft.dirty && sameResult(draft.value, resultValue(progress.find(result => result.taskId === taskId)))) { delete next[taskId]; changed = true; }
      }
      return changed ? next : existing;
    });
  }, [progress]);
  useEffect(() => {
    if (!request) return;
    const task = tasks.find(item => item.id === request.taskId);
    const week = task?.week ?? request.week;
    if (week) { focusPending.current = true; setLessonPart('learn'); setSelection({ week, taskId: task?.access?.unlocked ? task.id : null }); }
  }, [request]);
  useEffect(() => {
    if (focusPending.current && ['plan', 'progress'].includes(activeTab)) { focusPending.current = false; headingRef.current?.focus(); }
  }, [selection.week, selection.taskId, activeTab]);
  useEffect(() => { if (focusPart.current) { focusPart.current = false; partRef.current?.focus(); } }, [lessonPart]);

  function showWeek(week) { focusPending.current = true; setSelection({ week, taskId: null }); openPlan(); }
  function showTask(task, part = 'learn') { if (!task?.access?.unlocked) return; focusPending.current = true; setLessonPart(part); setSelection({ week: task.week, taskId: task.id }); openPlan(); }
  function showPart(part) { focusPart.current = true; setLessonPart(part); }
  function showAllWeeks() { focusPending.current = true; setSelection({ week: null, taskId: null }); openPlan(); }
  function changeResult(taskId, key, value) {
    setDrafts(existing => ({ ...existing, [taskId]: { dirty: true, value: { ...(existing[taskId]?.value || savedByTask.get(taskId) || emptyResult), [key]: value } } }));
    setSaveStates(existing => ({ ...existing, [taskId]: { ...existing[taskId], success: '', error: '' } }));
  }
  async function saveResult(task) {
    if (!canEdit || !task.access?.canEdit || saveStates[task.id]?.busy) return;
    const submitted = drafts[task.id]?.value || savedByTask.get(task.id) || emptyResult;
    setSaveStates(existing => ({ ...existing, [task.id]: { busy: true, error: '', success: '' } }));
    let saved = false;
    try {
      await api(`/squads/${squad.id}/progress/${task.id}`, 'PUT', submitted);
      saved = true;
      if (mounted.current) setDrafts(existing => ({ ...existing, [task.id]: existing[task.id]?.value && existing[task.id].value !== submitted ? existing[task.id] : { value: submitted, dirty: false } }));
      await onSaved();
      if (mounted.current) setSaveStates(existing => ({ ...existing, [task.id]: { busy: false, success: 'Your result is saved.', error: '' } }));
    } catch (error) {
      if (mounted.current) setSaveStates(existing => ({ ...existing, [task.id]: { busy: false, success: saved ? 'Your result was saved. Refresh to update lesson availability.' : '', error: saved ? '' : error.message } }));
      if (!saved && error.code === 'lesson_locked') await onSaved().catch(() => {});
    }
  }
  function weekDone(week) { return week.tasks.filter(task => savedByTask.get(task.id)?.status === 'done').length; }
  function weekStatus(week) {
    if (weekDone(week) === week.tasks.length) return 'Completed';
    if (week.access?.unlocked || week.tasks.some(task => task.access?.unlocked)) return 'Available';
    return week.access?.reason === 'week_not_released' ? `Opens ${availableDate(week.access.releaseAt, zone)}` : 'Complete earlier lessons';
  }

  if (activeTab === 'overview') return null;
  if (activeTab === 'progress') return <div className="learning-workspace">
    <section className="panel progress-summary"><h2 ref={headingRef} tabIndex={-1}>Your progress</h2><p className="lead"><strong>{done} of {total} lessons completed</strong></p><progress value={done} max={total} aria-label={`${done} of ${total} lessons completed`} />{suggested ? <><p>Next: <strong>{suggested.title}</strong></p><button className="primary" onClick={() => showTask(suggested)}>Continue learning</button></> : nextTask ? <><p>Next: <strong>{nextTask.title}</strong></p><AccessMessage access={nextTask.access} zone={zone} /></> : <p>Your saved work is available in the study plan.</p>}</section>
    <section className="panel"><h3>By week</h3><div className="week-progress-list">{plan.weeks.map(week => <div className="week-progress-row" key={week.week}><div><strong>Week {week.week} · {week.title}</strong><p className="muted">{weekDone(week)} of {week.tasks.length} lessons done · {weekStatus(week)}</p></div><button onClick={() => showWeek(week.week)}>View week {week.week}</button></div>)}</div></section>
    <section className="panel"><h3>Your squad’s progress</h3><p className="muted">These are self-reported results, not a ranking or assessment.</p>{data.teamProgress?.map(person => <details className="team-result-summary" key={person.userId}><summary>{person.name}{person.userId === selfId ? ' (you)' : ''} · {person.done} of {person.total} lessons</summary>{person.results?.some(result => result.status !== 'not_started' || result.note || result.url) ? person.results.filter(result => result.status !== 'not_started' || result.note || result.url).map(result => <article className="shared-result" key={result.taskId}><h4>{tasks.find(task => task.id === result.taskId)?.title || result.taskId}</h4><p>{statusLabel(result.status)}</p>{result.locked ? <p className="muted">Unlock this lesson to view its shared notes and links.</p> : <>{result.note && <p className="preserve-lines">{result.note}</p>}{result.url && <a href={result.url} target="_blank" rel="noopener noreferrer">Open result</a>}</>}</article>) : <p>No results shared yet.</p>}</details>)}</section>
  </div>;

  if (!selectedWeek) return <div className="learning-workspace">
    <div className="learning-intro"><h2 ref={headingRef} tabIndex={-1}>Your four-week plan</h2><p>{track?.project || 'Learn one step at a time with your squad.'}</p><p className="muted">Choose a week. Each contains two lessons and a place to save your results.</p></div>
    <ol className="week-grid">{plan.weeks.map(week => <li className="week-card" key={week.week}><button className="week-card-button" onClick={() => showWeek(week.week)}><span className="week-card-copy"><span className="eyebrow">Week {week.week}</span><span className="week-title">{week.title}</span>{week.summary && <span>{week.summary}</span>}<span className="muted">{week.tasks.length} lessons · {weekDone(week)} completed · {weekStatus(week)}</span></span><span className="week-open-label">View week {week.week}</span></button></li>)}</ol>
    {(track?.starterUrl || track?.id === 'ai') && <details className="panel"><summary>Course resources</summary>{track.starterUrl && <p><a href={track.starterUrl} target="_blank" rel="noopener noreferrer">Open the starter</a>{' · '}<a href={track.starterUrl} download="starter.html">Download HTML</a>{' · '}<a href="/starter.js" download="starter.js">Download JavaScript</a></p>}{track.id === 'ai' && <p>Mock responses support free practice. A live model requires your own provider account and may have separate usage fees.</p>}</details>}
    {aiAvailable && canEdit && plan.source !== 'ai' && <details className="panel"><summary>Plan options</summary><p className="muted">{working ? 'Work has started, so this plan stays fixed.' : draftCount ? 'Save your draft before changing the plan.' : 'You can optionally adapt this plan to your squad with AI before work starts.'}</p><button disabled={adapting || working || draftCount > 0} onClick={adapt}>{adapting ? 'Adapting…' : 'Customize plan with AI'}</button></details>}
  </div>;

  if (!selectedTask) return <div className="learning-workspace">
    <nav className="learning-breadcrumbs" aria-label="Study plan navigation"><button className="text-button" onClick={showAllWeeks}>Back to all weeks</button></nav>
    <div className="learning-intro"><p className="eyebrow">Week {selectedWeek.week}</p><h2 ref={headingRef} tabIndex={-1}>{selectedWeek.title}</h2>{selectedWeek.summary && <p>{selectedWeek.summary}</p>}<p className="muted">{weekDone(selectedWeek)} of {selectedWeek.tasks.length} lessons completed</p></div>
    <div className="lesson-choice-list">{selectedWeek.tasks.map((task, index) => {
      const saved = savedByTask.get(task.id) || emptyResult;
      return <article className="panel lesson-choice" key={task.id}>
        <div><p className="eyebrow">Lesson {index + 1}</p><h3>{task.title}</h3>
          {task.description && <p>{task.description}</p>}
          {(saved.status !== 'not_started' || task.access?.unlocked) && <p><strong>{saved.status !== 'not_started' ? statusLabel(saved.status) : 'Ready to start'}</strong>{drafts[task.id]?.dirty && <span className="muted"> · Unsaved draft</span>}</p>}
          {task.access?.unlocked && saved.note && <p className="saved-note-preview"><strong>Your saved result:</strong> {saved.note}</p>}
          <AccessMessage access={task.access} zone={zone} />
        </div>
        <div className="lesson-choice-actions"><button className={task.access?.unlocked ? 'primary' : ''} disabled={!task.access?.unlocked} onClick={() => showTask(task)}>{saved.status === 'done' ? 'Review lesson' : 'Open lesson'}</button>{task.access?.unlocked && <button onClick={() => showTask(task, 'result')}>My result</button>}</div>
      </article>;
    })}</div>
    {selectedWeek.preparation && <details className="panel"><summary>Prepare for this week</summary><p>{selectedWeek.preparation}</p></details>}
  </div>;

  const saved = savedByTask.get(selectedTask.id) || emptyResult;
  const following = tasks[tasks.findIndex(task => task.id === selectedTask.id) + 1];
  return <div className="learning-workspace">
    <nav className="learning-breadcrumbs" aria-label="Study plan navigation"><button className="text-button" onClick={showAllWeeks}>All weeks</button><span aria-hidden="true">/</span><button className="text-button" onClick={() => showWeek(selectedWeek.week)}>Back to week {selectedWeek.week}</button></nav>
    <div className="learning-intro"><p className="eyebrow">Week {selectedWeek.week} · Lesson {selectedWeek.tasks.findIndex(task => task.id === selectedTask.id) + 1}</p><h2 ref={headingRef} tabIndex={-1}>{selectedTask.title}</h2>{selectedTask.description && <p className="lead">{selectedTask.description}</p>}</div>
    {!selectedTask.access?.unlocked ? <section className="panel"><AccessMessage access={selectedTask.access} zone={zone} /><p>Your draft is kept while you stay on this squad page.</p></section> : <>
      <div className="lesson-tabs" role="tablist" aria-label="Lesson sections">{['learn', 'practice', 'result'].map((part, index) => <button key={part} ref={node => { partTabs.current[index] = node; }} id={`lesson-tab-${part}`} role="tab" aria-selected={lessonPart === part} aria-controls={`lesson-panel-${part}`} tabIndex={lessonPart === part ? 0 : -1} onClick={() => setLessonPart(part)} onKeyDown={event => { const next = event.key === 'ArrowRight' ? (index + 1) % 3 : event.key === 'ArrowLeft' ? (index + 2) % 3 : event.key === 'Home' ? 0 : event.key === 'End' ? 2 : null; if (next !== null) { event.preventDefault(); setLessonPart(['learn', 'practice', 'result'][next]); partTabs.current[next]?.focus(); } }}>{part === 'result' ? 'My result' : part === 'learn' ? 'Learn' : 'Practice'}</button>)}</div>
      <div ref={partRef} tabIndex={-1} role="tabpanel" id={`lesson-panel-${lessonPart}`} aria-labelledby={`lesson-tab-${lessonPart}`}>
        {lessonPart === 'result' ? <><ResultEditor value={drafts[selectedTask.id]?.value || saved} saved={saved} draft={drafts[selectedTask.id]} editable={canEdit && selectedTask.access.canEdit} state={saveStates[selectedTask.id]} onChange={(key, value) => changeResult(selectedTask.id, key, value)} onSave={() => saveResult(selectedTask)} />{saved.status === 'done' && <section className="panel lesson-next"><h3>{following ? 'Your next step' : 'Last lesson completed'}</h3>{following ? <><p>{following.title}</p>{following.access?.unlocked ? <button className="primary" onClick={() => showTask(following)}>Continue to next lesson</button> : <AccessMessage access={following.access} zone={zone} />}</> : <p>You can review your results from any week.</p>}</section>}</> : <><LessonMaterials task={selectedTask} level={squad.level} part={lessonPart} /><div className="actions lesson-continue"><button className="primary" onClick={() => showPart(lessonPart === 'learn' ? 'practice' : 'result')}>{lessonPart === 'learn' ? 'Continue to practice' : 'Go to my result'}</button></div></>}
      </div>
    </>}
  </div>;
}
