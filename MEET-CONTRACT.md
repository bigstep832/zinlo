# Meeting readiness and Google Meet

English, plain bordered UI. The nearest not-ended meeting in a ready/active squad supports readiness. Readiness means ready to join now, including before the scheduled date. Each current member must explicitly confirm. Former members cannot mark ready or initiate a meeting. No arbitrary time delay or fake conference URL.

## API

- Dashboard adds `googleMeet: {configured:boolean, connected:boolean, organizerAvailable:boolean, message?:string}`. `connected` is this guest's Google connection. No token, email, or credentials returned.
- Each private dashboard meeting adds `readiness: {eligible:boolean,selfReady:boolean,readyCount:number,totalCount:number,members:[{id,name,ready}],allReady:boolean,status:'waiting'|'creating'|'ready'|'setup_required'|'connection_required'|'error',error?:string,launchId?:string}`. `meetUrl` is only exposed for upcoming meetings when all active members are ready and a persisted valid URL exists. Past meeting URLs may remain available in history. Separate readiness per meeting; no carryover. Not eligible meetings cannot be marked ready.
- PUT `/api/squads/:squadId/meetings/:meetingId/readiness` `{ready:boolean}` -> updated dashboard. Explicit confirmation is UI-side; server only accepts boolean and changes caller's readiness. Readiness can be withdrawn before launch and persists across refresh/restart.
- POST `/api/squads/:squadId/meetings/:meetingId/launch` `{}` -> updated dashboard. Idempotently attempts creation ONLY when all active members are ready, nearest meeting eligible, and an active member has connected Google. Called by client after last ready/poll; no mutation in GET. Existing persisted meeting URL is reused. No duplicate concurrent creation; recheck membership/readiness after async work. Creation errors honest, manually retryable, no loop of provider requests.
- POST `/api/google-meet/connect` `{squadId}` -> `{authorizationUrl}`; only current active member of unfinished squad. Browser follows URL. Server validates generated auth URL, uses limited Meet-created scope, offline access, state bound to current guest + squad, single use/expiry, PKCE.
- GET `/api/google-meet/callback` handles Google response, requires same guest, validates state/PKCE, persists encrypted refresh credentials, redirects to `/squads/:id?googleMeet=connected|error` with generic errors and no provider token/code in redirect.
- DELETE `/api/google-meet/connection` `{}` disconnects caller; must not expose tokens. Existing generated conference links remain valid.

## Runtime / tests

Use official Google auth library + Meet REST `POST https://meet.googleapis.com/v2/spaces` (scope `https://www.googleapis.com/auth/meetings.space.created`). Request only needed capabilities. Strict meet.google.com URL validation; never return raw provider errors or tokens. Env GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI, GOOGLE_TOKEN_ENCRYPTION_KEY (32-byte base64). Optional GOOGLE_OAUTH_CLIENT_FILE for downloaded Web client JSON, server-side only. `.env`, downloaded credentials and databases must stay ignored. Exact redirect URI needs registering in Google Cloud; temporary tunnel hostname is not stable.

`createApp` accepts optional `meetAdapter` for deterministic tests, function async ({meetingId,squadId,organizerId}) -> {url,spaceName?}; when injected treat integration configured and a current member can act as organizer without OAuth. Production never uses a fake adapter. Other Google service injection details coordinate with backend owner.

Client polls current dashboard every 3–5 seconds while visible, cancels stale requests on unmount, and does not overwrite unsaved task/Meet forms. When readiness ready + allReady + selfReady, navigate same tab with `window.location.assign(meetUrl)`, once per meeting/launchId stored in sessionStorage. Native new windows from polling are not reliable. Keep visible Join Google Meet fallback and do not redirect former members/history, on error, or after user returns from Meet for the same launch. Confirmation explicitly says everyone will be taken to Google Meet when ready. Connect/disconnect button and setup_required explanation must be honest; no fake success when Google is unconfigured.

Maintain original manual Meet endpoint for compatibility; manual saved URLs must obey readiness gating in dashboard UI. Team member joining or leaving changes the required roster immediately. Completed/closed squads are read-only. Add migration without deleting any existing data.
