# Connect Google Meet

Zinlo creates one real Google Meet conference for a meeting after every current squad member confirms readiness. One current member connects their Google account as the organizer. Other members do not need to connect Google to Zinlo. Google Meet itself controls its sign-in, admission, microphone and camera prompts.

Without Google configuration, readiness still works, but the app explains that automatic conference creation needs setup. It never generates a random meeting code or claims an uncreated conference exists.

## Google Cloud setup

1. Open [Google Cloud Console](https://console.cloud.google.com/). Complete Google's account requirements yourself, including terms and two-step verification if requested.
2. Create a project named **Zinlo**.
3. Enable **Google Meet API** in APIs & Services → Library.
4. Configure Google Auth Platform (OAuth consent). Use **Zinlo** as the application name, choose your support/contact email, and use **External / Testing** for the initial personal-account test.
5. Add the organizer's Google account as a test user. You do not need to add every learner if only one person connects Google as organizer.
6. Create an OAuth client of type **Web application**, named **Zinlo Web**. Register the exact callback of the running server: `https://YOUR-HOST/api/google-meet/callback`. For local development, use `http://localhost:3001/api/google-meet/callback` and open the app on that same hostname.
7. Download the OAuth client JSON into a private local directory outside the repository. Do not paste its contents into chat, GitHub, browser code or a shared document.

The application requests only `https://www.googleapis.com/auth/meetings.space.created`, which covers conferences it creates. It does not request Gmail, Calendar, Drive, recordings or existing Meet history.

## Configure the server

Use the settings documented in `.env.example`. You can provide the downloaded JSON path through `GOOGLE_OAUTH_CLIENT_FILE` instead of entering `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` separately. Set `GOOGLE_REDIRECT_URI` to the exact registered callback.

Set `GOOGLE_TOKEN_ENCRYPTION_KEY` to a private, randomly generated 32-byte base64 value. Keep this key stable across restarts and preserve it when restoring the database; changing it makes saved Google connections unreadable. Store it only in the server's ignored environment configuration or a hosting secret store.

Production HTTPS also needs `APP_ORIGIN` set to the exact public origin and secure cookies enabled. Restart the Node server after changing runtime configuration. Each separately launched server needs its own configuration; updating the local server does not update the shared preview process automatically.

## Connect and use

1. Open the same application URL as the rest of your squad and enter the squad workspace.
2. One member selects **Connect Google to organize** and authorizes the limited Meet permission in Google.
3. Each member selects **I'm ready** under the nearest meeting and confirms they are ready to join now. Confirmation opens a separate waiting tab and keeps the squad workspace open.
4. When all current members are ready, the server creates and saves one conference. The waiting tab automatically opens that same Meet URL. Close the Meet tab after the call to return to the existing squad workspace. If the browser blocks the new tab, use the visible meeting button to open it manually.

Google Meet does not send its **Leave call** event to Zinlo. The site does not claim to detect that action or redirect the Google page after the call. Keeping the workspace open in the original tab provides the return path.

Members can withdraw readiness while waiting. A new member must confirm independently. Each meeting has separate readiness. Provider errors remain visible and can be retried; Google credentials never go to other squad members.

New conferences explicitly use Google's **Open** access mode so participants with the Meet link can enter without requesting admission. This means anyone who receives the link can join, not only Zinlo members. The application still reveals the upcoming meeting link only to current members after everyone confirms readiness. Other Google host and organization policies remain in effect; the app does not change them. See [Google meeting access settings](https://developers.google.com/workspace/meet/api/reference/rest/v2/spaces#SpaceConfig).

## Temporary preview and testing limits

A temporary tunnel hostname changes when the tunnel is recreated. Update the authorized redirect URI and both `GOOGLE_REDIRECT_URI` and `APP_ORIGIN` if that happens. Keep using the same browser and application hostname: guest sessions are tied to a cookie, and the Google callback must return to that session.

The organizer connection persists on the server; it is not requested for every meeting. Google OAuth apps with an External audience and Testing status issue refresh tokens that expire after seven days for this Meet scope. The organizer must reconnect after expiration. Before a general public release, use a stable domain and complete Google's applicable OAuth publication/verification requirements. Moving out of Testing removes this testing-specific seven-day expiry, but users can still revoke authorization and Google can require reconnection for other reasons. See [Google's refresh token expiration rules](https://developers.google.com/identity/protocols/oauth2#expiration).

References: [Create a Meet space](https://developers.google.com/workspace/meet/api/reference/rest/v2/spaces/create), [Meet authorization](https://developers.google.com/workspace/meet/api/guides/authenticate-authorize), [OAuth web-server flow](https://developers.google.com/identity/protocols/oauth2/web-server).
