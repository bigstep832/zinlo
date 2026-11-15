# Weekly learning and lesson access

The study plan starts with four compact week cards. Selecting a week shows its two lessons and the learner's saved results. A lesson contains teaching material, practice, self-checks and its own result form. Progress is a summary with links back to the relevant week, not a second copy of every result form.

## Release rules

- Week 1 is available when the squad is created, so learners can prepare before meeting.
- Weeks 2–4 open at the first scheduled meeting of that week. The server uses the actual UTC meeting instant; the client displays it in the learner's time zone.
- Each lesson requires all earlier lessons to be marked done by that learner. The rule also applies across week boundaries.
- Teammates' completion does not control personal access. Earlier lessons remain available for review and catch-up.
- Existing saved work stays accessible even if an earlier result is reopened. No progress, original plan or meeting link is erased by this change.
- Leaving a squad or having it close does not unlock future lessons. Previous membership remains read-only.
- After the four-week sprint has completed, its full plan is available for read-only review, matching the existing history behavior.

Completion is a learner's own report. Self-check answers are revealable study aids, not automatically graded exams or certification. Payment processing is still outside the current implementation.

## Server contract

`GET /api/bootstrap` (also returned by session creation) contains course previews only. Each course's `weeks` is an array of `{week,title,lessonCount}`. No lesson instructions, examples, exercises, answers or week preparation are included in the public catalog.

The authorized squad dashboard adds:

```js
learningProgress: {
  done, total,
  nextTaskId,             // first unfinished lesson, including a locked lesson
  nextAvailableTaskId,    // first unfinished lesson this learner may open, or null
  nextReleaseAt          // next future week-release instant, or null
}
```

Each week has `access: {released,unlocked,releaseAt,reason,message}`. A week can be released by the calendar but still locked because earlier lessons are incomplete. Week preparation is omitted when none of its lessons is accessible.

Each task has:

```js
access: {
  unlocked, canEdit, releaseAt,
  reason: null | 'week_not_released' | 'previous_lesson_incomplete',
  message,
  previousTaskId?,        // first earlier unfinished task
  earned?                // saved started/completed work remains readable
}
```

A locked task is serialized as `{id,week,title,access}` only. The server removes teaching material from the response; hiding a browser button is not the access control. Teammate results for a task locked to the viewer retain status/counts but have blank `note` and `url` and `locked:true`.

`PUT /api/squads/:id/progress/:taskId` verifies access and saves the result in the same database transaction. Attempting to write a locked lesson returns HTTP 409 with `code:'lesson_locked'` and the current `access` details. Unauthorized and read-only membership checks remain in force.

## Lesson material

Active courses include original teaching material for all eight lessons. The existing stable task identifiers, objectives and completion criteria remain the link between lessons, meeting topics and personal results. Historical saved plans without new fields continue to render.

Each optional `task.lesson` includes an estimated study duration, objectives, short teaching sections, a guided exercise with a revealable sample answer, questions with explanations, recap and supporting references. This material is attached only to the corresponding course/task; it must never be substituted across courses or unrelated historical Python tasks that happen to reuse a task ID.
