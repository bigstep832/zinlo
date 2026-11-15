# Weekly learning and lesson access

The study plan starts with four compact week cards. Selecting a week shows its two lessons, saved results and one weekly assignment. Current lessons have Learn, Practice, Quiz and My result sections. Progress is a summary with links back to the relevant week, not a second copy of every result form.

## Release rules

- Week 1 is available when the squad is created, so learners can prepare before meeting.
- Weeks 2–4 open at the first scheduled meeting of that week. The server uses the actual UTC meeting instant; the client displays it in the learner's time zone.
- Each current lesson requires a server-graded quiz pass (3/3) to become done. Earlier lessons must be complete, and moving into a later week also requires the earlier weekly assignments to be submitted. Failed quizzes can be retried with feedback.
- Teammates' completion does not control personal access. Earlier lessons remain available for review and catch-up.
- Existing saved work stays accessible even if an earlier result is reopened. No progress, original plan or meeting link is erased by this change.
- Leaving a squad or having it close does not unlock future lessons. Previous membership remains read-only.
- After the four-week sprint has completed, its full plan is available for read-only review, matching the existing history behavior.

Quiz completion is checked automatically. Practical assignments are individually submitted and self-reviewed against a checklist, then shared for peer discussion; the site does not execute code or grade the quality of practical work. Completion is not certification. Previously completed lessons and whole weeks receive a one-time migration credit without invented quiz scores or submissions. Historical plans that do not match the current curriculum retain their prior completion behavior.

The `/checkout` client page shows the selected course, a proposed $29 price, a demo discount and a $0 total. Continue for free starts matchmaking. It does not collect card information, create a payment, or act as a real payment authorization boundary.

## Server contract

`GET /api/bootstrap` (also returned by session creation) contains course previews only. Each course's `weeks` is an array of `{week,title,lessonCount}`. No lesson instructions, examples, exercises, answers or week preparation are included in the public catalog.

The authorized squad dashboard adds:

```js
learningProgress: {
  done, total,
  nextTaskId,             // first unfinished lesson, including a locked lesson
  nextAvailableTaskId,    // first unfinished lesson this learner may open, or null
  nextReleaseAt,         // next future week-release instant, or null
  assignmentsDone, totalAssignments,
  nextAssignmentWeek    // first blocking assignment when accessible, or null
}
```

Each week has `access: {released,unlocked,releaseAt,reason,message}`. A week can be released by the calendar but still locked because earlier lessons are incomplete. Week preparation is omitted when none of its lessons is accessible.

Each task has:

```js
access: {
  unlocked, canEdit, releaseAt,
  reason: null | 'week_not_released' | 'previous_lesson_incomplete' | 'previous_assignment_incomplete',
  message,
  previousTaskId?,        // first earlier unfinished task
  previousAssignmentWeek?,
  earned?                // saved started/completed work remains readable
}
```

A locked task is serialized as `{id,week,title,access}` only. The server removes teaching material from the response; hiding a browser button is not the access control. Teammate results for a task locked to the viewer retain status/counts but have blank `note` and `url` and `locked:true`.

`PUT /api/squads/:id/progress/:taskId` verifies access and saves the result in the same database transaction. Attempting to write a locked lesson returns HTTP 409 with `code:'lesson_locked'` and the current `access` details. Marking a current lesson done without a passed quiz or migration credit returns 409 `quiz_required`. Unauthorized and read-only membership checks remain in force.

## Quizzes and weekly assignments

An unlocked task's optional `quiz` contains `{version,passScore,questions:[{id,prompt,options:[{id,text}]}],result,credited}`. Initial question payloads contain no answer key or explanation. `result` is the requesting learner's persisted `{taskId,answers,score,total,passed,attempts,updatedAt,feedback}`. After an attempt, feedback includes explanations and correct choices for review. Other learners do not receive this record.

`POST /api/squads/:id/quizzes/:taskId` accepts `{answers:{q1:'0',q2:'2',q3:'1'}}`, with one valid option per actual question. Scores, identity and pass flags are computed on the server. Passing atomically records the quiz and completes the lesson without erasing notes/links. A passed result is not overwritten by repeated submissions. Failed attempts persist across restarts. Starting a quiz also freezes optional AI plan adaptation.

Each current week has an `assignment`. When locked, only `{title,access}` is exposed. When open, it also includes `{version,prompt,deliverables,checklist:[{id,text}],discussion,result,credited}`. It opens after both lessons and earlier work are complete. `access` includes `unlocked`, `canEdit`, `releaseAt`, `reason` and `message`.

`PUT /api/squads/:id/assignments/:week` accepts `{status:'draft'|'submitted',text,url,checkedCriteria:['c1','c2','c3']}`. Drafts are private to the learner. Submission requires at least 40 trimmed text characters and every checklist item; links remain optional and are validated as HTTP(S) without credentials. Text may contain code or dialogue, is rendered as plain text, and is never executed. Already submitted work can be updated as submitted, but cannot be changed back to draft. Text is limited to 12,000 characters.

Submitted assignments appear in `teamProgress[].assignments`. If the viewer has not unlocked that assignment, the entry contains only week, status and `locked:true`; no text or link is disclosed. Departure and sprint completion make quizzes and assignments read-only. All writes recheck membership and progression server-side.

SQLite tables `quiz_results`, `weekly_submissions` and `learning_credits` persist the work. The `required-assessments-v1` migration runs once per database, credits already-done lessons and weeks whose two lessons were done, and does not rewrite saved plans, results or meeting links.

## Lesson material

Active courses include original teaching material for all eight lessons. The existing stable task identifiers, objectives and completion criteria remain the link between lessons, meeting topics and personal results. Historical saved plans without new fields continue to render.

Each optional `task.lesson` includes an estimated study duration, objectives, short teaching sections, a guided exercise with a revealable sample answer, questions with explanations, recap and supporting references. This material is attached only to the corresponding course/task; it must never be substituted across courses or unrelated historical Python tasks that happen to reuse a task ID.

## Recovery transfers

Independent recovery clones the saved curriculum, original creation/start/end dates and exact weekly release instants, then copies personal progress, quizzes, assignment drafts/submissions and existing migration credits. Sequential, assessment and calendar gates still apply. A replacement real squad has its own schedule; only tasks and assignments with identical hydrated content are copied, so a different adapted curriculum does not inherit unrelated credit. The old saved work stays in history. Different active subjects have independent sprint-scoped work.
