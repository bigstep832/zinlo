import { OAuth2Client } from 'google-auth-library';
import { randomBytes, createHash, createCipheriv, createDecipheriv } from 'node:crypto';
import fs from 'node:fs';

export const MEET_SCOPE = 'https://www.googleapis.com/auth/meetings.space.created';
const digest = value => createHash('sha256').update(value).digest('hex');
const safeError = () => new Error('Google Meet could not be connected. Please try connecting your Google account again.');

export function googleMeetConfig(env = process.env) {
  let downloaded = {};
  if (env.GOOGLE_OAUTH_CLIENT_FILE) {
    try { downloaded = JSON.parse(fs.readFileSync(env.GOOGLE_OAUTH_CLIENT_FILE, 'utf8')).web || {}; }
    catch { return null; }
  }
  const config = {
    clientId: env.GOOGLE_CLIENT_ID || downloaded.client_id,
    clientSecret: env.GOOGLE_CLIENT_SECRET || downloaded.client_secret,
    redirectUri: env.GOOGLE_REDIRECT_URI,
    encryptionKey: env.GOOGLE_TOKEN_ENCRYPTION_KEY,
  };
  if (!Object.values(config).every(value => typeof value === 'string' && value.length)) return null;
  return config;
}

export function createGoogleMeetService({ db, now = () => new Date(), config = googleMeetConfig(), oauthClientFactory } = {}) {
  db.exec(`CREATE TABLE IF NOT EXISTS google_meet_connections (user_id TEXT PRIMARY KEY REFERENCES users(id), credentials TEXT NOT NULL, version TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS google_meet_oauth_states (state_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), squad_id TEXT NOT NULL REFERENCES squads(id), verifier TEXT NOT NULL, expires_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS google_meet_authorization_versions (user_id TEXT PRIMARY KEY REFERENCES users(id), version TEXT NOT NULL);`);
  let key;
  try {
    key = Buffer.from(config?.encryptionKey || '', 'base64');
    const redirect = new URL(config?.redirectUri);
    if (key.length !== 32 || !config?.clientId || !config?.clientSecret || redirect.username || redirect.password || redirect.hash || redirect.search || redirect.pathname !== '/api/google-meet/callback' || (redirect.protocol !== 'https:' && !(redirect.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(redirect.hostname)))) config = null;
  } catch { config = null; }
  const configured = !!config;
  const q = (sql, ...args) => db.prepare(sql).get(...args);
  const run = (sql, ...args) => db.prepare(sql).run(...args);
  const stamp = () => now().toISOString();
  const client = () => oauthClientFactory ? oauthClientFactory(config) : new OAuth2Client({ clientId: config.clientId, clientSecret: config.clientSecret, redirectUri: config.redirectUri, transporterOptions: { timeout: 20000, retry: false } });
  function encrypt(value, owner) {
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from(owner));
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
    return [iv, cipher.getAuthTag(), encrypted].map(part => part.toString('base64')).join('.');
  }
  function decrypt(value, owner) {
    const [iv, tag, encrypted] = value.split('.').map(part => Buffer.from(part, 'base64'));
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAAD(Buffer.from(owner)); decipher.setAuthTag(tag);
    return JSON.parse(Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8'));
  }
  function connected(userId) {
    if (!configured) return false;
    const row = q('SELECT credentials FROM google_meet_connections WHERE user_id=?', userId);
    if (!row) return false;
    try { return !!decrypt(row.credentials, userId).refresh_token; } catch { return false; }
  }
  async function begin(userId, squadId) {
    if (!configured) throw safeError();
    run('DELETE FROM google_meet_oauth_states WHERE expires_at <= ?', stamp());
    const state = randomBytes(32).toString('hex');
    const verifier = randomBytes(48).toString('base64url');
    run('INSERT OR IGNORE INTO google_meet_authorization_versions VALUES (?,?)', userId, randomBytes(16).toString('hex'));
    const generation = q('SELECT version FROM google_meet_authorization_versions WHERE user_id=?', userId).version;
    const authorizationUrl = client().generateAuthUrl({
      scope: [MEET_SCOPE], access_type: 'offline', prompt: 'consent',
      state, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256',
    });
    const parsed = new URL(authorizationUrl);
    if (parsed.origin !== 'https://accounts.google.com' || parsed.pathname !== '/o/oauth2/v2/auth') throw safeError();
    run('INSERT INTO google_meet_oauth_states VALUES (?,?,?,?,?)', digest(state), userId, squadId, encrypt({ verifier, generation }, userId), new Date(now().getTime() + 600000).toISOString());
    return { authorizationUrl };
  }
  async function callback(url, userId, authorize) {
    const state = url.searchParams.get('state');
    if (!state || !/^[a-f0-9]{64}$/.test(state) || !userId) return { squadId: null, connected: false };
    const row = q('SELECT * FROM google_meet_oauth_states WHERE state_hash=?', digest(state));
    if (!row || row.user_id !== userId) return { squadId: null, connected: false };
    // Consume before network work. A replay, including a concurrent callback, cannot reuse this state.
    run('DELETE FROM google_meet_oauth_states WHERE state_hash=?', digest(state));
    if (row.expires_at <= stamp() || url.searchParams.has('error')) return { squadId: row.squad_id, connected: false };
    try {
      authorize(row.squad_id, userId);
      const code = url.searchParams.get('code');
      if (!code || code.length > 8192) throw safeError();
      const { verifier, generation } = decrypt(row.verifier, userId);
      const { tokens } = await client().getToken({ code, codeVerifier: verifier, redirect_uri: config.redirectUri });
      if (!tokens?.refresh_token || (tokens.scope && !tokens.scope.split(' ').includes(MEET_SCOPE))) throw safeError();
      authorize(row.squad_id, userId);
      if (q('SELECT version FROM google_meet_authorization_versions WHERE user_id=?', userId)?.version !== generation) throw safeError();
      const retained = { refresh_token: tokens.refresh_token, ...(tokens.access_token ? { access_token: tokens.access_token } : {}), ...(tokens.expiry_date ? { expiry_date: tokens.expiry_date } : {}) };
      run('INSERT INTO google_meet_connections VALUES (?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET credentials=excluded.credentials,version=excluded.version,updated_at=excluded.updated_at', userId, encrypt(retained, userId), randomBytes(16).toString('hex'), stamp());
      return { squadId: row.squad_id, connected: true };
    } catch { return { squadId: row.squad_id, connected: false }; }
  }
  async function disconnect(userId) {
    const row = q('SELECT credentials FROM google_meet_connections WHERE user_id=?', userId);
    run('DELETE FROM google_meet_connections WHERE user_id=?', userId);
    run('DELETE FROM google_meet_oauth_states WHERE user_id=?', userId);
    run('INSERT INTO google_meet_authorization_versions VALUES (?,?) ON CONFLICT(user_id) DO UPDATE SET version=excluded.version', userId, randomBytes(16).toString('hex'));
    // Locally disconnect immediately, even if Google's revocation service is unavailable.
    if (configured && row) {
      try { await client().revokeToken(decrypt(row.credentials, userId).refresh_token); } catch { /* no secrets in logs */ }
    }
  }
  async function createMeeting(userId) {
    if (!configured) throw safeError();
    const row = q('SELECT * FROM google_meet_connections WHERE user_id=?', userId);
    if (!row) throw safeError();
    let credentials;
    try { credentials = decrypt(row.credentials, userId); } catch { throw safeError(); }
    const auth = client();
    auth.setCredentials(credentials);
    auth.on('tokens', tokens => {
      credentials = { ...credentials, ...tokens };
      // A disconnect/reconnect during refresh must not resurrect an old credential.
      run('UPDATE google_meet_connections SET credentials=?,updated_at=? WHERE user_id=? AND version=?', encrypt(credentials, userId), stamp(), userId, row.version);
    });
    try {
      const response = await auth.request({ url: 'https://meet.googleapis.com/v2/spaces', method: 'POST', data: { config: { accessType: 'OPEN' } }, timeout: 20000, retry: false });
      return { url: response.data?.meetingUri, spaceName: response.data?.name };
    } catch (error) {
      if (error?.response?.data?.error === 'invalid_grant' || error?.response?.status === 401) run('DELETE FROM google_meet_connections WHERE user_id=? AND version=?', userId, row.version);
      throw new Error('Google Meet could not create this conference. Check the organizer connection and try again.');
    }
  }
  return { configured, connected, begin, callback, disconnect, createMeeting };
}
