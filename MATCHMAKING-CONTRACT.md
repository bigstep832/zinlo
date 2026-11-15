# Automatic matchmaking change — 2026-11-15

User explicitly wants: enter profile/course/time → prominent Find my teammates → animated search → automatically assembled real teammates. User further requires every squad name to be course plus numeric ID (Python Foundations #001). Preserve simple white/bordered English interface and all existing dashboard/progress/history behavior.

## API
All same-origin JSON authenticated endpoints, existing errors/validation apply.
- POST `/api/matchmaking` `{}`: start or resume idempotent search. Require complete profile, no manual selection. If already in unfinished squad return matched. Enqueue and attempt real matching transactionally. Return SearchState.
- GET `/api/matchmaking`: current SearchState for page reload/resume, no creation. May expire stale rows, but does not refresh heartbeat or automatically enroll.
- POST `/api/matchmaking/poll` `{}`: renew existing waiting search heartbeat and attempt matching. Never creates a search if idle/expired; return SearchState. Frontend every 5 sec while page visible; poll immediately on visibility return. Only one request at a time.
- DELETE `/api/matchmaking` `{}`: cancel pending search, return idle. If a match completed first, return matched (never silently leave a formed squad).

SearchState `{status:'idle'|'waiting'|'matched'|'expired', squadId?:string, squad?:SquadSummary, waitingSince?:ISO, expiresAt?:ISO, message?:string}`. Matched squad summary includes real members and all 8 dates. No fake names, counts, percentages, pretend AI or bogus completion stages. No private details from other waiting users. `bootstrap` adds `matchmaking: SearchState` for fresh entry routing. Existing currentSquadId still works. Refresh at `/matches` resumes own search. Home auto-routes to `/matches` if waiting, otherwise existing squad behavior.

## Queue policy
- Search expires after 120 seconds without heartbeat; tell users to keep this page open. It survives refresh/restart within this window.
- Starting repeatedly is idempotent and preserves queued time. Rate-limit fresh starts, not regular poll calls (e.g. 30 starts/hour/user). Cancel is idempotent.
- Saving a profile cancels pending search atomically so old preferences cannot be matched. Manual squad creation/join must remove pending search too. Leaving a matched squad does NOT automatically restart search.
- Only users actually searching and not assigned elsewhere may be grouped. Exclude expired rows.
- Match exact track/level and full eight windows for every participant. Start from oldest valid waiting users and earliest two compatible weekly windows in next Monday cohort. Cohort based on anchor user's timezone; concrete dates determine compatibility for everybody.
- Match a group of 3, optionally 4. A fourth compatible searching user may fill a free seat in a ready, future AUTO-created squad; do not auto-join manually created squads. Full checks apply. Check all group members together, not pairwise.
- Entire assignment is one BEGIN IMMEDIATE transaction: capacity <=4, no user in two unfinished squads, queues removed/marked matched together. Competing start/poll/cancel/manual actions cannot duplicate assignments.
- Generate meeting candidates on a 30-minute grid from anchor's actual availability. Cache valid recurring 4-week windows per candidate, intersect candidate windows across profiles, then select two different days; run existing generateSchedule/full-profile checks on final eight dates. Avoid brute-force every possible pair * every user * every minute; bounded SQL pool and cached bitsets/sets are acceptable if documented. Must be able to match a compatible subset when other incompatible users are ahead in queue.

## Naming
Add persisted stable positive integer display_number to squads safely (migration existing rows). Creation gets max+1 inside transaction. All summaries/dashboard use `${track.title} #${String(number).padStart(3,'0')}`; expose `number` if useful. Old UUID remains route key. Remove optional squad-name field from UI; custom incoming names are ignored. Use explicit SQL column lists after migration. Auto-created marker on squads for fourth-seat filling.

## Frontend
- Final profile submit prominent large dark `Find my teammates`, before it explain matching uses track/level and all eight meetings and automatically reserves a place when >=3 compatible people are found.
- After save route /matches and start queue explicitly; direct /matches with idle offers start button (not automatic action on read). Onboarding onSaved calls start and routes regardless of matched result so result is seen.
- Search screen shows profile summary, indeterminate animation, honest message about needing at least three learners, keep-page-open instruction, Cancel search and Edit preferences. No extra fabricated animation delay.
- Handle waiting/error/retry/expired/cancelled distinctly. Poll requests aborted/ignored when unmounted, stale replies must not restart a cancelled search; serialize mutation/poll and use generations as necessary.
- Matched screen names real teammates, course/level, numeric squad name, all eight dates in user's zone, `Open my squad`. No extra Join needed, automatic assignment already happened. Explain place is reserved; dashboard leave remains available.
- Preserve guest/profile/history flows. Respect prefers-reduced-motion and accessible live status; spinner aria-hidden, no flashing.
- Remove old manual group search/creation from primary UI; server endpoints retained for compatibility/tests.
