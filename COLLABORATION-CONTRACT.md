# Team chat and native video rooms

All routes use the existing HttpOnly guest session, same-origin mutation checks and squad membership checks. User IDs in request bodies never grant access.

## Chat

- `GET /api/squads/:id/chat`: latest 50 messages, oldest first. Optional `before=<message id>` loads earlier history; `after=<message id>` polls newer messages. Only one cursor, a nonnegative safe integer. Response: `{messages, hasMore, canSend}`.
- `POST /api/squads/:id/chat`: `{text, clientId, attachments?: string[]}`. Text is trimmed, at most 2,000 characters; either text or an attachment is required. Up to three distinct attachment IDs must belong to the sender's unsent files in this squad. Claiming attachments and creating the message is atomic. Client ID is 8–80 ASCII letters, digits, underscores or hyphens. Identical retries return the same message; reusing the ID with changed text or attachments returns 409. Maximum 20 new messages per minute per guest.
- `PUT /api/squads/:id/chat/read`: `{lastId}`; cursor must belong to this team and only moves forward.
- Messages contain `id`, `userId`, `name`, `text`, `createdAt`, `attachments: [{id,name,mime,size,url}]`; only their author receives `clientId`. React renders text without HTML interpretation.
- Messages and read cursors persist in SQLite. Current members can read a completed sprint; departed guests and outsiders cannot read chat. Completed/closed squads cannot send messages.
- Dashboard response includes `chatUnread`. Visible chat polls every 2.5 seconds; the dashboard updates its badge every 4 seconds. A message is marked read when delivered to the visible chat, not merely fetched by the dashboard.

### Files and photos

- `POST /api/squads/:id/chat/attachments`: raw file bytes, `Content-Type` and percent-encoded `X-File-Name`. At most 10 MiB per nonempty file, three pending attachments per sender/squad and 40 upload attempts per hour. Authorization is rechecked after upload and image decoding.
- JPEG/PNG/WebP photos are decoded, orientation corrected, resized to at most 2000×2000, stripped of metadata and encoded as WebP. Other files use `application/octet-stream` and attachment disposition, never inline execution.
- `GET .../attachments` restores the caller's unsent uploads; stale unsent uploads over 24 hours old are removed on the next upload. `GET .../attachments/:id` returns private bytes, visible only to the sender before publication and to current members after publication. `?download=1` downloads photos as well.
- `DELETE .../attachments/:id` removes only the sender's unsent upload. Published files stay with message history. All binary responses use private/no-store caching, nosniff and sandbox CSP.
- The composer supports the file picker, photo previews, draft removal, file-only messages, Enter to send and Shift+Enter for a newline. Failed sends retain the draft and the same idempotency key.

## Video

`POST /api/squads/:id/meetings/:meetingId/video/:action` accepts these actions:

| Action | Body | Result |
|---|---|---|
| join | `{}` | `{peerId, iceServers, relayConfigured}` |
| poll | `{peerId, after?, media?: {audio:boolean, video:boolean}}` | room state, roster, targeted signals, cursor |
| ready | `{peerId, ready, after?, media?: {audio:boolean, video:boolean}}` | same state as poll |
| signal | `{peerId, to, signal}` | `{ok:true}` |
| leave | `{peerId}` | `{ok:true}` |

Only current members of an editable squad can join its next eligible meeting. A peer ID is bound to the authenticated guest. A new join replaces that guest’s earlier tab. Joining is limited to 12 per minute. Membership and meeting eligibility are rechecked after an asynchronous relay request.

All current teammates must be present and ready to start. Once started, temporary disconnects do not stop everyone else; rejoining requires a new readiness confirmation. Heartbeats expire after 45 seconds. Signals are transient, target-specific, limited in size and rate, and expire after 60 seconds. No media or SDP is stored on disk. Server restart clears all rooms. Media connections use a mesh capped by the existing four-person squad size.

The client polls every second and negotiates one peer connection with each teammate. It buffers early ICE candidates, closes departed peers, stops media on exit, supports mic/camera toggles, and offers an explicit reconnect control after a failed connection. If autoplay is blocked, the video tile shows a play button. Browser permission is requested only through an explicit media button; listening without devices is allowed.

Both audio/video sections are negotiated even for listen-only joins. A microphone or camera enabled mid-call uses `replaceTrack` on existing senders; enabling one device preserves the other device and its mute state. Camera-off state is shared with teammates on the next heartbeat. Video absolutely fills its tile using `object-fit: cover` without stretching.

Cloudflare credentials are generated server-side with a 7,200-second TTL. The permanent token remains in a private environment file. A failed relay request returns a generic 503 rather than exposing a provider response or silently claiming relay availability. Optional coturn credentials use the standard expiring username/HMAC mechanism.

## Verification

The full suite has 89 passing tests, including attachment privacy before/after publishing, persistence, idempotency, ownership, size/count limits, image conversion, completed/departed-member access; video permissions, media-state updates, readiness, targeted signaling, duplicate tabs, heartbeat expiry and restart behavior.

Browser acceptance used three synthetic guest accounts and six real incoming 320×240 video streams, first directly and then with `iceTransportPolicy: relay`. In the relay run all six connections selected relay candidates, each video rendered more than 100 frames and no errors were reported. Test streams came from canvases; this verifies actual WebRTC video transport without opening the owner’s camera or microphone. It does not replace testing physical devices or every network/browser combination.
