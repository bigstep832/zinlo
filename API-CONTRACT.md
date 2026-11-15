# Shared implementation contract

The primary user flow now uses automatic matchmaking. See [MATCHMAKING-CONTRACT.md](MATCHMAKING-CONTRACT.md) for queue endpoints, the additional `matchmaking` bootstrap field and generated course-plus-number squad names. The manual matching and squad-creation endpoints below remain available for compatibility; they are no longer the primary UI flow. Client-provided squad names are ignored in favor of the generated name.

Meeting readiness and automatic Google Meet creation extend this API: see [MEET-CONTRACT.md](MEET-CONTRACT.md). Upcoming conference URLs are withheld until every current member is ready; dashboard meetings include readiness state and the dashboard includes Google connection availability.

All JSON endpoints are same-origin under `/api`. Errors: `{error: string, code?: string, conflicts?: array}`. Real SQLite persistence with server-derived identity in HttpOnly cookie. Plain English UI, white panels and borders. No fake users in normal data. Node 24 native `node:sqlite`, React + Vite + Luxon. Backend listens 3001; Vite proxies `/api` to it. Production backend serves dist on 3001. All dates ISO UTC strings, availability local IANA zone. Level `beginner` or `basics`. Track IDs `python`, `javascript`, `ai`.

## Data
Profile: `{id,name,trackId,level,timezone,availability:[{day:1..7,start:'19:00',end:'22:00'}]}` (Mon=1). A new guest may have blank profile fields.
Track: `{id,title,description,project,prerequisite, weeks:[{week,title,preparation,tasks:[{id,week,title,description,criteria}]}]}`. Exactly 8 stable tasks; ids `week-1-task-1` etc. Criteria is a string. Two tasks per week. Optional `starterUrl` for JS.
Squad summary: `{id,name,trackId,level,status,memberCount,capacity:4,members:[{id,name}],meetings:[{id,startsAt,endsAt,windowEndsAt,topic,week}],startDate,endDate}`. `endsAt` = 50 minutes; `windowEndsAt` = 60 minutes. States `forming`, `ready`, `active`, `completed`, `closed`.
Dashboard: `{squad: summary, members:[{id,name,isSelf,active}], meetings:[{id,startsAt,endsAt,windowEndsAt,topic,week,meetUrl,organizerName}], plan:{source:'base'|'ai',weeks:[same as track],message?:string}, progress:[{taskId,status:'not_started'|'in_progress'|'done',note,url}], teamProgress:[{userId,name,done,total:8,results:[{taskId,status,note,url}]}], isMember:boolean, canEdit:boolean}`. Departed members can read their history but cannot edit. `teamProgress` visible only to current/former authorized members. Client displays own progress independent of team.

## Endpoints
- GET `/api/bootstrap`: `{user:profile|null,tracks:Track[],currentSquadId:string|null,history:summary[],aiAvailable:boolean}`. No automatic guest creation.
- POST `/api/session`: create guest if needed, return same bootstrap.
- PUT `/api/profile`: full profile input (no id), optional `confirmConflict:true`; validate 2 hour windows on distinct days, half-hour increments, merged adjacent availability; AI needs basics. Conflict with current schedule returns 409 `schedule_conflict` unless confirmed; does not reschedule team. Changing track/level while unfinished membership should be rejected.
- GET `/api/matches`: `{squads:summary[],cohortStart:string}` max 3, real matching on ALL 8 windows, sorted first groups with 2 members then earlier.
- POST `/api/squads/preview`: `{slots:[{day,start},{day,start}]}` -> `{meetings:summary.meetings,startDate,endDate}`. Next Monday cohort, concrete 8 dated meetings.
- POST `/api/squads`: same slots, optional name -> `{squadId}`. Validate preview again and create with self. Stable base plan saved with sprint.
- POST `/api/squads/:id/join`: `{}` -> `{squadId}`. Transactional, idempotent; capacity and availability checks.
- GET `/api/squads/:id`: dashboard (members/history only; no private data to outsiders).
- POST `/api/squads/:id/leave`: `{}` -> `{ok:true}`; preserve history.
- PUT `/api/squads/:id/meetings/:meetingId`: `{url}` -> `{ok:true}`; exact https meet.google.com link or empty to clear, member only.
- PUT `/api/squads/:id/progress/:taskId`: `{status,note,url}` -> `{ok:true}`; own progress only, validated optional http(s) link.
- POST `/api/squads/:id/adapt`: `{}` -> `{source,message}`. Server-configured AI adapter, safe base fallback; never rewrite a plan with started work; only once successful; rate limit. No secrets sent to browser.
- GET `/api/health`: `{ok:true}`.

Backend module exports `createApp({dbPath,now,aiAdapter}={})` -> `{server,db,close}`. `server` is node http.Server (not listening); test uses server.listen(0). `now` injected returns Date. `aiAdapter` optional async function receives base plan + track/level and returns weeks; validate output. `server/index.js` starts default app. Database at env DB_PATH or data/learning-squads.sqlite. Never seed automatically. FRONTEND fetch helper attaches credentials and JSON. Export backend pure scheduling functions if convenient for tests; HTTP integration tests primary.

No payment processing, compulsory registration, chat, code execution or actual attendance tracking. Automatic Meet creation requires the optional Google OAuth setup. Price informational $29; no charges in MVP. Explain guest cookie recovery limit and AI course API costs; mock-friendly JS starter available from public/starter.html. Use native accessible dialog or inline confirmations, clear loading/errors/success.
