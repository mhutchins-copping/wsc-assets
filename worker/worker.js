// WSC IT Asset Management System — Cloudflare Worker API
// Auth: SSO email identity (Cloudflare Access) mapped to internal users, or API key

import { notify, sendMail } from './lib/notify.js';
import { ENROL_SCRIPT } from './lib/enrol-script.js';

export default {
  async fetch(request, env) {
    const response = await dispatch(request, env);
    return applyCors(response, request, env);
  }
};

async function dispatch(request, env) {
  const url = new URL(request.url);

  // CORS preflight
  if (request.method === 'OPTIONS') return corsResponse();

  // Auth identity endpoint — checks SSO email against internal users (no prior auth needed)
  if (url.pathname === '/api/auth/identify' && request.method === 'POST') {
    try { return await authIdentify(request, env); }
    catch (err) { return json({ error: err.message }, 500); }
  }

  // Master key login — fallback when SSO is unavailable (e.g. from home)
  if (url.pathname === '/api/auth/master-key' && request.method === 'POST') {
    try { return await authMasterKey(request, env); }
    catch (err) { return json({ error: err.message }, 500); }
  }

  // Sign-out — revokes a bearer token (safe to call without one)
  if (url.pathname === '/api/auth/sign-out' && request.method === 'POST') {
    try { return await authSignOut(request, env); }
    catch (err) { return json({ error: err.message }, 500); }
  }

  // Public PowerShell enrolment script. Served as text/plain so the
  // IRM+IEX one-liner ("$env:WSC_API_KEY=...; irm .../enrol-script | iex")
  // works from any PowerShell without needing the admin to sign in to the
  // site on each machine. The script itself contains no secrets -- the
  // API key is supplied at invocation time via env var or -ApiKey.
  if (url.pathname === '/enrol-script' && request.method === 'GET') {
    return new Response(ENROL_SCRIPT, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'public, max-age=300'
      }
    });
  }

  // Password-gated enrolment launcher. Serves a public HTML page that
  // gates the API-key-bearing one-liner behind a shared password. Staff
  // receiving a new PC can visit the URL, type the password, and get a
  // one-click copy of the PowerShell command without the admin having to
  // hand out the raw API key (which is a much wider-scoped secret).
  if (url.pathname === '/enrol' && request.method === 'GET') {
    try { return renderEnrolPage(null); }
    catch (err) { return new Response('Server error', { status: 500 }); }
  }
  if (url.pathname === '/enrol/unlock' && request.method === 'POST') {
    try { return await handleEnrolUnlock(request, env); }
    catch (err) { return renderEnrolPage('Something went wrong — try again.'); }
  }

  // Public asset-issue signing page. Token-gated (no CF Access, no session
  // auth) so the recipient can sign from any browser on any network.
  if (url.pathname.startsWith('/sign/')) {
    const token = url.pathname.slice('/sign/'.length);
    if (request.method === 'GET') {
      try { return await renderSigningPage(env, token); }
      catch (err) { return new Response('Server error', { status: 500 }); }
    }
    if (request.method === 'POST') {
      try { return await submitSignature(request, env, token); }
      catch (err) { return json({ error: err.message }, 500); }
    }
    return new Response('Method not allowed', { status: 405 });
  }

  // User management routes (admin only, checked inside each handler)
  if (url.pathname.startsWith('/api/auth/users')) {
    try {
      const res = await routeUserManagement(request, env, url);
      if (res) return res;
    } catch (err) { return json({ error: err.message }, 500); }
    return json({ error: 'Not found' }, 404);
  }

  // Auth check for all other /api/* routes
  if (url.pathname.startsWith('/api/')) {
    const user = await authenticate(request, env);
    if (!user) {
      return json({ error: 'Unauthorized' }, 401);
    }
    request._user = user;
  }

  // Image upload/serve via R2
  if (url.pathname.startsWith('/images/')) {
    return handleImages(request, env, url);
  }

  // Route matching
  try {
    const res = await route(request, env, url);
    if (res) return res;
  } catch (err) {
    console.error(err);
    return json({ error: err.message || 'Internal server error' }, 500);
  }

  return json({ error: 'Not found' }, 404);
}

// Rewrite the permissive CORS headers set by individual handlers to reflect a
// single configured origin (env.CORS_ORIGIN). Only echoes the request Origin if
// it matches. Credentials are allowed so the CF Access cookie can be sent.
function applyCors(response, request, env) {
  const allowedOrigin = env.CORS_ORIGIN || '';
  const origin = request.headers.get('Origin') || '';
  const headers = new Headers(response.headers);

  if (allowedOrigin && origin === allowedOrigin) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Allow-Credentials', 'true');
    headers.append('Vary', 'Origin');
  } else if (!allowedOrigin) {
    // No configured origin — keep wildcard for local/dev setups.
    headers.set('Access-Control-Allow-Origin', '*');
    headers.delete('Access-Control-Allow-Credentials');
  } else {
    // Origin doesn't match the allow-list — strip CORS exposure entirely so the
    // browser rejects the response.
    headers.delete('Access-Control-Allow-Origin');
    headers.delete('Access-Control-Allow-Credentials');
    headers.append('Vary', 'Origin');
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

// ─── Auth ──────────────────────────────────────────────
// Four auth paths (checked in order):
// 1. SSO email — injected by Cloudflare Access header (hostname behind Access).
// 2. CF_Authorization cookie JWT — verified against the team's JWKS. Same
//    security as (1) but works when the worker's hostname isn't behind Access
//    directly. Relies on the cookie riding along via credentials:'include'.
// 3. Session bearer token — issued in exchange for the master key.
// 4. Raw API key / master key — scripts / external access / break-glass.

const SESSION_TTL_HOURS = 8;

// In-memory JWKS cache. Keys rotate rarely; an hour's cache is plenty.
let _jwksCache = null;
let _jwksExpires = 0;

async function getCfAccessJwks(env) {
  const team = env.CF_ACCESS_TEAM_DOMAIN || 'itwsc';
  if (_jwksCache && Date.now() < _jwksExpires) return _jwksCache;
  const res = await fetch(`https://${team}.cloudflareaccess.com/cdn-cgi/access/certs`);
  if (!res.ok) return null;
  const data = await res.json();
  _jwksCache = data.keys || [];
  _jwksExpires = Date.now() + 60 * 60 * 1000;
  return _jwksCache;
}

function b64urlDecodeJSON(segment) {
  const padded = segment.replace(/-/g, '+').replace(/_/g, '/');
  try { return JSON.parse(atob(padded)); } catch (e) { return null; }
}

function b64urlToUint8(segment) {
  const padded = segment.replace(/-/g, '+').replace(/_/g, '/');
  const str = atob(padded);
  const arr = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) arr[i] = str.charCodeAt(i);
  return arr;
}

// Verify a Cloudflare Access CF_Authorization cookie JWT. Returns the email
// claim on success, null on any validation failure.
async function verifyCfAccessJwt(jwt, env) {
  if (!jwt || typeof jwt !== 'string') return null;
  const parts = jwt.split('.');
  if (parts.length !== 3) return null;

  const [headerB64, payloadB64, sigB64] = parts;
  const header = b64urlDecodeJSON(headerB64);
  const payload = b64urlDecodeJSON(payloadB64);
  if (!header || !payload || !header.kid) return null;

  // Expiry check (seconds since epoch)
  const nowSec = Math.floor(Date.now() / 1000);
  if (!payload.exp || payload.exp < nowSec) return null;
  if (!payload.email) return null;

  // Issuer sanity check: must be our CF Access team. Prevents a valid JWT
  // from someone else's tenant from being accepted.
  const team = env.CF_ACCESS_TEAM_DOMAIN || 'itwsc';
  const expectedIssuer = `https://${team}.cloudflareaccess.com`;
  if (payload.iss !== expectedIssuer) return null;

  // Fetch/cache JWKS and find the matching key
  const keys = await getCfAccessJwks(env);
  if (!keys) return null;
  const key = keys.find(k => k.kid === header.kid);
  if (!key) return null;

  try {
    const cryptoKey = await crypto.subtle.importKey(
      'jwk',
      key,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify']
    );
    const signature = b64urlToUint8(sigB64);
    const signedData = new TextEncoder().encode(headerB64 + '.' + payloadB64);
    const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', cryptoKey, signature, signedData);
    if (!valid) return null;
  } catch (e) {
    console.error('verifyCfAccessJwt:', e && e.message);
    return null;
  }

  return String(payload.email).toLowerCase().trim();
}

// Pulls the SSO email out of a request using whatever identity signal is
// available. Returns null if nothing valid is found.
async function resolveSsoEmail(request, env) {
  // Preferred: header injected by Cloudflare Access when the worker's own
  // hostname is behind Access. Fastest — no crypto required.
  const header = request.headers.get('Cf-Access-Authenticated-User-Email');
  if (header) return header.toLowerCase().trim();

  // Fallback: verify the CF_Authorization cookie ourselves. Works for the
  // case where the worker hostname isn't fronted by Access but the browser
  // still carries the cookie from the protected frontend domain.
  const cookie = request.headers.get('Cookie') || '';
  const m = cookie.match(/(?:^|;\s*)CF_Authorization=([^;]+)/);
  if (m) {
    const email = await verifyCfAccessJwt(m[1], env);
    if (email) return email;
  }
  return null;
}

async function authenticate(request, env) {
  // 1 + 2. SSO identity from either the CF Access header or the CF cookie JWT.
  const ssoEmail = await resolveSsoEmail(request, env);
  if (ssoEmail) {
    try {
      const user = await env.DB.prepare(
        'SELECT id, email, display_name, role FROM users WHERE email = ? AND active = 1'
      ).bind(ssoEmail).first();
      if (user) return user;
    } catch (e) { /* users table may not exist yet */ }
  }

  // 2. Session bearer token (preferred over raw master key). Cheap lookup and
  // expiry is enforced server-side, so XSS harvesting a token from browser
  // storage only yields short-lived admin access, not the durable master key.
  const auth = request.headers.get('Authorization') || '';
  if (auth.startsWith('Bearer ')) {
    const token = auth.slice(7).trim();
    if (token) {
      try {
        const session = await env.DB.prepare(
          `SELECT s.user_id, u.id, u.email, u.display_name, u.role
             FROM sessions s
             JOIN users u ON u.id = s.user_id AND u.active = 1
            WHERE s.token = ? AND s.expires_at > ?`
        ).bind(token, now()).first();
        if (session) {
          return { id: session.id, email: session.email, display_name: session.display_name, role: session.role };
        }
      } catch (e) { /* sessions table may not exist yet */ }
    }
  }

  // 3. Raw API key or master key on X-Api-Key. Retained for:
  //    - scripted / external callers using the long-lived API_KEY
  //    - transitional break-glass until a session token is obtained
  const key = request.headers.get('X-Api-Key');
  if (key) {
    if (env.API_KEY && key === env.API_KEY) {
      return { email: 'api', display_name: 'API', role: 'admin' };
    }
    if (env.MASTER_KEY && key === env.MASTER_KEY) {
      try {
        const admin = await env.DB.prepare(
          "SELECT id, email, display_name, role FROM users WHERE role = 'admin' AND active = 1 ORDER BY created_at ASC LIMIT 1"
        ).first();
        if (admin) return admin;
      } catch (e) { /* users table may not exist */ }
      return { email: 'master', display_name: 'Admin (Master Key)', role: 'admin' };
    }
  }

  return null;
}

// ─── Auth Identity (SSO → internal user lookup) ──
// Uses whichever of the two trusted signals is present (CF Access header or
// CF_Authorization cookie JWT). Any body-provided email is ignored — letting
// the client tell the server who they are is exactly the kind of trust
// boundary we don't need.
async function authIdentify(request, env) {
  const ssoEmail = await resolveSsoEmail(request, env);

  if (!ssoEmail) {
    return json({
      authorized: false,
      error: 'No SSO identity on this request. Access the site through Cloudflare Access.'
    }, 401);
  }

  try {
    const user = await env.DB.prepare(
      'SELECT id, email, display_name, role FROM users WHERE email = ? AND active = 1'
    ).bind(ssoEmail).first();

    if (!user) {
      return json({ authorized: false, error: 'No access. Contact your IT administrator.' }, 403);
    }

    await env.DB.prepare('UPDATE users SET last_login = ? WHERE id = ?').bind(now(), user.id).run();

    return json({
      authorized: true,
      user: { id: user.id, email: user.email, display_name: user.display_name, role: user.role }
    });
  } catch (e) {
    return json({ authorized: false, error: 'Database needs migration. Run the users migration in D1 Console.', needs_migration: true }, 500);
  }
}

// Issues a short-lived bearer token for a user. Caller is responsible for
// having already verified the user's identity (e.g. via master-key check).
async function issueSessionToken(env, userId, source, ip) {
  // 32-byte random token → base64url (~43 chars). Cryptographically strong.
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let b64 = btoa(String.fromCharCode.apply(null, bytes));
  const token = b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  const expiresMs = Date.now() + SESSION_TTL_HOURS * 60 * 60 * 1000;
  const expiresAt = new Date(expiresMs)
    .toLocaleString('sv-SE', { timeZone: 'Australia/Sydney' })
    .replace('T', ' ')
    .slice(0, 19);

  await env.DB.prepare(
    'INSERT INTO sessions (token, user_id, source, ip_address, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(token, userId, source, ip || null, expiresAt, now()).run();

  // Opportunistic cleanup of expired rows. Not critical; cheap in a small DB.
  try {
    await env.DB.prepare('DELETE FROM sessions WHERE expires_at <= ?').bind(now()).run();
  } catch (e) { /* best effort */ }

  return { token, expires_at: expiresAt };
}

async function revokeSessionToken(env, token) {
  if (!token) return;
  try {
    await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
  } catch (e) { /* best effort */ }
}

// ─── Master Key Auth (fallback for non-SSO access) ────
// Rate-limited, audited break-glass admin access

const MASTER_KEY_MAX_ATTEMPTS = 5;
const MASTER_KEY_LOCKOUT_MINUTES = 15;

async function authMasterKey(request, env) {
  const data = await body(request);
  const key = (data.key || '').trim();
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';

  if (!key) return json({ error: 'Master key required' }, 400);

  // Check rate limit — block after too many failed attempts from same IP.
  // Cutoff is computed in JS and bound; never interpolate values into SQL,
  // even trusted ones, to keep one consistent pattern everywhere.
  try {
    const cutoffMs = Date.now() - MASTER_KEY_LOCKOUT_MINUTES * 60 * 1000;
    const cutoff = new Date(cutoffMs)
      .toLocaleString('sv-SE', { timeZone: 'Australia/Sydney' })
      .replace('T', ' ')
      .slice(0, 19);
    const recent = await env.DB.prepare(
      `SELECT COUNT(*) as attempts FROM activity_log
       WHERE action = 'master_key_failed' AND ip_address = ?
       AND created_at > ?`
    ).bind(ip, cutoff).first();

    if (recent && recent.attempts >= MASTER_KEY_MAX_ATTEMPTS) {
      await logActivity(env, {
        action: 'master_key_blocked',
        details: `Rate limited: ${recent.attempts} failed attempts`,
        ip_address: ip
      });
      return json({ authorized: false, error: 'Too many failed attempts. Try again later.' }, 429);
    }
  } catch (e) { /* activity_log may not exist yet, proceed */ }

  // Validate key
  if (!env.MASTER_KEY || key !== env.MASTER_KEY) {
    // Log failed attempt with IP
    try {
      await logActivity(env, {
        action: 'master_key_failed',
        details: 'Failed master key attempt',
        ip_address: ip
      });
    } catch (e) { /* best effort */ }
    return json({ authorized: false, error: 'Invalid master key' }, 401);
  }

  // Master key grants admin access — look up the admin user
  try {
    const admin = await env.DB.prepare(
      "SELECT id, email, display_name, role FROM users WHERE role = 'admin' AND active = 1 ORDER BY created_at ASC LIMIT 1"
    ).first();

    if (!admin) {
      return json({ authorized: false, error: 'No admin user found in database' }, 500);
    }

    // Update last login
    await env.DB.prepare("UPDATE users SET last_login = ? WHERE id = ?").bind(now(), admin.id).run();

    // Log successful master key login with IP
    await logActivity(env, {
      action: 'master_key_login',
      details: `Admin login via master key from ${ip}`,
      performed_by: admin.display_name
    });

    // Send notification
    try {
      await notify(env, 'master_key_login', {
        actor: admin.display_name,
        ip
      });
    } catch (e) { console.error('notify error:', e); }

    // Issue a short-lived bearer token so the client never has to hold the
    // raw master key past this single exchange.
    let session = null;
    try {
      session = await issueSessionToken(env, admin.id, 'master_key', ip);
    } catch (e) {
      // Session table may not exist yet — fall back to the pre-token response
      // so the caller can still authenticate with the raw key header.
      console.error('issueSessionToken failed:', e && e.message);
    }

    return json({
      authorized: true,
      user: { id: admin.id, email: admin.email, display_name: admin.display_name, role: admin.role },
      token: session ? session.token : null,
      token_expires_at: session ? session.expires_at : null
    });
  } catch (e) {
    return json({ authorized: false, error: 'Database error: ' + e.message }, 500);
  }
}

// Sign-out endpoint — revokes a bearer token. Safe to call without a token
// (returns ok); best-effort cleanup.
async function authSignOut(request, env) {
  const auth = request.headers.get('Authorization') || '';
  if (auth.startsWith('Bearer ')) {
    await revokeSessionToken(env, auth.slice(7).trim());
  }
  return json({ ok: true });
}

// ─── User Management (admin only) ─────────────────────

async function routeUserManagement(request, env, url) {
  const method = request.method;
  const path = url.pathname;

  // All user management requires admin
  const user = await authenticate(request, env);
  if (!user || user.role !== 'admin') return json({ error: 'Admin access required' }, 403);

  if (path === '/api/auth/users' && method === 'GET') return listUsers(env);
  if (path === '/api/auth/users' && method === 'POST') return createUser(request, env);
  if (path.match(/^\/api\/auth\/users\/([^/]+)$/) && method === 'PUT') {
    return updateUser(request, env, path.match(/^\/api\/auth\/users\/([^/]+)$/)[1]);
  }
  if (path.match(/^\/api\/auth\/users\/([^/]+)$/) && method === 'DELETE') {
    return deleteUser(request, env, path.match(/^\/api\/auth\/users\/([^/]+)$/)[1], user);
  }
  return null;
}

async function listUsers(env) {
  const result = await env.DB.prepare(
    'SELECT id, email, display_name, role, active, created_at, last_login FROM users ORDER BY created_at'
  ).all();
  return json({ data: result.results });
}

async function createUser(request, env) {
  const data = await body(request);
  if (!data.email) return json({ error: 'Email is required' }, 400);

  const existing = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(data.email.toLowerCase()).first();
  if (existing) return json({ error: 'User with this email already exists' }, 400);

  const userId = id();
  await env.DB.prepare(`
    INSERT INTO users (id, email, display_name, role, active)
    VALUES (?, ?, ?, ?, 1)
  `).bind(userId, data.email.toLowerCase(), data.display_name || data.email, data.role || 'user').run();

  const currentUser = request._user;
  const actor = currentUser ? (currentUser.display_name || currentUser.email) : null;

  // Send notification
  try {
    await notify(env, 'user_created', {
      user: { id: userId, email: data.email.toLowerCase(), display_name: data.display_name || data.email, role: data.role || 'user' },
      actor,
      actorEmail: currentUser?.email
    });
  } catch (e) { console.error('notify error:', e); }

  return json({ id: userId }, 201);
}

async function updateUser(request, env, userId) {
  const existing = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(userId).first();
  if (!existing) return json({ error: 'User not found' }, 404);

  const data = await body(request);
  await env.DB.prepare(`
    UPDATE users SET display_name = ?, email = ?, role = ?, active = ? WHERE id = ?
  `).bind(
    data.display_name !== undefined ? data.display_name : existing.display_name,
    data.email !== undefined ? data.email.toLowerCase() : existing.email,
    data.role !== undefined ? data.role : existing.role,
    data.active !== undefined ? data.active : existing.active,
    userId
  ).run();

  return json({ ok: true });
}

async function deleteUser(request, env, userId, currentUser) {
  if (currentUser.id === userId) return json({ error: 'Cannot delete your own account' }, 400);
  await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(userId).run();
  return json({ ok: true });
}

// ─── CORS ──────────────────────────────────────────────

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Api-Key, Authorization',
  'Access-Control-Max-Age': '86400',
};

function corsResponse() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

// ─── Router ────────────────────────────────────────────

async function route(request, env, url) {
  const method = request.method;
  const path = url.pathname;

  // Shorthand: every route decides what permission it needs, returns the 403
  // from requirePerm when denied, otherwise dispatches to the handler.
  const deny = (perm) => requirePerm(request, perm);

  // ── Assets ──
  if (path === '/api/assets' && method === 'GET') return deny('assets.read') || listAssets(request, env, url);
  if (path === '/api/assets' && method === 'POST') return deny('assets.write') || createAsset(request, env);

  // Idempotent hardware enrolment: looks up by serial, updates or creates.
  // Called by the PowerShell enrolment script running on each endpoint; the
  // shared API_KEY authenticates as role:admin, so the same permission gate
  // as the manual AI-extract path applies.
  if (path === '/api/assets/enrol' && method === 'POST') {
    return deny('enrol.device') || enrolDevice(request, env);
  }

  if (path.match(/^\/api\/assets\/next-tag\/(.+)$/) && method === 'GET') {
    return deny('assets.read') || nextTag(env, path.match(/^\/api\/assets\/next-tag\/(.+)$/)[1]);
  }
  if (path.match(/^\/api\/assets\/tag\/(.+)$/) && method === 'GET') {
    return deny('assets.read') || getAssetByTag(env, decodeURIComponent(path.match(/^\/api\/assets\/tag\/(.+)$/)[1]));
  }
  if (path.match(/^\/api\/assets\/serial\/(.+)$/) && method === 'GET') {
    return deny('assets.read') || getAssetBySerial(env, decodeURIComponent(path.match(/^\/api\/assets\/serial\/(.+)$/)[1]));
  }
  if (path.match(/^\/api\/assets\/([^/]+)\/checkout$/) && method === 'POST') {
    return deny('assets.write') || checkoutAsset(request, env, path.match(/^\/api\/assets\/([^/]+)\/checkout$/)[1]);
  }
  if (path.match(/^\/api\/assets\/([^/]+)\/checkin$/) && method === 'POST') {
    return deny('assets.write') || checkinAsset(request, env, path.match(/^\/api\/assets\/([^/]+)\/checkin$/)[1]);
  }
  if (path.match(/^\/api\/assets\/([^/]+)\/maintenance$/) && method === 'POST') {
    return deny('assets.maintenance') || addMaintenance(request, env, path.match(/^\/api\/assets\/([^/]+)\/maintenance$/)[1]);
  }
  if (path.match(/^\/api\/assets\/([^/]+)\/issue$/) && method === 'POST') {
    return deny('assets.write') || issueAsset(request, env, path.match(/^\/api\/assets\/([^/]+)\/issue$/)[1]);
  }
  if (path.match(/^\/api\/assets\/([^/]+)$/) && method === 'GET') {
    return deny('assets.read') || getAsset(env, path.match(/^\/api\/assets\/([^/]+)$/)[1]);
  }
  if (path.match(/^\/api\/assets\/([^/]+)$/) && method === 'PUT') {
    return deny('assets.write') || updateAsset(request, env, path.match(/^\/api\/assets\/([^/]+)$/)[1]);
  }
  if (path.match(/^\/api\/assets\/([^/]+)$/) && method === 'DELETE') {
    // Soft-delete (mark disposed) is part of normal lifecycle — user role allowed.
    return deny('assets.write') || deleteAsset(request, env, path.match(/^\/api\/assets\/([^/]+)$/)[1]);
  }
  if (path.match(/^\/api\/assets\/([^/]+)\/purge$/) && method === 'DELETE') {
    // Hard delete with cascading removals — admin only.
    if (!isAdmin(request)) return json({ error: 'Admin access required' }, 403);
    return purgeAsset(request, env, path.match(/^\/api\/assets\/([^/]+)\/purge$/)[1]);
  }

  // AI-powered label extraction — admin/user; viewers don't get to enrol.
  if (path === '/api/assets/extract-from-image' && method === 'POST') {
    return deny('enrol.device') || extractFromImage(request, env);
  }

  // ── Asset Issues (signing receipts) ──
  if (path === '/api/issues' && method === 'GET') return deny('assets.read') || listIssues(request, env, url);
  if (path.match(/^\/api\/issues\/([^/]+)$/) && method === 'GET') {
    return deny('assets.read') || getIssue(env, path.match(/^\/api\/issues\/([^/]+)$/)[1]);
  }
  if (path.match(/^\/api\/issues\/([^/]+)\/resend$/) && method === 'POST') {
    return deny('assets.write') || resendIssue(request, env, path.match(/^\/api\/issues\/([^/]+)\/resend$/)[1]);
  }
  if (path.match(/^\/api\/issues\/([^/]+)\/cancel$/) && method === 'POST') {
    return deny('assets.write') || cancelIssue(request, env, path.match(/^\/api\/issues\/([^/]+)\/cancel$/)[1]);
  }

  // ── People ──
  if (path === '/api/people' && method === 'GET') return deny('people.read') || listPeople(request, env, url);
  if (path === '/api/people' && method === 'POST') return deny('people.write') || createPerson(request, env);
  if (path.match(/^\/api\/people\/([^/]+)$/) && method === 'GET') {
    return deny('people.read') || getPerson(env, path.match(/^\/api\/people\/([^/]+)$/)[1]);
  }
  if (path.match(/^\/api\/people\/([^/]+)$/) && method === 'PUT') {
    return deny('people.write') || updatePerson(request, env, path.match(/^\/api\/people\/([^/]+)$/)[1]);
  }
  if (path.match(/^\/api\/people\/([^/]+)$/) && method === 'DELETE') {
    return deny('people.write') || deletePerson(request, env, path.match(/^\/api\/people\/([^/]+)$/)[1]);
  }

  // ── Locations (reference data — admin writes only) ──
  if (path === '/api/locations' && method === 'GET') return deny('locations.read') || listLocations(env);
  if (path === '/api/locations' && method === 'POST') {
    if (!isAdmin(request)) return json({ error: 'Admin access required' }, 403);
    return createLocation(request, env);
  }
  if (path.match(/^\/api\/locations\/([^/]+)$/) && method === 'GET') {
    return deny('locations.read') || getLocation(env, path.match(/^\/api\/locations\/([^/]+)$/)[1]);
  }
  if (path.match(/^\/api\/locations\/([^/]+)$/) && method === 'PUT') {
    if (!isAdmin(request)) return json({ error: 'Admin access required' }, 403);
    return updateLocation(request, env, path.match(/^\/api\/locations\/([^/]+)$/)[1]);
  }
  if (path.match(/^\/api\/locations\/([^/]+)$/) && method === 'DELETE') {
    if (!isAdmin(request)) return json({ error: 'Admin access required' }, 403);
    return deleteLocation(request, env, path.match(/^\/api\/locations\/([^/]+)$/)[1]);
  }

  // ── Categories (reference data — admin writes only) ──
  if (path === '/api/categories' && method === 'GET') return deny('categories.read') || listCategories(env);
  if (path === '/api/categories' && method === 'POST') {
    if (!isAdmin(request)) return json({ error: 'Admin access required' }, 403);
    return createCategory(request, env);
  }
  if (path.match(/^\/api\/categories\/([^/]+)$/) && method === 'PUT') {
    if (!isAdmin(request)) return json({ error: 'Admin access required' }, 403);
    return updateCategory(request, env, path.match(/^\/api\/categories\/([^/]+)$/)[1]);
  }
  if (path.match(/^\/api\/categories\/([^/]+)$/) && method === 'DELETE') {
    if (!isAdmin(request)) return json({ error: 'Admin access required' }, 403);
    return deleteCategory(request, env, path.match(/^\/api\/categories\/([^/]+)$/)[1]);
  }

  // ── Activity log ──
  if (path === '/api/activity' && method === 'GET') return deny('reports.view') || listActivity(env, url);

  // ── Audits ──
  if (path === '/api/audits' && method === 'GET') return deny('audits.read') || listAudits(env);
  if (path === '/api/audits' && method === 'POST') return deny('audits.write') || startAudit(request, env);
  if (path.match(/^\/api\/audits\/([^/]+)\/scan$/) && method === 'POST') {
    return deny('audits.write') || scanAuditItem(request, env, path.match(/^\/api\/audits\/([^/]+)\/scan$/)[1]);
  }
  if (path.match(/^\/api\/audits\/([^/]+)\/complete$/) && method === 'POST') {
    return deny('audits.write') || completeAudit(env, path.match(/^\/api\/audits\/([^/]+)\/complete$/)[1]);
  }
  if (path.match(/^\/api\/audits\/([^/]+)$/) && method === 'GET') {
    return deny('audits.read') || getAudit(env, path.match(/^\/api\/audits\/([^/]+)$/)[1]);
  }
  if (path.match(/^\/api\/audits\/([^/]+)$/) && method === 'DELETE') {
    if (!isAdmin(request)) return json({ error: 'Admin access required' }, 403);
    return deleteAudit(env, path.match(/^\/api\/audits\/([^/]+)$/)[1]);
  }

  // ── Stats & Reports ──
  if (path === '/api/stats' && method === 'GET') return deny('reports.view') || getStats(env);
  if (path === '/api/reports' && method === 'GET') return deny('reports.view') || getReports(env);

  // ── Import / Export / Sync — admin only ──
  if (path === '/api/import/csv' && method === 'POST') {
    if (!isAdmin(request)) return json({ error: 'Admin access required' }, 403);
    return importCSV(request, env);
  }
  if (path === '/api/export/csv' && method === 'GET') {
    if (!isAdmin(request)) return json({ error: 'Admin access required' }, 403);
    return exportCSV(env, url);
  }
  if (path === '/api/people/sync-entra' && method === 'POST') {
    if (!isAdmin(request)) return json({ error: 'Admin access required' }, 403);
    return syncEntraUsers(request, env);
  }
  if (path === '/api/settings/entra-status' && method === 'GET') {
    if (!isAdmin(request)) return json({ error: 'Admin access required' }, 403);
    return json({
      configured: !!(env.ENTRA_TENANT_ID && env.ENTRA_CLIENT_ID && env.ENTRA_CLIENT_SECRET)
    });
  }

  return null;
}

// ─── Permissions ───────────────────────────────────────
// Central authorization table. Every mutating route checks hasPermission()
// rather than ad-hoc isAdmin() checks, so the full picture of who-can-do-what
// lives in one place.
//
// Roles:
//   viewer — read-only across the app
//   user   — day-to-day operators; can create/edit assets, manage people,
//            run audits, log maintenance. Cannot manage reference data
//            (categories/locations), cannot run bulk/destructive ops,
//            cannot manage users.
//   admin  — full access. Wildcard '*' short-circuits the check.
//
// Docs mirror: see docs/OPERATIONS.md § Roles for the customer-facing view.

const VIEWER_PERMS = [
  'assets.read', 'people.read', 'categories.read', 'locations.read',
  'audits.read', 'reports.view', 'settings.read', 'users.read_self'
];

const USER_PERMS = VIEWER_PERMS.concat([
  'assets.write',       // create + update + checkout + checkin
  'assets.maintenance', // log maintenance entries
  'people.write',       // create + update + deactivate (soft)
  'audits.write',       // start + scan + complete
  'enrol.device'        // clipboard/API enrolment of new hardware
]);

const ROLE_PERMISSIONS = {
  viewer: new Set(VIEWER_PERMS),
  user:   new Set(USER_PERMS),
  admin:  new Set(['*'])
};

function hasPermission(user, perm) {
  if (!user) return false;
  const perms = ROLE_PERMISSIONS[user.role];
  if (!perms) return false;
  return perms.has('*') || perms.has(perm);
}

// Back-compat shim — a handful of routes still use isAdmin() and it's a
// reasonable shortcut for the admin-only tier.
function isAdmin(request) {
  return !!(request._user && request._user.role === 'admin');
}

// Permission guard used at the top of each mutating handler. Returns a 403
// JSON response if denied, or null if allowed. Caller pattern:
//     const denied = requirePerm(request, 'assets.write');
//     if (denied) return denied;
function requirePerm(request, perm) {
  if (hasPermission(request && request._user, perm)) return null;
  return json({ error: 'Forbidden', required: perm }, 403);
}

function id() {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function now() {
  // Australian Eastern Time (AEST/AEDT — NSW observes DST)
  return new Date().toLocaleString('sv-SE', { timeZone: 'Australia/Sydney' }).replace('T', ' ').slice(0, 19);
}

async function body(request) {
  return request.json();
}

async function logActivity(env, { asset_id, action, details, performed_by, person_id, location_id, ip_address }) {
  await env.DB.prepare(
    `INSERT INTO activity_log (id, ip_address, asset_id, action, details, performed_by, person_id, location_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id(), ip_address || null, asset_id || null, action, details || null, performed_by || null, person_id || null, location_id || null, now()).run();
}

// ─── Assets ────────────────────────────────────────────

async function listAssets(request, env, url) {
  const params = url.searchParams;
  let where = [];
  let binds = [];

  if (params.get('status')) {
    where.push('a.status = ?');
    binds.push(params.get('status'));
  }
  if (params.get('category')) {
    where.push('a.category_id = ?');
    binds.push(params.get('category'));
  }
  if (params.get('location')) {
    where.push('a.location_id = ?');
    binds.push(params.get('location'));
  }
  if (params.get('manufacturer')) {
    where.push('LOWER(a.manufacturer) = LOWER(?)');
    binds.push(params.get('manufacturer'));
  }
  if (params.get('search')) {
    const s = '%' + params.get('search') + '%';
    where.push('(a.name LIKE ? OR a.asset_tag LIKE ? OR a.serial_number LIKE ? OR p.name LIKE ?)');
    binds.push(s, s, s, s);
  }

  // Exclude disposed by default unless explicitly requested
  if (!params.get('status') && !params.get('include_disposed')) {
    where.push("a.status != 'disposed'");
  }

  const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : '';

  // Sorting
  const sortCol = params.get('sort') || 'a.updated_at';
  const sortDir = params.get('dir') === 'asc' ? 'ASC' : 'DESC';
  const allowedSorts = ['a.asset_tag', 'a.name', 'a.status', 'a.manufacturer', 'a.purchase_date', 'a.purchase_cost', 'a.updated_at', 'a.created_at', 'p.name', 'l.name', 'c.name'];
  const safeSort = allowedSorts.includes(sortCol) ? sortCol : 'a.updated_at';

  // Pagination
  const page = Math.max(1, parseInt(params.get('page')) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(params.get('limit')) || 50));
  const offset = (page - 1) * limit;

  const countQuery = `SELECT COUNT(*) as total FROM assets a LEFT JOIN people p ON a.assigned_to = p.id ${whereClause}`;
  const countResult = await env.DB.prepare(countQuery).bind(...binds).first();

  const query = `
    SELECT a.*,
           p.name as assigned_to_name,
           l.name as location_name,
           c.name as category_name,
           c.prefix as category_prefix
    FROM assets a
    LEFT JOIN people p ON a.assigned_to = p.id
    LEFT JOIN locations l ON a.location_id = l.id
    LEFT JOIN categories c ON a.category_id = c.id
    ${whereClause}
    ORDER BY ${safeSort} ${sortDir}
    LIMIT ? OFFSET ?
  `;

  const result = await env.DB.prepare(query).bind(...binds, limit, offset).all();

  return json({
    data: result.results,
    total: countResult.total,
    page,
    limit,
    pages: Math.ceil(countResult.total / limit)
  });
}

async function getAsset(env, assetId) {
  const asset = await env.DB.prepare(`
    SELECT a.*,
           p.name as assigned_to_name, p.email as assigned_to_email, p.department as assigned_to_department,
           l.name as location_name,
           c.name as category_name, c.prefix as category_prefix
    FROM assets a
    LEFT JOIN people p ON a.assigned_to = p.id
    LEFT JOIN locations l ON a.location_id = l.id
    LEFT JOIN categories c ON a.category_id = c.id
    WHERE a.id = ?
  `).bind(assetId).first();

  if (!asset) return json({ error: 'Asset not found' }, 404);

  // Get activity history
  const history = await env.DB.prepare(`
    SELECT al.*, p.name as person_name, l.name as location_name
    FROM activity_log al
    LEFT JOIN people p ON al.person_id = p.id
    LEFT JOIN locations l ON al.location_id = l.id
    WHERE al.asset_id = ?
    ORDER BY al.created_at DESC
    LIMIT 50
  `).bind(assetId).all();

  // Get maintenance log
  const maintenance = await env.DB.prepare(`
    SELECT * FROM maintenance_log WHERE asset_id = ? ORDER BY date DESC
  `).bind(assetId).all();

  return json({ ...asset, history: history.results, maintenance: maintenance.results });
}

async function getAssetByTag(env, tag) {
  const asset = await env.DB.prepare('SELECT id FROM assets WHERE asset_tag = ?').bind(tag).first();
  if (!asset) return json({ error: 'Asset not found' }, 404);
  return getAsset(env, asset.id);
}

async function getAssetBySerial(env, serial) {
  const asset = await env.DB.prepare("SELECT id FROM assets WHERE serial_number = ? AND status != 'disposed'").bind(serial).first();
  if (!asset) return json({ error: 'Asset not found' }, 404);
  return getAsset(env, asset.id);
}

async function createAsset(request, env) {
  const data = await body(request);
  if (!data.name) return json({ error: 'Name is required' }, 400);

  const assetId = id();
  const tag = data.asset_tag || await generateTag(env, data.category_id);

  // Calculate warranty expiry
  let warrantyExpiry = data.warranty_expiry || null;
  if (data.purchase_date && data.warranty_months) {
    const d = new Date(data.purchase_date);
    d.setMonth(d.getMonth() + parseInt(data.warranty_months));
    warrantyExpiry = d.toISOString().slice(0, 10);
  }

  const ts = now();

  await env.DB.prepare(`
    INSERT INTO assets (id, asset_tag, name, serial_number, category_id, manufacturer, model, status,
      purchase_date, purchase_cost, purchase_order, supplier, warranty_months, warranty_expiry,
      notes, image_url, hostname, os, cpu, ram_gb, disk_gb, mac_address, ip_address, enrolled_user,
      location_id, assigned_to, assigned_date, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    assetId, tag, data.name, data.serial_number || null, data.category_id || null,
    data.manufacturer || null, data.model || null, data.status || 'available',
    data.purchase_date || null, data.purchase_cost || null, data.purchase_order || null,
    data.supplier || null, data.warranty_months || null, warrantyExpiry,
    data.notes || null, data.image_url || null,
    data.hostname || null, data.os || null, data.cpu || null,
    data.ram_gb || null, data.disk_gb || null, data.mac_address || null,
    data.ip_address || null, data.enrolled_user || null,
    data.location_id || null,
    data.assigned_to || null, data.assigned_to ? ts : null, ts, ts
  ).run();

  // If assigned on creation, set status to deployed
  if (data.assigned_to) {
    await env.DB.prepare('UPDATE assets SET status = ? WHERE id = ?').bind('deployed', assetId).run();
  }

  const user = request._user;
  const performed_by = user ? (user.display_name || user.email) : null;
  await logActivity(env, { asset_id: assetId, action: 'create', details: `Created asset ${tag}: ${data.name}`, performed_by });

  // Send notification
  try {
    await notify(env, 'asset_created', {
      asset: { id: assetId, asset_tag: tag, name: data.name },
      actor: performed_by,
      actorEmail: user?.email
    });
  } catch (e) { console.error('notify error:', e); }

  return json({ id: assetId, asset_tag: tag }, 201);
}

// Idempotent device enrolment. Serial number is the natural dedup key — BIOS
// serials are stable per physical machine, so re-running the PowerShell
// script from the same laptop updates in place instead of minting duplicate
// asset tags. Existing human-entered fields (name, assignment, purchase data)
// are preserved; only the auto-collected hardware specs get overwritten.
async function enrolDevice(request, env) {
  const data = await body(request);
  const serial = (data.serial_number || '').trim();
  if (!serial) return json({ error: 'serial_number is required' }, 400);

  const ramGb = data.ram_gb != null ? parseInt(data.ram_gb) : null;
  const diskGb = data.disk_gb != null ? parseInt(data.disk_gb) : null;

  const user = request._user;
  const performed_by = user ? (user.display_name || user.email) : 'Enrolment Script';

  const existing = await env.DB.prepare('SELECT * FROM assets WHERE serial_number = ?').bind(serial).first();

  if (existing) {
    const ts = now();
    await env.DB.prepare(`
      UPDATE assets SET
        hostname = ?, os = ?, cpu = ?, ram_gb = ?, disk_gb = ?,
        mac_address = ?, ip_address = ?, enrolled_user = ?,
        manufacturer = COALESCE(?, manufacturer),
        model = COALESCE(?, model),
        updated_at = ?
      WHERE id = ?
    `).bind(
      data.hostname || null, data.os || null, data.cpu || null, ramGb, diskGb,
      data.mac_address || null, data.ip_address || null, data.enrolled_user || null,
      data.manufacturer || null, data.model || null,
      ts, existing.id
    ).run();

    await logActivity(env, {
      asset_id: existing.id,
      action: 'enrol',
      details: `Refreshed specs via enrolment script${data.hostname ? ` (${data.hostname})` : ''}`,
      performed_by
    });

    return json({
      id: existing.id,
      asset_tag: existing.asset_tag,
      created: false
    });
  }

  // New device. Default category = laptop unless the script says otherwise
  // (it auto-detects from chassis type and sends a category_id when known).
  const categoryId = data.category_id || 'cat_laptop';
  const assetId = id();
  const tag = await generateTag(env, categoryId);
  const name = (data.name || data.hostname
    || ((data.manufacturer || '') + ' ' + (data.model || '')).trim()
    || 'Enrolled device').trim();
  const ts = now();

  await env.DB.prepare(`
    INSERT INTO assets (
      id, asset_tag, name, serial_number, category_id, manufacturer, model, status,
      hostname, os, cpu, ram_gb, disk_gb, mac_address, ip_address, enrolled_user,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    assetId, tag, name, serial, categoryId,
    data.manufacturer || null, data.model || null, 'available',
    data.hostname || null, data.os || null, data.cpu || null, ramGb, diskGb,
    data.mac_address || null, data.ip_address || null, data.enrolled_user || null,
    ts, ts
  ).run();

  await logActivity(env, {
    asset_id: assetId,
    action: 'create',
    details: `Enrolled ${tag}: ${name} (serial ${serial})`,
    performed_by
  });

  try {
    await notify(env, 'asset_created', {
      asset: { id: assetId, asset_tag: tag, name },
      actor: performed_by,
      actorEmail: user?.email
    });
  } catch (e) { console.error('notify error:', e); }

  return json({
    id: assetId,
    asset_tag: tag,
    created: true
  }, 201);
}

// ─── Asset Issues ──────────────────────────────
// Flow:
//   1. Admin POSTs /api/assets/:id/issue → a pending issue row is created
//      and an email with a signing link is sent to the recipient.
//   2. Recipient GETs /sign/:token → gets a public signing page (not behind
//      CF Access; token is the sole authorization).
//   3. Recipient POSTs the signature to the same URL → row is marked signed
//      and an admin notification fires.

const ISSUE_EXPIRY_DAYS = 30;

// Default terms shown to the recipient on the signing page. Snapshotted
// onto each issue row at creation time so editing this template later
// doesn't retroactively change what a past signer agreed to.
const DEFAULT_ISSUE_TERMS =
  'I acknowledge receipt of the asset described above. I agree to take ' +
  'reasonable care of this device, use it for work purposes in line with ' +
  'Walgett Shire Council policy, and return it to the IT team when I ' +
  'leave the role or when requested. I will report any loss, theft, or ' +
  'damage to the IT team as soon as practicable.';

function generateIssueToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const b64 = btoa(String.fromCharCode.apply(null, bytes));
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function issueSigningUrl(token) {
  return `https://api.it-wsc.com/sign/${token}`;
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

async function issueAsset(request, env, assetId) {
  const data = await body(request);
  const asset = await env.DB.prepare('SELECT * FROM assets WHERE id = ?').bind(assetId).first();
  if (!asset) return json({ error: 'Asset not found' }, 404);

  const personId = (data.person_id || '').trim();
  if (!personId) return json({ error: 'person_id is required' }, 400);
  const person = await env.DB.prepare('SELECT * FROM people WHERE id = ?').bind(personId).first();
  if (!person) return json({ error: 'Person not found' }, 404);
  if (!person.email) return json({ error: 'Person has no email address; add one before issuing.' }, 400);

  const token = generateIssueToken();
  const issueId = id();
  const ts = now();
  const expiresMs = Date.now() + ISSUE_EXPIRY_DAYS * 24 * 60 * 60 * 1000;
  const expiresAt = new Date(expiresMs).toISOString().slice(0, 19).replace('T', ' ');
  const termsText = typeof data.terms_text === 'string' && data.terms_text.trim()
    ? data.terms_text.trim()
    : DEFAULT_ISSUE_TERMS;

  const user = request._user;
  const issuedByEmail = user ? user.email : null;

  await env.DB.prepare(`
    INSERT INTO asset_issues (
      id, asset_id, person_id, token, issued_by_email, issued_at,
      status, expires_at, terms_text, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)
  `).bind(issueId, assetId, personId, token, issuedByEmail, ts, expiresAt, termsText, ts).run();

  // Send the signing email. Tolerate failure here — the issue row still
  // exists; admin can hit the resend endpoint.
  const emailResult = await sendIssueEmail(env, {
    asset, person, token, termsText, issuedBy: user
  });

  if (emailResult.ok) {
    await env.DB.prepare('UPDATE asset_issues SET email_sent_at = ? WHERE id = ?').bind(ts, issueId).run();
  }

  await logActivity(env, {
    asset_id: assetId,
    action: 'issue_created',
    details: `Signing link sent to ${person.name} <${person.email}>`,
    performed_by: user ? (user.display_name || user.email) : null
  });

  return json({
    id: issueId,
    token,
    status: 'pending',
    email_sent: !!emailResult.ok,
    email_error: emailResult.ok ? null : (emailResult.error || 'Email failed'),
    signing_url: issueSigningUrl(token)
  }, 201);
}

async function sendIssueEmail(env, { asset, person, token, termsText, issuedBy }) {
  const signingUrl = issueSigningUrl(token);
  const subject = `[WSC IT] Please acknowledge receipt of ${asset.asset_tag}`;
  const actor = issuedBy ? (issuedBy.display_name || issuedBy.email) : 'WSC IT';
  const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif">
  <div style="max-width:600px;margin:0 auto;padding:20px">
    <div style="background:linear-gradient(135deg,#1e3a5f 0%,#2563eb 100%);padding:24px;border-radius:12px 12px 0 0">
      <h1 style="margin:0;color:#fff;font-size:20px;font-weight:600">WSC IT Asset Management</h1>
      <p style="margin:4px 0 0;color:#bfdbfe;font-size:13px">Walgett Shire Council</p>
    </div>
    <div style="background:#fff;padding:28px 24px;border-radius:0 0 12px 12px;box-shadow:0 1px 3px rgba(0,0,0,.1)">
      <p style="margin:0 0 14px;font-size:15px;color:#111827">Hi ${escapeHtml(person.name)},</p>
      <p style="margin:0 0 14px;font-size:14px;color:#374151;line-height:1.55">
        ${escapeHtml(actor)} has assigned you the following asset. Please review and sign the acknowledgement of receipt so we have a record of handover.
      </p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0 20px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px">
        <tr><td style="padding:10px 14px;color:#6b7280;font-size:13px;width:35%;border-bottom:1px solid #e5e7eb">Asset tag</td><td style="padding:10px 14px;color:#111827;font-size:14px;font-weight:600;border-bottom:1px solid #e5e7eb;font-family:monospace">${escapeHtml(asset.asset_tag)}</td></tr>
        <tr><td style="padding:10px 14px;color:#6b7280;font-size:13px;border-bottom:1px solid #e5e7eb">Name</td><td style="padding:10px 14px;color:#111827;font-size:14px;border-bottom:1px solid #e5e7eb">${escapeHtml(asset.name)}</td></tr>
        ${asset.serial_number ? `<tr><td style="padding:10px 14px;color:#6b7280;font-size:13px;border-bottom:1px solid #e5e7eb">Serial</td><td style="padding:10px 14px;color:#111827;font-size:14px;border-bottom:1px solid #e5e7eb;font-family:monospace">${escapeHtml(asset.serial_number)}</td></tr>` : ''}
        ${asset.manufacturer || asset.model ? `<tr><td style="padding:10px 14px;color:#6b7280;font-size:13px">Make / model</td><td style="padding:10px 14px;color:#111827;font-size:14px">${escapeHtml(((asset.manufacturer || '') + ' ' + (asset.model || '')).trim())}</td></tr>` : ''}
      </table>
      <div style="text-align:center;margin:24px 0">
        <a href="${signingUrl}" style="display:inline-block;background:#2563eb;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-size:15px;font-weight:600">Review and sign</a>
      </div>
      <p style="margin:20px 0 0;font-size:12px;color:#6b7280;line-height:1.5">
        This link is unique to you and will expire in ${ISSUE_EXPIRY_DAYS} days. If you didn't expect this email, please let IT know.
      </p>
    </div>
    <p style="text-align:center;color:#9ca3af;font-size:11px;margin:18px 0 0">WSC IT Asset Management — automated receipt request</p>
  </div>
</body></html>`;
  const text = `Hi ${person.name},\n\n${actor} has assigned you ${asset.asset_tag} — ${asset.name}. Please acknowledge receipt by signing at:\n\n${signingUrl}\n\nThis link expires in ${ISSUE_EXPIRY_DAYS} days.`;
  return await sendMail(env, person.email, subject, html, text);
}

async function listIssues(request, env, url) {
  const params = url.searchParams;
  const status = params.get('status') || '';
  const limit = Math.min(200, Math.max(1, parseInt(params.get('limit')) || 100));

  let whereClause = '';
  const binds = [];
  if (status) { whereClause = 'WHERE i.status = ?'; binds.push(status); }

  const result = await env.DB.prepare(`
    SELECT i.id, i.asset_id, i.person_id, i.token, i.issued_by_email,
           i.issued_at, i.email_sent_at, i.signed_at, i.signature_name,
           i.status, i.expires_at,
           a.asset_tag, a.name AS asset_name, a.serial_number,
           p.name AS person_name, p.email AS person_email, p.department
    FROM asset_issues i
    JOIN assets a ON a.id = i.asset_id
    JOIN people p ON p.id = i.person_id
    ${whereClause}
    ORDER BY i.issued_at DESC
    LIMIT ?
  `).bind(...binds, limit).all();

  return json({ data: result.results || [] });
}

async function getIssue(env, issueId) {
  const row = await env.DB.prepare(`
    SELECT i.*, a.asset_tag, a.name AS asset_name, a.serial_number,
           p.name AS person_name, p.email AS person_email, p.department
    FROM asset_issues i
    JOIN assets a ON a.id = i.asset_id
    JOIN people p ON p.id = i.person_id
    WHERE i.id = ?
  `).bind(issueId).first();
  if (!row) return json({ error: 'Issue not found' }, 404);
  return json(row);
}

async function resendIssue(request, env, issueId) {
  const row = await env.DB.prepare(`
    SELECT i.*, a.asset_tag, a.name AS asset_name, a.serial_number,
           a.manufacturer, a.model,
           p.name AS person_name, p.email AS person_email
    FROM asset_issues i
    JOIN assets a ON a.id = i.asset_id
    JOIN people p ON p.id = i.person_id
    WHERE i.id = ?
  `).bind(issueId).first();
  if (!row) return json({ error: 'Issue not found' }, 404);
  if (row.status !== 'pending') return json({ error: 'Issue is not pending' }, 400);
  if (!row.person_email) return json({ error: 'Recipient has no email' }, 400);

  const asset = {
    asset_tag: row.asset_tag, name: row.asset_name,
    serial_number: row.serial_number, manufacturer: row.manufacturer, model: row.model
  };
  const person = { name: row.person_name, email: row.person_email };
  const user = request._user;

  const result = await sendIssueEmail(env, {
    asset, person, token: row.token, termsText: row.terms_text, issuedBy: user
  });

  if (!result.ok) return json({ error: result.error || 'Email failed' }, 500);

  await env.DB.prepare('UPDATE asset_issues SET email_sent_at = ?, updated_at = ? WHERE id = ?')
    .bind(now(), now(), issueId).run();

  await logActivity(env, {
    asset_id: row.asset_id,
    action: 'issue_resent',
    details: `Resent signing link to ${person.name} <${person.email}>`,
    performed_by: user ? (user.display_name || user.email) : null
  });

  return json({ ok: true });
}

async function cancelIssue(request, env, issueId) {
  const row = await env.DB.prepare('SELECT * FROM asset_issues WHERE id = ?').bind(issueId).first();
  if (!row) return json({ error: 'Issue not found' }, 404);
  if (row.status === 'signed') return json({ error: 'Cannot cancel a signed issue' }, 400);

  await env.DB.prepare("UPDATE asset_issues SET status = 'cancelled', updated_at = ? WHERE id = ?")
    .bind(now(), issueId).run();

  const user = request._user;
  await logActivity(env, {
    asset_id: row.asset_id,
    action: 'issue_cancelled',
    details: 'Signing link cancelled',
    performed_by: user ? (user.display_name || user.email) : null
  });

  return json({ ok: true });
}

// ─── Public signing page (no auth; token is the authorization) ───

async function loadIssueByToken(env, token) {
  if (!token) return null;
  return await env.DB.prepare(`
    SELECT i.*, a.asset_tag, a.name AS asset_name, a.serial_number,
           a.manufacturer, a.model,
           p.name AS person_name, p.email AS person_email, p.department
    FROM asset_issues i
    JOIN assets a ON a.id = i.asset_id
    JOIN people p ON p.id = i.person_id
    WHERE i.token = ?
  `).bind(token).first();
}

function signingHtmlResponse(body, status) {
  return new Response(body, {
    status: status || 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer'
    }
  });
}

function signingStatusPage(title, message, tone) {
  const color = tone === 'ok' ? '#10b981' : tone === 'warn' ? '#f59e0b' : '#ef4444';
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} — WSC Assets</title>
<style>body{margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;background:#f3f4f6;color:#111827;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
.card{max-width:480px;width:100%;background:#fff;border-radius:12px;box-shadow:0 4px 16px rgba(0,0,0,.08);padding:32px;text-align:center}
.dot{width:56px;height:56px;border-radius:50%;background:${color}22;color:${color};display:flex;align-items:center;justify-content:center;font-size:28px;margin:0 auto 16px}
h1{font-size:20px;margin:0 0 8px}p{margin:0;color:#4b5563;font-size:14px;line-height:1.55}</style>
</head><body><div class="card"><div class="dot">${tone === 'ok' ? '✓' : '!'}</div><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p></div></body></html>`;
}

async function renderSigningPage(env, token) {
  const row = await loadIssueByToken(env, token);
  if (!row) return signingHtmlResponse(signingStatusPage('Link not found', 'This signing link is invalid or has been removed.', 'error'), 404);

  if (row.status === 'cancelled') {
    return signingHtmlResponse(signingStatusPage('Link cancelled', 'This signing link has been cancelled. Contact IT if this is unexpected.', 'warn'), 410);
  }
  if (row.status === 'signed') {
    return signingHtmlResponse(signingStatusPage('Already signed', `Thanks — this receipt was signed on ${row.signed_at || 'a previous date'}. Nothing more to do.`, 'ok'), 200);
  }
  if (row.expires_at) {
    const exp = new Date(row.expires_at.replace(' ', 'T') + 'Z').getTime();
    if (!isNaN(exp) && Date.now() > exp) {
      await env.DB.prepare("UPDATE asset_issues SET status = 'expired' WHERE id = ? AND status = 'pending'").bind(row.id).run();
      return signingHtmlResponse(signingStatusPage('Link expired', 'This signing link has expired. Contact IT to have a new one sent.', 'warn'), 410);
    }
  }

  const assetLine = `${row.asset_tag} — ${row.asset_name}`;
  const makeModel = ((row.manufacturer || '') + ' ' + (row.model || '')).trim();

  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Acknowledge receipt — WSC Assets</title>
<style>
  *{box-sizing:border-box}
  body{margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;background:#f3f4f6;color:#111827;min-height:100vh;padding:16px}
  .wrap{max-width:640px;margin:0 auto}
  .header{background:linear-gradient(135deg,#1e3a5f,#2563eb);color:#fff;padding:20px;border-radius:12px 12px 0 0}
  .header h1{margin:0;font-size:18px;font-weight:600}
  .header p{margin:2px 0 0;font-size:12px;color:#bfdbfe}
  .card{background:#fff;padding:22px 20px;border-radius:0 0 12px 12px;box-shadow:0 2px 6px rgba(0,0,0,.06)}
  .row{display:flex;justify-content:space-between;gap:12px;padding:10px 0;border-bottom:1px solid #f3f4f6;font-size:14px}
  .row:last-child{border-bottom:0}.k{color:#6b7280}.v{color:#111827;font-weight:500;text-align:right;max-width:60%;word-break:break-word}
  .mono{font-family:'JetBrains Mono',Menlo,Consolas,monospace}
  .terms{background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:14px;margin:18px 0 12px;font-size:13px;line-height:1.55;color:#374151;white-space:pre-wrap}
  label{display:block;font-size:13px;color:#374151;margin:14px 0 6px;font-weight:500}
  input[type=text]{width:100%;padding:10px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:15px;font-family:inherit}
  input[type=text]:focus{outline:none;border-color:#2563eb;box-shadow:0 0 0 3px #2563eb22}
  .pad-wrap{border:1px dashed #9ca3af;border-radius:8px;background:#fff;touch-action:none;position:relative}
  canvas{display:block;width:100%;height:180px;border-radius:8px;cursor:crosshair;touch-action:none}
  .pad-hint{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);color:#9ca3af;font-size:13px;pointer-events:none}
  .pad-actions{display:flex;gap:8px;justify-content:space-between;align-items:center;margin-top:8px}
  .pad-actions button{background:transparent;border:0;color:#6b7280;font-size:13px;cursor:pointer;padding:6px;text-decoration:underline}
  .submit{width:100%;margin-top:18px;padding:14px;background:#2563eb;color:#fff;border:0;border-radius:10px;font-size:15px;font-weight:600;cursor:pointer}
  .submit:disabled{background:#9ca3af;cursor:not-allowed}
  .submit.loading{opacity:.7}
  .err{color:#dc2626;font-size:13px;margin-top:8px;display:none}
  .footer{margin:14px 0 0;text-align:center;color:#9ca3af;font-size:11px}
  .ok{display:none;text-align:center;padding:40px 20px}.ok .tick{width:56px;height:56px;border-radius:50%;background:#10b98122;color:#10b981;display:flex;align-items:center;justify-content:center;font-size:28px;margin:0 auto 12px}
  .ok h2{margin:0 0 6px;font-size:18px}.ok p{margin:0;color:#4b5563;font-size:14px}
  @media (max-width:380px){canvas{height:160px}}
</style>
</head><body>
<div class="wrap">
  <div class="header">
    <h1>Acknowledge receipt</h1>
    <p>Walgett Shire Council — IT Asset Register</p>
  </div>
  <div class="card" id="form-card">
    <p style="margin:0 0 14px;font-size:14px;color:#4b5563">Hi <strong>${escapeHtml(row.person_name)}</strong>, please review the asset below and sign to confirm receipt.</p>
    <div class="row"><span class="k">Asset tag</span><span class="v mono">${escapeHtml(row.asset_tag)}</span></div>
    <div class="row"><span class="k">Name</span><span class="v">${escapeHtml(row.asset_name)}</span></div>
    ${row.serial_number ? `<div class="row"><span class="k">Serial</span><span class="v mono">${escapeHtml(row.serial_number)}</span></div>` : ''}
    ${makeModel ? `<div class="row"><span class="k">Make / model</span><span class="v">${escapeHtml(makeModel)}</span></div>` : ''}
    <div class="terms">${escapeHtml(row.terms_text || DEFAULT_ISSUE_TERMS)}</div>
    <form id="sign-form" onsubmit="return submitSig(event)">
      <label for="typed-name">Full name</label>
      <input id="typed-name" type="text" required autocomplete="name" placeholder="Type your name">
      <label>Signature — draw below</label>
      <div class="pad-wrap"><canvas id="pad" width="600" height="180"></canvas><span class="pad-hint" id="pad-hint">Draw with your finger or mouse</span></div>
      <div class="pad-actions"><span style="font-size:12px;color:#6b7280">Your IP address is recorded with the signature.</span><button type="button" id="clear-btn" onclick="clearPad()">Clear</button></div>
      <button type="submit" class="submit" id="submit-btn">I acknowledge — submit</button>
      <div class="err" id="err"></div>
    </form>
  </div>
  <div class="card ok" id="ok-card">
    <div class="tick">✓</div>
    <h2>Thank you</h2>
    <p>Your receipt for <strong>${escapeHtml(assetLine)}</strong> has been recorded. You can close this page.</p>
  </div>
  <p class="footer">If you didn't expect this, contact IT straight away.</p>
</div>
<script>
(function(){
  var canvas = document.getElementById('pad');
  var hint = document.getElementById('pad-hint');
  var ctx = canvas.getContext('2d');
  var drawing = false, dirty = false, lastX = 0, lastY = 0;
  function resize(){
    var rect = canvas.getBoundingClientRect();
    var ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(rect.width * ratio);
    canvas.height = Math.round(rect.height * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, rect.width, rect.height);
    ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#111827';
  }
  resize(); window.addEventListener('resize', function(){ var data = canvas.toDataURL(); resize(); var img = new Image(); img.onload = function(){ ctx.drawImage(img, 0, 0, canvas.width / (window.devicePixelRatio||1), canvas.height / (window.devicePixelRatio||1)); }; img.src = data; });
  function pos(e){
    var rect = canvas.getBoundingClientRect();
    var x, y;
    if (e.touches && e.touches[0]) { x = e.touches[0].clientX - rect.left; y = e.touches[0].clientY - rect.top; }
    else { x = e.clientX - rect.left; y = e.clientY - rect.top; }
    return { x: x, y: y };
  }
  function start(e){ e.preventDefault(); drawing = true; var p = pos(e); lastX = p.x; lastY = p.y; if(hint){ hint.style.display = 'none'; } }
  function move(e){ if(!drawing) return; e.preventDefault(); var p = pos(e); ctx.beginPath(); ctx.moveTo(lastX, lastY); ctx.lineTo(p.x, p.y); ctx.stroke(); lastX = p.x; lastY = p.y; dirty = true; }
  function end(e){ if(drawing){ e.preventDefault(); } drawing = false; }
  canvas.addEventListener('mousedown', start); canvas.addEventListener('mousemove', move); canvas.addEventListener('mouseup', end); canvas.addEventListener('mouseleave', end);
  canvas.addEventListener('touchstart', start, {passive:false}); canvas.addEventListener('touchmove', move, {passive:false}); canvas.addEventListener('touchend', end, {passive:false});
  window.clearPad = function(){ resize(); dirty = false; if(hint){ hint.style.display = ''; } };
  window.submitSig = function(ev){
    ev.preventDefault();
    var name = document.getElementById('typed-name').value.trim();
    var err = document.getElementById('err');
    err.style.display = 'none';
    if (!name) { err.textContent = 'Please type your full name.'; err.style.display = 'block'; return false; }
    if (!dirty) { err.textContent = 'Please draw your signature in the box.'; err.style.display = 'block'; return false; }
    var btn = document.getElementById('submit-btn');
    btn.disabled = true; btn.classList.add('loading'); btn.textContent = 'Submitting...';
    var dataUrl = canvas.toDataURL('image/png');
    fetch(window.location.href, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ signature_name: name, signature_data_url: dataUrl }) })
      .then(function(r){ return r.json().then(function(j){ return { ok: r.ok, data: j }; }); })
      .then(function(res){
        if (!res.ok) throw new Error((res.data && res.data.error) || 'Submission failed');
        document.getElementById('form-card').style.display = 'none';
        document.getElementById('ok-card').style.display = 'block';
      })
      .catch(function(e){ err.textContent = e.message || 'Something went wrong.'; err.style.display = 'block'; btn.disabled = false; btn.classList.remove('loading'); btn.textContent = 'I acknowledge — submit'; });
    return false;
  };
})();
</script>
</body></html>`;

  return signingHtmlResponse(html);
}

async function submitSignature(request, env, token) {
  const row = await loadIssueByToken(env, token);
  if (!row) return json({ error: 'Invalid token' }, 404);
  if (row.status !== 'pending') {
    return json({ error: row.status === 'signed' ? 'Already signed' : 'Link is no longer active' }, 409);
  }
  if (row.expires_at) {
    const exp = new Date(row.expires_at.replace(' ', 'T') + 'Z').getTime();
    if (!isNaN(exp) && Date.now() > exp) {
      await env.DB.prepare("UPDATE asset_issues SET status = 'expired' WHERE id = ?").bind(row.id).run();
      return json({ error: 'Link has expired' }, 410);
    }
  }

  const data = await body(request);
  const sigUrl = (data.signature_data_url || '').trim();
  const sigName = (data.signature_name || '').trim();
  if (!sigUrl || !sigUrl.startsWith('data:image/')) {
    return json({ error: 'Invalid signature image' }, 400);
  }
  // Cap size — 200KB is plenty for a 600x180 canvas PNG.
  if (sigUrl.length > 200 * 1024) return json({ error: 'Signature too large' }, 413);
  if (!sigName) return json({ error: 'Typed name is required' }, 400);

  const ip = request.headers.get('CF-Connecting-IP') || null;
  const ts = now();

  await env.DB.prepare(`
    UPDATE asset_issues
    SET status = 'signed', signed_at = ?, signature_data_url = ?,
        signature_name = ?, signature_ip = ?, updated_at = ?
    WHERE id = ?
  `).bind(ts, sigUrl, sigName, ip, ts, row.id).run();

  await logActivity(env, {
    asset_id: row.asset_id,
    action: 'issue_signed',
    details: `Signed by ${row.person_name} (${sigName}) from ${ip || 'unknown IP'}`,
    performed_by: row.person_name
  });

  try {
    await notify(env, 'asset_issue_signed', {
      asset: { id: row.asset_id, asset_tag: row.asset_tag, name: row.asset_name, serial_number: row.serial_number },
      person: { name: row.person_name, email: row.person_email },
      signature_name: sigName,
      signature_ip: ip
    });
  } catch (e) { console.error('notify error (issue_signed):', e); }

  return json({ ok: true });
}

// ─── Enrolment launcher (/enrol) ───────────────
// Public, password-gated page that hands out the pre-filled PowerShell
// one-liner for enrolling a new device. The password gates distribution
// of the API key -- it doesn't extend auth on the /api/assets/enrol
// endpoint itself, which still uses the same X-Api-Key header. Intent is
// to stop accidental key sharing (e.g. staff reading a one-liner over
// someone's shoulder and rerunning it) rather than defending against a
// key that's already leaked out.

const ENROL_PASSWORD_MAX_ATTEMPTS = 8;
const ENROL_PASSWORD_LOCKOUT_MINUTES = 15;

function enrolPageHtml(body) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Enrol a device -- WSC Assets</title>
<style>
  *{box-sizing:border-box}
  body{margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;background:#f3f4f6;color:#111827;min-height:100vh;display:flex;align-items:flex-start;justify-content:center;padding:20px}
  .wrap{max-width:560px;width:100%;margin-top:40px}
  .header{background:linear-gradient(135deg,#1e3a5f,#2563eb);color:#fff;padding:22px;border-radius:12px 12px 0 0}
  .header h1{margin:0;font-size:18px;font-weight:600}
  .header p{margin:2px 0 0;font-size:12px;color:#bfdbfe}
  .card{background:#fff;padding:24px;border-radius:0 0 12px 12px;box-shadow:0 2px 6px rgba(0,0,0,.06)}
  label{display:block;font-size:13px;color:#374151;margin:0 0 6px;font-weight:500}
  input[type=password]{width:100%;padding:11px 13px;border:1px solid #d1d5db;border-radius:8px;font-size:15px;font-family:inherit}
  input[type=password]:focus{outline:none;border-color:#2563eb;box-shadow:0 0 0 3px rgba(37,99,235,.12)}
  .btn{display:inline-block;background:#2563eb;color:#fff;border:0;padding:12px 18px;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;margin-top:12px}
  .btn:hover{background:#1d4ed8}
  .btn-secondary{background:#fff;color:#374151;border:1px solid #d1d5db}
  .btn-secondary:hover{background:#f9fafb}
  .err{margin-top:10px;padding:10px 12px;background:#fef2f2;color:#991b1b;border:1px solid #fecaca;border-radius:8px;font-size:13px}
  .ok-badge{display:inline-flex;align-items:center;gap:6px;background:#d1fae5;color:#065f46;padding:4px 10px;border-radius:20px;font-size:12px;font-weight:500;margin-bottom:10px}
  .step{margin:18px 0 8px;font-size:13px;color:#374151}
  .cmd{position:relative;background:#0f172a;color:#e2e8f0;padding:14px 60px 14px 14px;border-radius:8px;font-family:'JetBrains Mono',Menlo,Consolas,monospace;font-size:12px;line-height:1.5;word-break:break-all;white-space:pre-wrap}
  .copy-btn{position:absolute;top:8px;right:8px;background:#1e293b;color:#e2e8f0;border:1px solid #334155;padding:6px 10px;border-radius:6px;font-size:11px;cursor:pointer}
  .copy-btn:hover{background:#334155}
  .copy-btn.copied{background:#10b981;color:#fff;border-color:#10b981}
  .muted{font-size:12px;color:#6b7280;line-height:1.5;margin-top:12px}
  ol{margin:12px 0;padding-left:22px}ol li{margin:4px 0;font-size:13px;color:#374151}
  code{background:#f3f4f6;padding:1px 6px;border-radius:4px;font-family:'JetBrains Mono',Menlo,Consolas,monospace;font-size:12px}
</style></head><body><div class="wrap">
  <div class="header">
    <h1>Enrol a device</h1>
    <p>Walgett Shire Council -- IT Asset Register</p>
  </div>
  <div class="card">${body}</div>
</div></body></html>`;
}

function renderEnrolPage(errorMsg) {
  const body = `
    <p style="margin:0 0 14px;font-size:14px;color:#4b5563">Enter the enrolment password to get the PowerShell command for registering this device.</p>
    <form method="POST" action="/enrol/unlock">
      <label for="pwd">Password</label>
      <input id="pwd" name="password" type="password" autocomplete="off" autofocus required>
      <button class="btn" type="submit">Unlock</button>
    </form>
    ${errorMsg ? `<div class="err">${escapeHtml(errorMsg)}</div>` : ''}
    <p class="muted">You will get a one-line PowerShell command to paste into an elevated or regular PowerShell window. It collects the machine's hardware specs and registers it in the asset register. Safe to re-run.</p>
  `;
  return new Response(enrolPageHtml(body), {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer'
    }
  });
}

async function handleEnrolUnlock(request, env) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';

  // Password may arrive as form-url-encoded (form submit) or JSON (fetch
  // from a future client-side handler).
  let password = '';
  const ctype = request.headers.get('Content-Type') || '';
  if (ctype.includes('application/json')) {
    try { password = ((await request.json()).password || '').trim(); } catch (e) { password = ''; }
  } else {
    const text = await request.text();
    const params = new URLSearchParams(text);
    password = (params.get('password') || '').trim();
  }

  if (!env.ENROL_PASSWORD) {
    return renderEnrolPage('Enrolment not configured. Ask an admin to set ENROL_PASSWORD.');
  }

  // Rate-limit attempts per-IP. Reuses the activity_log pattern from the
  // master-key flow so there's one place to audit lockouts.
  try {
    const cutoffMs = Date.now() - ENROL_PASSWORD_LOCKOUT_MINUTES * 60 * 1000;
    const cutoff = new Date(cutoffMs)
      .toLocaleString('sv-SE', { timeZone: 'Australia/Sydney' })
      .replace('T', ' ')
      .slice(0, 19);
    const recent = await env.DB.prepare(
      `SELECT COUNT(*) as attempts FROM activity_log
       WHERE action = 'enrol_password_failed' AND ip_address = ?
       AND created_at > ?`
    ).bind(ip, cutoff).first();

    if (recent && recent.attempts >= ENROL_PASSWORD_MAX_ATTEMPTS) {
      await logActivity(env, {
        action: 'enrol_password_blocked',
        details: `Rate limited: ${recent.attempts} failed attempts`,
        ip_address: ip
      });
      return renderEnrolPage('Too many failed attempts. Try again in 15 minutes.');
    }
  } catch (e) { /* activity_log may be missing on a fresh install */ }

  if (!password || password !== env.ENROL_PASSWORD) {
    try {
      await logActivity(env, {
        action: 'enrol_password_failed',
        details: 'Wrong enrolment password',
        ip_address: ip
      });
    } catch (e) { /* best effort */ }
    return renderEnrolPage('Wrong password.');
  }

  // Success. Hand back the one-liner with the API key pre-filled so the
  // user can copy + paste straight into PowerShell.
  const apiKey = env.API_KEY || '';
  if (!apiKey) {
    return renderEnrolPage('API_KEY not configured on the server. Ask IT.');
  }

  try {
    await logActivity(env, {
      action: 'enrol_password_success',
      details: `Enrolment command issued to ${ip}`,
      ip_address: ip
    });
  } catch (e) { /* best effort */ }

  // TLS 1.2 is required by Cloudflare; Windows PowerShell 5.1 defaults to
  // TLS 1.0/1.1 and would fail "underlying connection was closed" without
  // this. PS 7+ ignores the setting (already on 1.2+).
  const command = `[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; $env:WSC_API_KEY='${apiKey}'; irm https://api.it-wsc.com/enrol-script | iex`;
  const body = `
    <div class="ok-badge">✓ Unlocked</div>
    <div class="step"><strong>1.</strong> Open PowerShell on this PC.</div>
    <div class="step"><strong>2.</strong> Copy and paste the command below:</div>
    <div class="cmd">${escapeHtml(command)}<button class="copy-btn" id="copy-btn" type="button" onclick="doCopy()">Copy</button></div>
    <div class="step"><strong>3.</strong> Press Enter. You'll see the device's specs and a confirmation with the new asset tag.</div>
    <p class="muted">Re-running on the same PC is safe -- the script dedupes by BIOS serial and just refreshes the specs. Close this page when done; don't leave the command on screen.</p>
    <script>
      function doCopy(){
        var txt = ${JSON.stringify(command)};
        var btn = document.getElementById('copy-btn');
        (navigator.clipboard && navigator.clipboard.writeText(txt).then(ok, fallback)) || fallback();
        function ok(){ btn.textContent = 'Copied'; btn.classList.add('copied'); setTimeout(function(){ btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 2000); }
        function fallback(){
          var ta = document.createElement('textarea'); ta.value = txt; document.body.appendChild(ta); ta.select();
          try { document.execCommand('copy'); ok(); } catch(e) {}
          document.body.removeChild(ta);
        }
      }
    </script>
  `;
  return new Response(enrolPageHtml(body), {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer'
    }
  });
}

async function updateAsset(request, env, assetId) {
  const existing = await env.DB.prepare('SELECT * FROM assets WHERE id = ?').bind(assetId).first();
  if (!existing) return json({ error: 'Asset not found' }, 404);

  const data = await body(request);

  // Recalculate warranty expiry if relevant fields changed
  let warrantyExpiry = data.warranty_expiry !== undefined ? data.warranty_expiry : existing.warranty_expiry;
  const purchaseDate = data.purchase_date !== undefined ? data.purchase_date : existing.purchase_date;
  const warrantyMonths = data.warranty_months !== undefined ? data.warranty_months : existing.warranty_months;
  if (purchaseDate && warrantyMonths) {
    const d = new Date(purchaseDate);
    d.setMonth(d.getMonth() + parseInt(warrantyMonths));
    warrantyExpiry = d.toISOString().slice(0, 10);
  }

  const ts = now();

  await env.DB.prepare(`
    UPDATE assets SET
      asset_tag = ?, name = ?, serial_number = ?, category_id = ?, manufacturer = ?, model = ?,
      status = ?, purchase_date = ?, purchase_cost = ?, purchase_order = ?, supplier = ?,
      warranty_months = ?, warranty_expiry = ?, notes = ?, image_url = ?,
      hostname = ?, os = ?, cpu = ?, ram_gb = ?, disk_gb = ?, mac_address = ?, ip_address = ?, enrolled_user = ?,
      location_id = ?,
      assigned_to = ?, assigned_date = ?, updated_at = ?
    WHERE id = ?
  `).bind(
    data.asset_tag !== undefined ? data.asset_tag : existing.asset_tag,
    data.name !== undefined ? data.name : existing.name,
    data.serial_number !== undefined ? data.serial_number : existing.serial_number,
    data.category_id !== undefined ? data.category_id : existing.category_id,
    data.manufacturer !== undefined ? data.manufacturer : existing.manufacturer,
    data.model !== undefined ? data.model : existing.model,
    data.status !== undefined ? data.status : existing.status,
    data.purchase_date !== undefined ? data.purchase_date : existing.purchase_date,
    data.purchase_cost !== undefined ? data.purchase_cost : existing.purchase_cost,
    data.purchase_order !== undefined ? data.purchase_order : existing.purchase_order,
    data.supplier !== undefined ? data.supplier : existing.supplier,
    data.warranty_months !== undefined ? data.warranty_months : existing.warranty_months,
    warrantyExpiry,
    data.notes !== undefined ? data.notes : existing.notes,
    data.image_url !== undefined ? data.image_url : existing.image_url,
    data.hostname !== undefined ? data.hostname : existing.hostname,
    data.os !== undefined ? data.os : existing.os,
    data.cpu !== undefined ? data.cpu : existing.cpu,
    data.ram_gb !== undefined ? data.ram_gb : existing.ram_gb,
    data.disk_gb !== undefined ? data.disk_gb : existing.disk_gb,
    data.mac_address !== undefined ? data.mac_address : existing.mac_address,
    data.ip_address !== undefined ? data.ip_address : existing.ip_address,
    data.enrolled_user !== undefined ? data.enrolled_user : existing.enrolled_user,
    data.location_id !== undefined ? data.location_id : existing.location_id,
    data.assigned_to !== undefined ? data.assigned_to : existing.assigned_to,
    data.assigned_to !== undefined && data.assigned_to !== existing.assigned_to ? ts : existing.assigned_date,
    ts,
    assetId
  ).run();

  // If the image has been replaced or cleared, remove the old R2 blob so we
  // don't accumulate orphaned files. Only fires when data.image_url was
  // explicitly sent in the update (undefined = no change intended).
  if (data.image_url !== undefined && data.image_url !== existing.image_url && existing.image_url) {
    await deleteImageByUrl(env, existing.image_url);
  }

  // Helper to compare values across serialisation boundary (JSON ↔ SQLite types may differ)
  function valuesEqual(a, b) {
    if (a == null && b == null) return true;
    if (a == null || b == null) return false;
    return String(a) === String(b);
  }

  // Build change summary
  const changes = [];
  for (const key of Object.keys(data)) {
    if (!valuesEqual(data[key], existing[key]) && key !== 'updated_at') {
      changes.push(key);
    }
  }

  const user = request._user;
  const performed_by = user ? (user.display_name || user.email) : null;
  await logActivity(env, {
    asset_id: assetId,
    action: 'update',
    details: changes.length ? `Updated: ${changes.join(', ')}` : 'Updated asset',
    performed_by
  });

  return json({ ok: true });
}

async function deleteAsset(request, env, assetId) {
  const existing = await env.DB.prepare('SELECT * FROM assets WHERE id = ?').bind(assetId).first();
  if (!existing) return json({ error: 'Asset not found' }, 404);

  const user = request._user;
  const performed_by = user ? (user.display_name || user.email) : null;

  // Soft delete — set status to disposed
  await env.DB.prepare("UPDATE assets SET status = 'disposed', updated_at = ? WHERE id = ?").bind(now(), assetId).run();

  await logActivity(env, { asset_id: assetId, action: 'dispose', details: `Disposed asset ${existing.asset_tag}`, performed_by });

  // Send notification
  try {
    await notify(env, 'asset_disposed', {
      asset: { id: assetId, asset_tag: existing.asset_tag, name: existing.name },
      actor: performed_by,
      actorEmail: user?.email
    });
  } catch (e) { console.error('notify error:', e); }

  return json({ ok: true });
}

async function purgeAsset(request, env, assetId) {
  const existing = await env.DB.prepare('SELECT * FROM assets WHERE id = ?').bind(assetId).first();
  if (!existing) return json({ error: 'Asset not found' }, 404);

  const user = request._user;
  const performed_by = user ? (user.display_name || user.email) : null;

  // Atomic delete: all succeed or none do. Every table with a foreign
  // key back to assets has to come out first — D1 enforces FKs, so a
  // dangling reference in asset_issues (for example) would reject the
  // final DELETE FROM assets.
  await env.DB.batch([
    env.DB.prepare('DELETE FROM activity_log WHERE asset_id = ?').bind(assetId),
    env.DB.prepare('DELETE FROM maintenance_log WHERE asset_id = ?').bind(assetId),
    env.DB.prepare('DELETE FROM audit_items WHERE asset_id = ?').bind(assetId),
    env.DB.prepare('DELETE FROM asset_issues WHERE asset_id = ?').bind(assetId),
    env.DB.prepare('DELETE FROM assets WHERE id = ?').bind(assetId)
  ]);

  // Best-effort cleanup of the associated photo blob. Done after the DB
  // batch so a failed purge doesn't leave a zombie asset with no image.
  await deleteImageByUrl(env, existing.image_url);

  // Send notification
  try {
    await notify(env, 'asset_purged', {
      asset: { id: assetId, asset_tag: existing.asset_tag, name: existing.name },
      actor: performed_by,
      actorEmail: user?.email
    });
  } catch (e) { console.error('notify error:', e); }

  return json({ ok: true });
}

// ─── Checkout / Checkin ────────────────────────────────

async function checkoutAsset(request, env, assetId) {
  const asset = await env.DB.prepare('SELECT * FROM assets WHERE id = ?').bind(assetId).first();
  if (!asset) return json({ error: 'Asset not found' }, 404);
  if (asset.status === 'deployed') return json({ error: 'Asset is already checked out' }, 400);

  const data = await body(request);
  if (!data.person_id) return json({ error: 'person_id is required' }, 400);

  const ts = now();
  await env.DB.prepare(`
    UPDATE assets SET status = 'deployed', assigned_to = ?, assigned_date = ?, location_id = COALESCE(?, location_id), updated_at = ?
    WHERE id = ?
  `).bind(data.person_id, ts, data.location_id || null, ts, assetId).run();

  const person = await env.DB.prepare('SELECT name, department FROM people WHERE id = ?').bind(data.person_id).first();
  const user = request._user;
  const performed_by = user ? (user.display_name || user.email) : null;

  await logActivity(env, {
    asset_id: assetId,
    action: 'checkout',
    details: data.notes || `Checked out to ${person?.name || 'unknown'}`,
    person_id: data.person_id,
    location_id: data.location_id || asset.location_id,
    performed_by
  });

  // Send notification
  try {
    await notify(env, 'asset_checkout', {
      asset: { id: assetId, asset_tag: asset.asset_tag, name: asset.name },
      person,
      actor: performed_by,
      actorEmail: user?.email
    });
  } catch (e) { console.error('notify error:', e); }

  // Return the updated asset so the frontend can render immediately without
  // a follow-up GET that might hit a stale D1 replica.
  const updated = await env.DB.prepare(`
    SELECT a.*, p.name as assigned_to_name, p.email as assigned_to_email,
           p.department as assigned_to_department,
           l.name as location_name, c.name as category_name, c.prefix as category_prefix
    FROM assets a
    LEFT JOIN people p ON a.assigned_to = p.id
    LEFT JOIN locations l ON a.location_id = l.id
    LEFT JOIN categories c ON a.category_id = c.id
    WHERE a.id = ?
  `).bind(assetId).first();

  return json({ ok: true, asset: updated });
}

async function checkinAsset(request, env, assetId) {
  const asset = await env.DB.prepare('SELECT * FROM assets WHERE id = ?').bind(assetId).first();
  if (!asset) return json({ error: 'Asset not found' }, 404);

  const data = await body(request);
  const condition = data.condition || 'good';
  const newStatus = condition === 'good' ? 'available' : 'maintenance';
  const ts = now();

  const previousPerson = asset.assigned_to;

  await env.DB.prepare(`
    UPDATE assets SET status = ?, assigned_to = NULL, assigned_date = NULL, updated_at = ?
    WHERE id = ?
  `).bind(newStatus, ts, assetId).run();

  const person = previousPerson
    ? await env.DB.prepare('SELECT name FROM people WHERE id = ?').bind(previousPerson).first()
    : null;

  const user = request._user;
  const performed_by = user ? (user.display_name || user.email) : null;
  await logActivity(env, {
    asset_id: assetId,
    action: 'checkin',
    details: data.notes || `Checked in from ${person?.name || 'unknown'} (condition: ${condition})`,
    person_id: previousPerson,
    location_id: asset.location_id,
    performed_by
  });

  // Send notification
  try {
    await notify(env, 'asset_checkin', {
      asset: { id: assetId, asset_tag: asset.asset_tag, name: asset.name },
      person,
      condition,
      actor: performed_by,
      actorEmail: user?.email
    });
  } catch (e) { console.error('notify error:', e); }

  // Return the updated asset so the frontend can render immediately without
  // a follow-up GET that might hit a stale D1 replica.
  const updated = await env.DB.prepare(`
    SELECT a.*, p.name as assigned_to_name, p.email as assigned_to_email,
           p.department as assigned_to_department,
           l.name as location_name, c.name as category_name, c.prefix as category_prefix
    FROM assets a
    LEFT JOIN people p ON a.assigned_to = p.id
    LEFT JOIN locations l ON a.location_id = l.id
    LEFT JOIN categories c ON a.category_id = c.id
    WHERE a.id = ?
  `).bind(assetId).first();

  return json({ ok: true, status: newStatus, asset: updated });
}

// ─── Maintenance ───────────────────────────────────────

async function addMaintenance(request, env, assetId) {
  const asset = await env.DB.prepare('SELECT * FROM assets WHERE id = ?').bind(assetId).first();
  if (!asset) return json({ error: 'Asset not found' }, 404);

  const data = await body(request);
  if (!data.type || !data.description) return json({ error: 'type and description are required' }, 400);

  const maintenanceId = id();
  await env.DB.prepare(`
    INSERT INTO maintenance_log (id, asset_id, type, description, cost, performed_by, date, next_due, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    maintenanceId, assetId, data.type, data.description,
    data.cost || null, data.performed_by || null, data.date || now().slice(0, 10),
    data.next_due || null, now()
  ).run();

  const user = request._user;
  const performed_by = user ? (user.display_name || user.email) : null;
  await logActivity(env, {
    asset_id: assetId,
    action: 'maintenance',
    details: `${data.type}: ${data.description}`,
    performed_by
  });

  return json({ id: maintenanceId }, 201);
}

// ─── Auto Tag Generation ──────────────────────────────

async function generateTag(env, categoryId) {
  const prefix = env.ASSET_TAG_PREFIX || 'WSC';

  let catPrefix = 'X';
  if (categoryId) {
    const cat = await env.DB.prepare('SELECT prefix FROM categories WHERE id = ?').bind(categoryId).first();
    if (cat) catPrefix = cat.prefix;
  }

  const fullPrefix = `${prefix}-${catPrefix}-`;
  return await nextTagNumber(env, fullPrefix);
}

async function nextTag(env, prefix) {
  const prefixStr = env.ASSET_TAG_PREFIX || 'WSC';
  const fullPrefix = `${prefixStr}-${prefix}-`;
  const tag = await nextTagNumber(env, fullPrefix);
  return json({ tag });
}

async function nextTagNumber(env, fullPrefix) {
  const result = await env.DB.prepare(
    `SELECT asset_tag FROM assets WHERE asset_tag LIKE ? ORDER BY asset_tag DESC LIMIT 1`
  ).bind(fullPrefix + '%').first();

  let nextNum = 1;
  if (result) {
    const match = result.asset_tag.match(/-(\d+)$/);
    if (match) nextNum = parseInt(match[1]) + 1;
  }

  return fullPrefix + String(nextNum).padStart(4, '0');
}

// ─── People ────────────────────────────────────────────

async function listPeople(request, env, url) {
  const params = url.searchParams;
  let where = [];
  let binds = [];

  if (params.get('department')) {
    where.push('p.department = ?');
    binds.push(params.get('department'));
  }
  if (params.get('active') !== null && params.get('active') !== undefined && params.get('active') !== '') {
    where.push('p.active = ?');
    binds.push(parseInt(params.get('active')));
  } else {
    where.push('p.active = 1');
  }
  if (params.get('location')) {
    where.push('p.location_id = ?');
    binds.push(params.get('location'));
  }
  if (params.get('search')) {
    const s = '%' + params.get('search') + '%';
    where.push('(p.name LIKE ? OR p.email LIKE ? OR p.department LIKE ? OR p.position LIKE ?)');
    binds.push(s, s, s, s);
  }

  const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : '';

  const result = await env.DB.prepare(`
    SELECT p.*, l.name as location_name,
           (SELECT COUNT(*) FROM assets a WHERE a.assigned_to = p.id AND a.status = 'deployed') as asset_count
    FROM people p
    LEFT JOIN locations l ON p.location_id = l.id
    ${whereClause}
    ORDER BY p.name ASC
  `).bind(...binds).all();

  return json({ data: result.results });
}

async function getPerson(env, personId) {
  const person = await env.DB.prepare(`
    SELECT p.*, l.name as location_name
    FROM people p
    LEFT JOIN locations l ON p.location_id = l.id
    WHERE p.id = ?
  `).bind(personId).first();

  if (!person) return json({ error: 'Person not found' }, 404);

  const assets = await env.DB.prepare(`
    SELECT a.*, c.name as category_name, l.name as location_name
    FROM assets a
    LEFT JOIN categories c ON a.category_id = c.id
    LEFT JOIN locations l ON a.location_id = l.id
    WHERE a.assigned_to = ? AND a.status = 'deployed'
    ORDER BY a.asset_tag ASC
  `).bind(personId).all();

  return json({ ...person, assets: assets.results });
}

async function createPerson(request, env) {
  const data = await body(request);
  if (!data.name) return json({ error: 'Name is required' }, 400);

  const personId = id();
  await env.DB.prepare(`
    INSERT INTO people (id, name, email, department, position, phone, location_id, active, notes, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    personId, data.name, data.email || null, data.department || null,
    data.position || null, data.phone || null, data.location_id || null,
    data.active !== undefined ? data.active : 1, data.notes || null, now()
  ).run();

  return json({ id: personId }, 201);
}

async function updatePerson(request, env, personId) {
  const existing = await env.DB.prepare('SELECT * FROM people WHERE id = ?').bind(personId).first();
  if (!existing) return json({ error: 'Person not found' }, 404);

  const data = await body(request);
  await env.DB.prepare(`
    UPDATE people SET name = ?, email = ?, department = ?, position = ?, phone = ?, location_id = ?, active = ?, notes = ?
    WHERE id = ?
  `).bind(
    data.name !== undefined ? data.name : existing.name,
    data.email !== undefined ? data.email : existing.email,
    data.department !== undefined ? data.department : existing.department,
    data.position !== undefined ? data.position : existing.position,
    data.phone !== undefined ? data.phone : existing.phone,
    data.location_id !== undefined ? data.location_id : existing.location_id,
    data.active !== undefined ? data.active : existing.active,
    data.notes !== undefined ? data.notes : existing.notes,
    personId
  ).run();

  return json({ ok: true });
}

async function deletePerson(request, env, personId) {
  const existing = await env.DB.prepare('SELECT * FROM people WHERE id = ?').bind(personId).first();
  if (!existing) return json({ error: 'Person not found' }, 404);

  const user = request._user;
  const performed_by = user ? (user.display_name || user.email) : null;

  // Soft delete
  await env.DB.prepare('UPDATE people SET active = 0 WHERE id = ?').bind(personId).run();

  await logActivity(env, {
    action: 'deactivate_person',
    details: `Deactivated ${existing.name}${existing.email ? ' (' + existing.email + ')' : ''}`,
    performed_by,
    person_id: personId
  });

  return json({ ok: true });
}

// ─── Locations ─────────────────────────────────────────

async function listLocations(env) {
  const result = await env.DB.prepare(`
    SELECT l.*,
           (SELECT COUNT(*) FROM assets a WHERE a.location_id = l.id AND a.status != 'disposed') as asset_count
    FROM locations l
    ORDER BY l.name ASC
  `).all();

  return json({ data: result.results });
}

async function getLocation(env, locationId) {
  const location = await env.DB.prepare('SELECT * FROM locations WHERE id = ?').bind(locationId).first();
  if (!location) return json({ error: 'Location not found' }, 404);

  const assets = await env.DB.prepare(`
    SELECT a.*, c.name as category_name, p.name as assigned_to_name
    FROM assets a
    LEFT JOIN categories c ON a.category_id = c.id
    LEFT JOIN people p ON a.assigned_to = p.id
    WHERE a.location_id = ? AND a.status != 'disposed'
    ORDER BY a.asset_tag ASC
  `).bind(locationId).all();

  return json({ ...location, assets: assets.results });
}

async function createLocation(request, env) {
  const data = await body(request);
  if (!data.name) return json({ error: 'Name is required' }, 400);

  const locationId = id();
  await env.DB.prepare(`
    INSERT INTO locations (id, name, address, type, notes, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(locationId, data.name, data.address || null, data.type || 'office', data.notes || null, now()).run();

  return json({ id: locationId }, 201);
}

async function updateLocation(request, env, locationId) {
  const existing = await env.DB.prepare('SELECT * FROM locations WHERE id = ?').bind(locationId).first();
  if (!existing) return json({ error: 'Location not found' }, 404);

  const data = await body(request);
  await env.DB.prepare(`
    UPDATE locations SET name = ?, address = ?, type = ?, notes = ? WHERE id = ?
  `).bind(
    data.name !== undefined ? data.name : existing.name,
    data.address !== undefined ? data.address : existing.address,
    data.type !== undefined ? data.type : existing.type,
    data.notes !== undefined ? data.notes : existing.notes,
    locationId
  ).run();

  return json({ ok: true });
}

async function deleteLocation(request, env, locationId) {
  const existing = await env.DB.prepare('SELECT * FROM locations WHERE id = ?').bind(locationId).first();
  if (!existing) return json({ error: 'Location not found' }, 404);

  const count = await env.DB.prepare(
    "SELECT COUNT(*) as c FROM assets WHERE location_id = ? AND status != 'disposed'"
  ).bind(locationId).first();

  if (count.c > 0) return json({ error: 'Cannot delete location with assigned assets' }, 400);

  const user = request._user;
  const performed_by = user ? (user.display_name || user.email) : null;

  await env.DB.prepare('DELETE FROM locations WHERE id = ?').bind(locationId).run();

  await logActivity(env, {
    action: 'delete_location',
    details: `Deleted location: ${existing.name}`,
    performed_by
  });

  return json({ ok: true });
}

// ─── Categories ────────────────────────────────────────

async function listCategories(env) {
  const result = await env.DB.prepare(`
    SELECT c.*,
           (SELECT COUNT(*) FROM assets a WHERE a.category_id = c.id AND a.status != 'disposed') as asset_count,
           pc.name as parent_name
    FROM categories c
    LEFT JOIN categories pc ON c.parent_id = pc.id
    ORDER BY COALESCE(c.parent_id, c.id), c.parent_id IS NOT NULL, c.name ASC
  `).all();

  // Build hierarchy
  const parents = result.results.filter(c => !c.parent_id);
  const children = result.results.filter(c => c.parent_id);

  const tree = parents.map(p => ({
    ...p,
    children: children.filter(c => c.parent_id === p.id)
  }));

  return json({ data: tree, flat: result.results });
}

async function createCategory(request, env) {
  const data = await body(request);
  if (!data.name || !data.prefix) return json({ error: 'name and prefix are required' }, 400);

  const categoryId = id();
  await env.DB.prepare(`
    INSERT INTO categories (id, name, prefix, parent_id, icon, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(categoryId, data.name, data.prefix, data.parent_id || null, data.icon || null, now()).run();

  return json({ id: categoryId }, 201);
}

async function updateCategory(request, env, categoryId) {
  const existing = await env.DB.prepare('SELECT * FROM categories WHERE id = ?').bind(categoryId).first();
  if (!existing) return json({ error: 'Category not found' }, 404);

  const data = await body(request);
  await env.DB.prepare(`
    UPDATE categories SET name = ?, prefix = ?, parent_id = ?, icon = ? WHERE id = ?
  `).bind(
    data.name !== undefined ? data.name : existing.name,
    data.prefix !== undefined ? data.prefix : existing.prefix,
    data.parent_id !== undefined ? data.parent_id : existing.parent_id,
    data.icon !== undefined ? data.icon : existing.icon,
    categoryId
  ).run();

  return json({ ok: true });
}

async function deleteCategory(request, env, categoryId) {
  const existing = await env.DB.prepare('SELECT * FROM categories WHERE id = ?').bind(categoryId).first();
  if (!existing) return json({ error: 'Category not found' }, 404);

  const count = await env.DB.prepare(
    "SELECT COUNT(*) as c FROM assets WHERE category_id = ? AND status != 'disposed'"
  ).bind(categoryId).first();

  if (count.c > 0) return json({ error: 'Cannot delete category with assigned assets' }, 400);

  // Also check for children
  const children = await env.DB.prepare('SELECT COUNT(*) as c FROM categories WHERE parent_id = ?').bind(categoryId).first();
  if (children.c > 0) return json({ error: 'Cannot delete category with subcategories' }, 400);

  const user = request._user;
  const performed_by = user ? (user.display_name || user.email) : null;

  await env.DB.prepare('DELETE FROM categories WHERE id = ?').bind(categoryId).run();

  await logActivity(env, {
    action: 'delete_category',
    details: `Deleted category: ${existing.name} (${existing.prefix})`,
    performed_by
  });

  return json({ ok: true });
}

// ─── Activity Log ──────────────────────────────────────

async function listActivity(env, url) {
  const params = url.searchParams;
  let where = [];
  let binds = [];

  if (params.get('asset_id')) {
    where.push('al.asset_id = ?');
    binds.push(params.get('asset_id'));
  }

  const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const limit = Math.min(200, parseInt(params.get('limit')) || 50);

  const result = await env.DB.prepare(`
    SELECT al.*, a.asset_tag, a.name as asset_name, p.name as person_name, l.name as location_name
    FROM activity_log al
    LEFT JOIN assets a ON al.asset_id = a.id
    LEFT JOIN people p ON al.person_id = p.id
    LEFT JOIN locations l ON al.location_id = l.id
    ${whereClause}
    ORDER BY al.created_at DESC
    LIMIT ?
  `).bind(...binds, limit).all();

  return json({ data: result.results });
}

// ─── Audits ────────────────────────────────────────────

async function listAudits(env) {
  const result = await env.DB.prepare(
    'SELECT * FROM audits ORDER BY started_at DESC'
  ).all();
  return json({ data: result.results });
}

async function startAudit(request, env) {
  const data = await body(request);

  // Get all non-disposed assets (optionally filter by category)
  let query = "SELECT id FROM assets WHERE status != 'disposed'";
  const binds = [];
  if (data.category_id) {
    query += " AND category_id = ?";
    binds.push(data.category_id);
  }
  const assets = await env.DB.prepare(query).bind(...binds).all();

  const auditId = id();
  const ts = now();

  await env.DB.prepare(`
    INSERT INTO audits (id, status, started_at, notes, total_expected)
    VALUES (?, 'in_progress', ?, ?, ?)
  `).bind(auditId, ts, data.notes || null, assets.results.length).run();

  for (const asset of assets.results) {
    await env.DB.prepare(`
      INSERT INTO audit_items (id, audit_id, asset_id, status)
      VALUES (?, ?, ?, 'pending')
    `).bind(id(), auditId, asset.id).run();
  }

  return json({ id: auditId, total_expected: assets.results.length }, 201);
}

async function getAudit(env, auditId) {
  const audit = await env.DB.prepare(
    'SELECT * FROM audits WHERE id = ?'
  ).bind(auditId).first();

  if (!audit) return json({ error: 'Audit not found' }, 404);

  const items = await env.DB.prepare(`
    SELECT ai.*, a.asset_tag, a.name as asset_name, a.serial_number
    FROM audit_items ai
    LEFT JOIN assets a ON ai.asset_id = a.id
    WHERE ai.audit_id = ?
    ORDER BY ai.status ASC, a.asset_tag ASC
  `).bind(auditId).all();

  return json({ ...audit, items: items.results });
}

async function scanAuditItem(request, env, auditId) {
  const data = await body(request);

  // Find asset by id or tag
  let assetId = data.asset_id;
  if (!assetId && data.asset_tag) {
    const asset = await env.DB.prepare('SELECT id FROM assets WHERE asset_tag = ?').bind(data.asset_tag).first();
    if (!asset) return json({ error: 'Asset not found with that tag' }, 404);
    assetId = asset.id;
  }
  if (!assetId) return json({ error: 'asset_id or asset_tag is required' }, 400);

  // Check if this asset is in the audit
  const item = await env.DB.prepare(
    'SELECT * FROM audit_items WHERE audit_id = ? AND asset_id = ?'
  ).bind(auditId, assetId).first();

  const ts = now();

  if (item) {
    if (item.status === 'found') {
      return json({ status: 'already_scanned', asset_id: assetId });
    }
    await env.DB.prepare(
      "UPDATE audit_items SET status = 'found', scanned_at = ?, notes = ? WHERE id = ?"
    ).bind(ts, data.notes || null, item.id).run();

    // Update audit counts
    await env.DB.prepare(
      "UPDATE audits SET total_found = (SELECT COUNT(*) FROM audit_items WHERE audit_id = ? AND status = 'found') WHERE id = ?"
    ).bind(auditId, auditId).run();

    return json({ status: 'found', asset_id: assetId });
  } else {
    // Asset not expected at this location — mark as moved/unexpected
    await env.DB.prepare(`
      INSERT INTO audit_items (id, audit_id, asset_id, status, scanned_at, notes)
      VALUES (?, ?, ?, 'moved', ?, ?)
    `).bind(id(), auditId, assetId, ts, data.notes || 'Not expected at this location').run();

    return json({ status: 'unexpected', asset_id: assetId });
  }
}

async function completeAudit(env, auditId) {
  const audit = await env.DB.prepare('SELECT * FROM audits WHERE id = ?').bind(auditId).first();
  if (!audit) return json({ error: 'Audit not found' }, 404);
  if (audit.status === 'completed') return json({ error: 'Audit already completed' }, 400);

  // Mark remaining pending items as missing
  await env.DB.prepare(
    "UPDATE audit_items SET status = 'missing' WHERE audit_id = ? AND status = 'pending'"
  ).bind(auditId).run();

  const found = await env.DB.prepare(
    "SELECT COUNT(*) as c FROM audit_items WHERE audit_id = ? AND status = 'found'"
  ).bind(auditId).first();

  const missing = await env.DB.prepare(
    "SELECT COUNT(*) as c FROM audit_items WHERE audit_id = ? AND status = 'missing'"
  ).bind(auditId).first();

  const ts = now();
  await env.DB.prepare(`
    UPDATE audits SET status = 'completed', completed_at = ?, total_found = ?, total_missing = ?
    WHERE id = ?
  `).bind(ts, found.c, missing.c, auditId).run();

  return json({ ok: true, total_found: found.c, total_missing: missing.c });
}

async function deleteAudit(env, auditId) {
  await env.DB.prepare('DELETE FROM audit_items WHERE audit_id = ?').bind(auditId).run();
  await env.DB.prepare('DELETE FROM audits WHERE id = ?').bind(auditId).run();
  return json({ ok: true });
}

// ─── Stats ─────────────────────────────────────────────

async function getStats(env) {
  // Run all queries in parallel via batch
  const [byStatusRes, byCategoryRes, byLocationRes, totalRes, warrantyAlerts, recentActivity] = await env.DB.batch([
    env.DB.prepare("SELECT status, COUNT(*) as count FROM assets WHERE status != 'disposed' GROUP BY status"),
    env.DB.prepare("SELECT c.name, c.icon, COUNT(a.id) as count FROM categories c LEFT JOIN assets a ON a.category_id = c.id AND a.status != 'disposed' WHERE c.parent_id IS NOT NULL GROUP BY c.id ORDER BY count DESC"),
    env.DB.prepare("SELECT l.name, COUNT(a.id) as count FROM locations l LEFT JOIN assets a ON a.location_id = l.id AND a.status != 'disposed' GROUP BY l.id ORDER BY count DESC"),
    env.DB.prepare("SELECT COUNT(*) as count FROM assets WHERE status != 'disposed'"),
    env.DB.prepare("SELECT a.id, a.asset_tag, a.name, a.warranty_expiry, CAST(julianday(a.warranty_expiry) - julianday('now') AS INTEGER) as days_remaining FROM assets a WHERE a.warranty_expiry IS NOT NULL AND a.status != 'disposed' AND julianday(a.warranty_expiry) > julianday('now') AND julianday(a.warranty_expiry) <= julianday('now', '+90 days') ORDER BY a.warranty_expiry ASC"),
    env.DB.prepare("SELECT al.*, a.asset_tag, a.name as asset_name, p.name as person_name FROM activity_log al LEFT JOIN assets a ON al.asset_id = a.id LEFT JOIN people p ON al.person_id = p.id ORDER BY al.created_at DESC LIMIT 10")
  ]);

  return json({
    total: totalRes.results[0].count,
    by_status: byStatusRes.results,
    by_category: byCategoryRes.results,
    by_location: byLocationRes.results,
    warranty_alerts: warrantyAlerts.results,
    recent_activity: recentActivity.results
  });
}

// ─── Reports ──────────────────────────────────────────

async function getReports(env) {
  const q = (fn) => fn().catch(e => { console.error(e); return null; });

  const [
    byStatus,
    byCategory,
    byDepartment,
    topAssigned,
    ageDistribution,
    costSummary,
    costByCategory,
    recentlyAdded,
    disposedCount,
    byOS,
    byManufacturer
  ] = await Promise.all([
    q(() => env.DB.prepare(
      "SELECT status, COUNT(*) as count FROM assets GROUP BY status ORDER BY count DESC"
    ).all()),

    q(() => env.DB.prepare(`
      SELECT c.name, c.icon, c.prefix, COUNT(a.id) as count,
             SUM(CASE WHEN a.status='deployed' THEN 1 ELSE 0 END) as deployed,
             SUM(CASE WHEN a.status='available' THEN 1 ELSE 0 END) as available,
             SUM(CASE WHEN a.status='maintenance' THEN 1 ELSE 0 END) as maintenance
      FROM categories c
      LEFT JOIN assets a ON a.category_id = c.id AND a.status != 'disposed'
      GROUP BY c.id
      ORDER BY count DESC
    `).all()),

    q(() => env.DB.prepare(`
      SELECT COALESCE(p.department, 'Unassigned') as department, COUNT(a.id) as count
      FROM assets a
      LEFT JOIN people p ON a.assigned_to = p.id
      WHERE a.status = 'deployed'
      GROUP BY department
      ORDER BY count DESC
    `).all()),

    q(() => env.DB.prepare(`
      SELECT p.name, p.department, COUNT(a.id) as count
      FROM people p
      INNER JOIN assets a ON a.assigned_to = p.id AND a.status = 'deployed'
      GROUP BY p.id
      ORDER BY count DESC
      LIMIT 15
    `).all()),

    q(() => env.DB.prepare(`
      SELECT
        CASE
          WHEN purchase_date IS NULL THEN 'Unknown'
          WHEN julianday('now') - julianday(purchase_date) < 365 THEN '< 1 year'
          WHEN julianday('now') - julianday(purchase_date) < 730 THEN '1-2 years'
          WHEN julianday('now') - julianday(purchase_date) < 1095 THEN '2-3 years'
          WHEN julianday('now') - julianday(purchase_date) < 1825 THEN '3-5 years'
          ELSE '5+ years'
        END as age_group,
        COUNT(*) as count
      FROM assets
      WHERE status != 'disposed'
      GROUP BY age_group
      ORDER BY
        CASE age_group
          WHEN '< 1 year' THEN 1 WHEN '1-2 years' THEN 2 WHEN '2-3 years' THEN 3
          WHEN '3-5 years' THEN 4 WHEN '5+ years' THEN 5 ELSE 6
        END
    `).all()),

    q(() => env.DB.prepare(`
      SELECT COUNT(*) as total_assets, SUM(purchase_cost) as total_cost,
             AVG(purchase_cost) as avg_cost, MAX(purchase_cost) as max_cost
      FROM assets WHERE status != 'disposed' AND purchase_cost IS NOT NULL AND purchase_cost > 0
    `).first()),

    q(() => env.DB.prepare(`
      SELECT c.name, c.icon, SUM(a.purchase_cost) as total_cost, COUNT(a.id) as count
      FROM categories c
      INNER JOIN assets a ON a.category_id = c.id AND a.status != 'disposed' AND a.purchase_cost > 0
      GROUP BY c.id ORDER BY total_cost DESC
    `).all()),

    q(() => env.DB.prepare(
      "SELECT COUNT(*) as count FROM assets WHERE created_at >= datetime('now', '-30 days')"
    ).first()),

    q(() => env.DB.prepare(
      "SELECT COUNT(*) as count FROM assets WHERE status = 'disposed'"
    ).first()),

    q(() => env.DB.prepare(`
      SELECT COALESCE(os, 'Not enrolled') as os, COUNT(*) as count
      FROM assets WHERE status != 'disposed' GROUP BY os ORDER BY count DESC
    `).all()),

    q(() => env.DB.prepare(`
      SELECT COALESCE(manufacturer, 'Unknown') as manufacturer, COUNT(*) as count
      FROM assets WHERE status != 'disposed' GROUP BY manufacturer ORDER BY count DESC LIMIT 10
    `).all())
  ]);

  return json({
    by_status: (byStatus && byStatus.results) || [],
    by_category: (byCategory && byCategory.results) || [],
    by_department: (byDepartment && byDepartment.results) || [],
    top_assigned: (topAssigned && topAssigned.results) || [],
    age_distribution: (ageDistribution && ageDistribution.results) || [],
    cost_summary: costSummary || {},
    cost_by_category: (costByCategory && costByCategory.results) || [],
    recently_added: (recentlyAdded && recentlyAdded.count) || 0,
    disposed_count: (disposedCount && disposedCount.count) || 0,
    by_os: (byOS && byOS.results) || [],
    by_manufacturer: (byManufacturer && byManufacturer.results) || []
  });
}

// ─── CSV Import ────────────────────────────────────────

async function importCSV(request, env) {
  const text = await request.text();
  const lines = text.split('\n').filter(l => l.trim());
  if (lines.length < 2) return json({ error: 'CSV must have a header row and at least one data row' }, 400);

  const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/['"]/g, ''));
  const results = { created: 0, skipped: 0, errors: [] };

  // Cache lookups for case-insensitive matching
  const categoryCache = {};
  const locationCache = {};
  const personCache = {};

  const categories = await env.DB.prepare('SELECT id, name, prefix FROM categories').all();
  for (const c of categories.results) {
    categoryCache[c.name.trim().toLowerCase()] = c.id;
  }

  const locations = await env.DB.prepare('SELECT id, name FROM locations').all();
  for (const l of locations.results) {
    locationCache[l.name.trim().toLowerCase()] = l.id;
  }

  const people = await env.DB.prepare('SELECT id, name FROM people').all();
  for (const p of people.results) {
    personCache[p.name.trim().toLowerCase()] = p.id;
  }

  for (let i = 1; i < lines.length; i++) {
    try {
      const values = parseCSVLine(lines[i]);
      const row = {};
      headers.forEach((h, idx) => { row[h] = values[idx]?.trim().replace(/^['"]|['"]$/g, '') || ''; });

      if (!row.name) {
        results.errors.push(`Row ${i + 1}: missing name`);
        results.skipped++;
        continue;
      }

      // Check for duplicate asset tag
      if (row.asset_tag) {
        const existing = await env.DB.prepare('SELECT id FROM assets WHERE asset_tag = ?').bind(row.asset_tag).first();
        if (existing) {
          results.skipped++;
          continue;
        }
      }

      // Resolve category (case-insensitive)
      let categoryId = null;
      if (row.category) {
        const key = row.category.trim().toLowerCase();
        if (categoryCache[key]) {
          categoryId = categoryCache[key];
        } else {
          // Auto-create category
          categoryId = id();
          const prefix = row.category.trim().substring(0, 2).toUpperCase();
          await env.DB.prepare(
            'INSERT INTO categories (id, name, prefix, created_at) VALUES (?, ?, ?, ?)'
          ).bind(categoryId, row.category.trim(), prefix, now()).run();
          categoryCache[key] = categoryId;
        }
      }

      // Resolve location (case-insensitive)
      let locationId = null;
      if (row.location) {
        const key = row.location.trim().toLowerCase();
        if (locationCache[key]) {
          locationId = locationCache[key];
        } else {
          locationId = id();
          await env.DB.prepare(
            'INSERT INTO locations (id, name, created_at) VALUES (?, ?, ?)'
          ).bind(locationId, row.location.trim(), now()).run();
          locationCache[key] = locationId;
        }
      }

      // Resolve person (case-insensitive)
      let personId = null;
      if (row.assigned_to) {
        const key = row.assigned_to.trim().toLowerCase();
        if (personCache[key]) {
          personId = personCache[key];
        } else {
          personId = id();
          await env.DB.prepare(
            'INSERT INTO people (id, name, created_at) VALUES (?, ?, ?)'
          ).bind(personId, row.assigned_to.trim(), now()).run();
          personCache[key] = personId;
        }
      }

      // Generate tag if not provided
      const tag = row.asset_tag || await generateTag(env, categoryId);

      // Calculate warranty expiry
      let warrantyExpiry = null;
      if (row.purchase_date && row.warranty_months) {
        const d = new Date(row.purchase_date);
        d.setMonth(d.getMonth() + parseInt(row.warranty_months));
        warrantyExpiry = d.toISOString().slice(0, 10);
      }

      const ts = now();
      const status = row.status || (personId ? 'deployed' : 'available');

      await env.DB.prepare(`
        INSERT INTO assets (id, asset_tag, name, serial_number, category_id, manufacturer, model, status,
          purchase_date, purchase_cost, purchase_order, supplier, warranty_months, warranty_expiry,
          notes, location_id, assigned_to, assigned_date, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        id(), tag, row.name, row.serial_number || null, categoryId,
        row.manufacturer || null, row.model || null, status,
        row.purchase_date || null, row.purchase_cost ? parseFloat(row.purchase_cost) : null,
        row.purchase_order || null, row.supplier || null,
        row.warranty_months ? parseInt(row.warranty_months) : null, warrantyExpiry,
        row.notes || null, locationId, personId, personId ? ts : null, ts, ts
      ).run();

      results.created++;
    } catch (err) {
      results.errors.push(`Row ${i + 1}: ${err.message}`);
      results.skipped++;
    }
  }

  return json(results);
}

// Simple CSV line parser that handles quoted fields
function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"' && !inQuotes) {
      inQuotes = true;
    } else if (ch === '"' && inQuotes) {
      if (i + 1 < line.length && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = false;
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

// ─── CSV Export ────────────────────────────────────────

async function exportCSV(env, url) {
  const params = url.searchParams;
  let where = ["a.status != 'disposed'"];
  let binds = [];

  if (params.get('status')) {
    where = ['a.status = ?'];
    binds = [params.get('status')];
  }

  const result = await env.DB.prepare(`
    SELECT a.asset_tag, a.name, a.serial_number, c.name as category, a.manufacturer, a.model,
           a.status, a.purchase_date, a.purchase_cost, a.purchase_order, a.supplier,
           a.warranty_months, a.warranty_expiry, l.name as location, p.name as assigned_to, a.notes
    FROM assets a
    LEFT JOIN categories c ON a.category_id = c.id
    LEFT JOIN locations l ON a.location_id = l.id
    LEFT JOIN people p ON a.assigned_to = p.id
    WHERE ${where.join(' AND ')}
    ORDER BY a.asset_tag ASC
  `).bind(...binds).all();

  const headers = ['asset_tag', 'name', 'serial_number', 'category', 'manufacturer', 'model', 'status',
    'purchase_date', 'purchase_cost', 'purchase_order', 'supplier', 'warranty_months', 'warranty_expiry',
    'location', 'assigned_to', 'notes'];

  let csv = headers.join(',') + '\n';
  for (const row of result.results) {
    csv += headers.map(h => {
      const val = row[h] ?? '';
      return typeof val === 'string' && (val.includes(',') || val.includes('"') || val.includes('\n'))
        ? '"' + val.replace(/"/g, '""') + '"'
        : val;
    }).join(',') + '\n';
  }

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': 'attachment; filename="wsc-assets-export.csv"',
      ...CORS_HEADERS
    }
  });
}

// ─── R2 Image Handling ─────────────────────────────────

const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

// Only allow safe R2 keys: two path segments (assetId/filename), ASCII letters/
// digits/dots/dashes/underscores. Blocks path traversal, absolute paths, and
// overwrites of arbitrary keys.
// Delete an R2 image blob given an /images/<assetId>/<file> URL (as stored in
// assets.image_url). Silently no-ops if the binding isn't configured or the
// URL is empty/invalid. Errors during the R2 delete are swallowed — orphaned
// blobs are a storage-hygiene issue, not one that should block the asset
// mutation that triggered the cleanup.
async function deleteImageByUrl(env, imageUrl) {
  if (!env.IMAGES || !imageUrl) return;
  const prefix = '/images/';
  if (!imageUrl.startsWith(prefix)) return;
  const key = safeImageKey(imageUrl.slice(prefix.length));
  if (!key) return;
  try {
    await env.IMAGES.delete(key);
  } catch (err) {
    console.error('deleteImageByUrl failed:', err && err.message);
  }
}

function safeImageKey(key) {
  if (!key || key.length > 200) return null;
  if (!/^[A-Za-z0-9_\-]+\/[A-Za-z0-9_\-.]+$/.test(key)) return null;
  if (key.includes('..')) return null;
  return key;
}

async function handleImages(request, env, url) {
  if (!env.IMAGES) return json({ error: 'Image storage not configured' }, 503);

  const key = safeImageKey(url.pathname.replace('/images/', ''));
  if (!key) return json({ error: 'Invalid image key' }, 400);

  if (request.method === 'GET') {
    const object = await env.IMAGES.get(key);
    if (!object) return json({ error: 'Image not found' }, 404);

    return new Response(object.body, {
      headers: {
        'Content-Type': object.httpMetadata?.contentType || 'image/jpeg',
        'Cache-Control': 'public, max-age=31536000',
        ...CORS_HEADERS
      }
    });
  }

  // Mutating operations require an authenticated caller. authenticate() is
  // async — previously the `if (!authenticate(...))` check awaited nothing and
  // so always passed because a Promise is truthy.
  if (request.method === 'PUT' || request.method === 'POST' || request.method === 'DELETE') {
    const user = await authenticate(request, env);
    if (!user) return json({ error: 'Unauthorized' }, 401);

    if (request.method === 'DELETE') {
      await env.IMAGES.delete(key);
      return json({ ok: true });
    }

    const contentType = (request.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
    if (!ALLOWED_IMAGE_TYPES.has(contentType)) {
      return json({ error: 'Unsupported image type' }, 415);
    }

    const declaredLen = parseInt(request.headers.get('Content-Length') || '0', 10);
    if (declaredLen && declaredLen > MAX_IMAGE_BYTES) {
      return json({ error: 'Image too large' }, 413);
    }

    const imageData = await request.arrayBuffer();
    if (imageData.byteLength > MAX_IMAGE_BYTES) {
      return json({ error: 'Image too large' }, 413);
    }

    await env.IMAGES.put(key, imageData, { httpMetadata: { contentType } });
    return json({ url: `/images/${key}` }, 201);
  }

  return json({ error: 'Method not allowed' }, 405);
}

// ─── Entra ID User Sync ──────────────────────────────

async function syncEntraUsers(request, env) {
  // All three Entra credentials are Worker secrets only — never accepted from
  // the request body. Previously the frontend let admins paste tenant/client/
  // secret into localStorage and post them here, which meant the secret lived
  // in the browser. Now the UI just triggers the sync and displays the
  // outcome; credentials stay on the server.
  const tenantId = env.ENTRA_TENANT_ID;
  const clientId = env.ENTRA_CLIENT_ID;
  const clientSecret = env.ENTRA_CLIENT_SECRET;

  if (!tenantId || !clientId || !clientSecret) {
    return json({
      error: 'Entra not configured. Set ENTRA_TENANT_ID, ENTRA_CLIENT_ID, and ENTRA_CLIENT_SECRET via `wrangler secret put` before running this sync.'
    }, 400);
  }

  const data = await body(request).catch(() => ({}));

  // Get access token via client credentials flow
  const tokenRes = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials',
    }),
  });

  if (!tokenRes.ok) {
    const err = await tokenRes.json().catch(() => ({}));
    return json({ error: 'Entra auth failed: ' + (err.error_description || err.error || tokenRes.statusText) }, 401);
  }

  const tokenData = await tokenRes.json();
  const accessToken = tokenData.access_token;

  // Fetch users from Microsoft Graph (paginated)
  let allUsers = [];
  let graphUrl = 'https://graph.microsoft.com/v1.0/users?$select=displayName,mail,userPrincipalName,jobTitle,department,mobilePhone,accountEnabled&$top=999';

  while (graphUrl) {
    const graphRes = await fetch(graphUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!graphRes.ok) {
      const err = await graphRes.json().catch(() => ({}));
      return json({ error: 'Graph API error: ' + (err.error?.message || graphRes.statusText) }, 502);
    }

    const graphData = await graphRes.json();
    allUsers = allUsers.concat(graphData.value || []);
    graphUrl = graphData['@odata.nextLink'] || null;
  }

  // Sync users into people table
  let created = 0;
  let updated = 0;
  let skipped = 0;
  const errors = [];

  const domain = data.domain || 'walgett.nsw.gov.au';

  for (const user of allUsers) {
    const email = user.mail || user.userPrincipalName;
    if (!email || !user.displayName) { skipped++; continue; }

    // Only import users with matching email domain
    if (!email.toLowerCase().endsWith('@' + domain.toLowerCase())) {
      skipped++;
      continue;
    }

    // Skip service accounts, room mailboxes, etc.
    if (email.startsWith('#') || email.includes('MailboxDiscovery') || user.displayName.startsWith('$')) {
      skipped++;
      continue;
    }

    try {
      // Check if person already exists by email
      const existing = await env.DB.prepare('SELECT id, name FROM people WHERE email = ?').bind(email).first();
      const ts = now();

      if (existing) {
        await env.DB.prepare(`
          UPDATE people SET
            name = ?, department = ?, position = ?, phone = ?, active = ?,
            source_system = 'entra', source_updated_at = ?
          WHERE id = ?
        `).bind(
          user.displayName,
          user.department || null,
          user.jobTitle || null,
          user.mobilePhone || null,
          user.accountEnabled ? 1 : 0,
          ts,
          existing.id
        ).run();
        updated++;
      } else {
        const personId = id();
        await env.DB.prepare(`
          INSERT INTO people
            (id, name, email, department, position, phone, active,
             source_system, source_updated_at, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'entra', ?, ?)
        `).bind(
          personId,
          user.displayName,
          email,
          user.department || null,
          user.jobTitle || null,
          user.mobilePhone || null,
          user.accountEnabled ? 1 : 0,
          ts,
          ts
        ).run();
        created++;
      }
    } catch (err) {
      errors.push(`${user.displayName}: ${err.message}`);
    }
  }

  // Deactivate Entra-sourced people whose email no longer matches the domain
  // filter. Soft delete (active=0) preserves their activity_log references
  // and lets a typo'd domain be reversed by running the sync again. The
  // `active = 1` guard makes the operation idempotent across runs.
  let deactivated = 0;
  try {
    const result = await env.DB.prepare(`
      UPDATE people SET active = 0
      WHERE source_system = 'entra'
      AND active = 1
      AND (email NOT LIKE ? OR email IS NULL)
    `).bind('%@' + domain.toLowerCase()).run();
    deactivated = result.meta?.changes || 0;
  } catch (err) {
    errors.push('Cleanup: ' + err.message);
  }

  return json({
    total_fetched: allUsers.length,
    created,
    updated,
    skipped,
    deactivated,
    errors: errors.slice(0, 20),
  });
}

// ─── AI Label Extraction ─────────────────────────────

const AI_EXTRACT_MAX_PER_HOUR = 30;

async function extractFromImage(request, env) {
  if (!env.ANTHROPIC_API_KEY) {
    return json({ error: 'Scan feature not configured' }, 503);
  }

  const contentType = (request.headers.get('Content-Type') || '').toLowerCase();
  if (!contentType.startsWith('image/')) {
    return json({ error: 'Image file required (Content-Type must be image/*)' }, 400);
  }

  const contentLength = parseInt(request.headers.get('Content-Length') || '0', 10);
  const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB
  if (contentLength > MAX_IMAGE_BYTES) {
    return json({ error: 'Image too large (max 5 MB)' }, 413);
  }

  const user = request._user;

  // Rate limit: 30 per user per hour
  const cutoff = new Date(Date.now() - 60 * 60 * 1000)
    .toLocaleString('sv-SE', { timeZone: 'Australia/Sydney' })
    .replace('T', ' ')
    .slice(0, 19);

  try {
    const rateCheck = await env.DB.prepare(`
      SELECT COUNT(*) as count FROM activity_log
      WHERE action = 'ai_extract' AND performed_by = ? AND created_at > ?
    `).bind(user.display_name, cutoff).first();

    if (rateCheck && rateCheck.count >= AI_EXTRACT_MAX_PER_HOUR) {
      return json({ error: 'Scan limit reached. Try again later.' }, 429);
    }
  } catch (e) { /* activity_log may not exist yet */ }

  const imageData = await request.arrayBuffer();
  if (imageData.byteLength > MAX_IMAGE_BYTES) {
    return json({ error: 'Image too large (max 5 MB)' }, 413);
  }

  const base64 = btoa(String.fromCharCode(...new Uint8Array(imageData)));
  const mediaType = contentType.includes('png') ? 'image/png' : 'image/jpeg';

  const SYSTEM_PROMPT = `You extract structured data from photos of IT device labels and stickers.
Given the image, identify and return the following fields as JSON. Use null
for any field you cannot read with confidence. Do not guess. Return only
the JSON object, no surrounding text.

Fields:
- manufacturer: string (e.g. "Dell", "HP", "Lenovo", "Cisco")
- model: string (e.g. "Latitude 5540", "EliteBook 840 G10")
- serial_number: string (the serial / service tag / S/N)
- mac_address: string in XX:XX:XX:XX:XX:XX format, or null
- part_number: string, or null
- category_hint: one of "laptop", "desktop", "monitor", "printer",
  "phone", "tablet", "switch", "router", "access_point", "server", "other"
- confidence: "high" | "medium" | "low"
- notes: string — anything useful, e.g. "label partially obscured"

Serial numbers often contain characters that look alike (0/O, 1/I, 5/S, 8/B).
Read carefully. If a character is ambiguous, set confidence to "medium"
or "low" and note the ambiguity.`;

  let anthropicRes;
  try {
    anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: [{
          role: 'user',
          content: [{
            type: 'image',
            source: { type: 'base64', media_type: mediaType, data: base64 }
          }]
        }]
      })
    });
  } catch (err) {
    console.error('Anthropic fetch error:', err);
    return json({ error: 'AI service unavailable' }, 502);
  }

  let rawText;
  try {
    const raw = await anthropicRes.text();
    rawText = raw;
    const data = JSON.parse(raw);
    if (!anthropicRes.ok) {
      console.error('Anthropic API error:', data);
      return json({ error: 'AI extraction failed' }, 502);
    }
    const text = data.content?.[0]?.text;
    if (!text) return json({ error: 'Empty response from AI' }, 502);

    // Strip markdown code fences (AI sometimes wraps JSON in ```json ... ```)
    let jsonText = text.trim();
    if (jsonText.startsWith('```')) {
      jsonText = jsonText.replace(/^```[a-z]*\n?/, '').replace(/\n?```$/, '').trim();
    }

    const extracted = JSON.parse(jsonText);
    const serial = extracted.serial_number?.trim() || null;

    // Dedup: check for existing non-disposed asset with same serial
    let duplicate_asset = null;
    if (serial) {
      const existing = await env.DB.prepare(
        "SELECT id, asset_tag, name FROM assets WHERE serial_number = ? AND status != 'disposed'"
      ).bind(serial).first();
      if (existing) {
        duplicate_asset = { id: existing.id, asset_tag: existing.asset_tag, name: existing.name };
      }
    }

    // Log the extraction
    const extractedFields = Object.entries(extracted)
      .filter(([, v]) => v !== null && v !== '')
      .map(([k]) => k)
      .join(', ');
    await logActivity(env, {
      action: 'ai_extract',
      details: `confidence=${extracted.confidence || 'unknown'}, fields: ${extractedFields || '(none)'}`,
      performed_by: user.display_name
    });

    return json({ extracted, duplicate_asset });

  } catch (err) {
    console.error('AI parse error:', err);
    const truncated = rawText ? rawText.slice(0, 500) : '(no response)';
    return json({ error: 'Failed to parse AI response', raw: truncated }, 502);
  }
}
