// WSC IT Asset Management System — Cloudflare Worker API
// Auth: SSO email identity (Cloudflare Access) mapped to internal users, or API key

import { notify } from './lib/notify.js';

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
// Two auth paths:
// 1. SSO email → internal user lookup (browser via Cloudflare Access)
// 2. API key (scripts/external access)

async function authenticate(request, env) {
  // Cloudflare Access injects this header at the edge and strips any client-sent
  // copy, so it cannot be spoofed. Never accept a user-controlled fallback here.
  const ssoEmail = request.headers.get('Cf-Access-Authenticated-User-Email');
  if (ssoEmail) {
    try {
      const user = await env.DB.prepare(
        'SELECT id, email, display_name, role FROM users WHERE email = ? AND active = 1'
      ).bind(ssoEmail.toLowerCase()).first();
      if (user) return user;
    } catch (e) { /* users table may not exist yet */ }
  }

  // 2. API key or master key auth
  const key = request.headers.get('X-Api-Key');
  if (key) {
    // Check API key (for scripts)
    if (env.API_KEY && key === env.API_KEY) return { email: 'api', display_name: 'API', role: 'admin' };
    // Check master key (for non-SSO browser access)
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

// ─── Auth Identity (SSO email → internal user lookup) ──

async function authIdentify(request, env) {
  const data = await body(request);
  const email = (data.email || '').toLowerCase().trim();

  if (!email) return json({ error: 'Email required' }, 400);

  try {
    const user = await env.DB.prepare(
      'SELECT id, email, display_name, role FROM users WHERE email = ? AND active = 1'
    ).bind(email).first();

    if (!user) {
      return json({ authorized: false, error: 'No access. Contact your IT administrator.' }, 403);
    }

    // Update last login
    await env.DB.prepare('UPDATE users SET last_login = ? WHERE id = ?').bind(now(), user.id).run();

    return json({
      authorized: true,
      user: { id: user.id, email: user.email, display_name: user.display_name, role: user.role }
    });
  } catch (e) {
    // Users table doesn't exist yet
    return json({ authorized: false, error: 'Database needs migration. Run the users migration in D1 Console.', needs_migration: true }, 500);
  }
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

    return json({
      authorized: true,
      user: { id: admin.id, email: admin.email, display_name: admin.display_name, role: admin.role }
    });
  } catch (e) {
    return json({ authorized: false, error: 'Database error: ' + e.message }, 500);
  }
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
  'Access-Control-Allow-Headers': 'Content-Type, X-Api-Key',
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

  // Assets
  if (path === '/api/assets' && method === 'GET') return listAssets(request, env, url);
  if (path === '/api/assets' && method === 'POST') return createAsset(request, env);
  if (path.match(/^\/api\/assets\/next-tag\/(.+)$/) && method === 'GET') {
    return nextTag(env, path.match(/^\/api\/assets\/next-tag\/(.+)$/)[1]);
  }
  if (path.match(/^\/api\/assets\/tag\/(.+)$/) && method === 'GET') {
    return getAssetByTag(env, decodeURIComponent(path.match(/^\/api\/assets\/tag\/(.+)$/)[1]));
  }
  if (path.match(/^\/api\/assets\/serial\/(.+)$/) && method === 'GET') {
    return getAssetBySerial(env, decodeURIComponent(path.match(/^\/api\/assets\/serial\/(.+)$/)[1]));
  }
  if (path.match(/^\/api\/assets\/([^/]+)\/checkout$/) && method === 'POST') {
    return checkoutAsset(request, env, path.match(/^\/api\/assets\/([^/]+)\/checkout$/)[1]);
  }
  if (path.match(/^\/api\/assets\/([^/]+)\/checkin$/) && method === 'POST') {
    return checkinAsset(request, env, path.match(/^\/api\/assets\/([^/]+)\/checkin$/)[1]);
  }
  if (path.match(/^\/api\/assets\/([^/]+)\/maintenance$/) && method === 'POST') {
    return addMaintenance(request, env, path.match(/^\/api\/assets\/([^/]+)\/maintenance$/)[1]);
  }
  if (path.match(/^\/api\/assets\/([^/]+)$/) && method === 'GET') {
    return getAsset(env, path.match(/^\/api\/assets\/([^/]+)$/)[1]);
  }
  if (path.match(/^\/api\/assets\/([^/]+)$/) && method === 'PUT') {
    return updateAsset(request, env, path.match(/^\/api\/assets\/([^/]+)$/)[1]);
  }
  if (path.match(/^\/api\/assets\/([^/]+)$/) && method === 'DELETE') {
    return deleteAsset(request, env, path.match(/^\/api\/assets\/([^/]+)$/)[1]);
  }
  if (path.match(/^\/api\/assets\/([^/]+)\/purge$/) && method === 'DELETE') {
    if (!isAdmin(request)) return json({ error: 'Admin access required' }, 403);
    return purgeAsset(request, env, path.match(/^\/api\/assets\/([^/]+)\/purge$/)[1]);
  }

  // AI-powered label extraction from photo
  if (path === '/api/assets/extract-from-image' && method === 'POST') {
    return extractFromImage(request, env);
  }

  // People
  if (path === '/api/people' && method === 'GET') return listPeople(request, env, url);
  if (path === '/api/people' && method === 'POST') return createPerson(request, env);
  if (path.match(/^\/api\/people\/([^/]+)$/) && method === 'GET') {
    return getPerson(env, path.match(/^\/api\/people\/([^/]+)$/)[1]);
  }
  if (path.match(/^\/api\/people\/([^/]+)$/) && method === 'PUT') {
    return updatePerson(request, env, path.match(/^\/api\/people\/([^/]+)$/)[1]);
  }
  if (path.match(/^\/api\/people\/([^/]+)$/) && method === 'DELETE') {
    return deletePerson(env, path.match(/^\/api\/people\/([^/]+)$/)[1]);
  }

  // Locations
  if (path === '/api/locations' && method === 'GET') return listLocations(env);
  if (path === '/api/locations' && method === 'POST') return createLocation(request, env);
  if (path.match(/^\/api\/locations\/([^/]+)$/) && method === 'GET') {
    return getLocation(env, path.match(/^\/api\/locations\/([^/]+)$/)[1]);
  }
  if (path.match(/^\/api\/locations\/([^/]+)$/) && method === 'PUT') {
    return updateLocation(request, env, path.match(/^\/api\/locations\/([^/]+)$/)[1]);
  }
  if (path.match(/^\/api\/locations\/([^/]+)$/) && method === 'DELETE') {
    return deleteLocation(env, path.match(/^\/api\/locations\/([^/]+)$/)[1]);
  }

  // Categories
  if (path === '/api/categories' && method === 'GET') return listCategories(env);
  if (path === '/api/categories' && method === 'POST') return createCategory(request, env);
  if (path.match(/^\/api\/categories\/([^/]+)$/) && method === 'PUT') {
    return updateCategory(request, env, path.match(/^\/api\/categories\/([^/]+)$/)[1]);
  }
  if (path.match(/^\/api\/categories\/([^/]+)$/) && method === 'DELETE') {
    return deleteCategory(env, path.match(/^\/api\/categories\/([^/]+)$/)[1]);
  }

  // Activity log
  if (path === '/api/activity' && method === 'GET') return listActivity(env, url);

  // Audits
  if (path === '/api/audits' && method === 'GET') return listAudits(env);
  if (path === '/api/audits' && method === 'POST') return startAudit(request, env);
  if (path.match(/^\/api\/audits\/([^/]+)\/scan$/) && method === 'POST') {
    return scanAuditItem(request, env, path.match(/^\/api\/audits\/([^/]+)\/scan$/)[1]);
  }
  if (path.match(/^\/api\/audits\/([^/]+)\/complete$/) && method === 'POST') {
    return completeAudit(env, path.match(/^\/api\/audits\/([^/]+)\/complete$/)[1]);
  }
  if (path.match(/^\/api\/audits\/([^/]+)$/) && method === 'GET') {
    return getAudit(env, path.match(/^\/api\/audits\/([^/]+)$/)[1]);
  }
  if (path.match(/^\/api\/audits\/([^/]+)$/) && method === 'DELETE') {
    return deleteAudit(env, path.match(/^\/api\/audits\/([^/]+)$/)[1]);
  }

  // Stats & Reports
  if (path === '/api/stats' && method === 'GET') return getStats(env);
  if (path === '/api/reports' && method === 'GET') return getReports(env);

  // Import / Export — mutate or reveal bulk data; admin only.
  if (path === '/api/import/csv' && method === 'POST') {
    if (!isAdmin(request)) return json({ error: 'Admin access required' }, 403);
    return importCSV(request, env);
  }
  if (path === '/api/export/csv' && method === 'GET') {
    if (!isAdmin(request)) return json({ error: 'Admin access required' }, 403);
    return exportCSV(env, url);
  }

  // Entra ID user sync — hits Microsoft Graph with tenant creds; admin only.
  if (path === '/api/people/sync-entra' && method === 'POST') {
    if (!isAdmin(request)) return json({ error: 'Admin access required' }, 403);
    return syncEntraUsers(request, env);
  }

  return null;
}

// ─── Helpers ───────────────────────────────────────────

function isAdmin(request) {
  return !!(request._user && request._user.role === 'admin');
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
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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

  // Atomic delete: all succeed or none do
  await env.DB.batch([
    env.DB.prepare('DELETE FROM activity_log WHERE asset_id = ?').bind(assetId),
    env.DB.prepare('DELETE FROM maintenance_log WHERE asset_id = ?').bind(assetId),
    env.DB.prepare('DELETE FROM audit_items WHERE asset_id = ?').bind(assetId),
    env.DB.prepare('DELETE FROM assets WHERE id = ?').bind(assetId)
  ]);

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

  return json({ ok: true });
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

  return json({ ok: true, status: newStatus });
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

async function deletePerson(env, personId) {
  const existing = await env.DB.prepare('SELECT * FROM people WHERE id = ?').bind(personId).first();
  if (!existing) return json({ error: 'Person not found' }, 404);

  // Soft delete
  await env.DB.prepare('UPDATE people SET active = 0 WHERE id = ?').bind(personId).run();
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

async function deleteLocation(env, locationId) {
  const count = await env.DB.prepare(
    "SELECT COUNT(*) as c FROM assets WHERE location_id = ? AND status != 'disposed'"
  ).bind(locationId).first();

  if (count.c > 0) return json({ error: 'Cannot delete location with assigned assets' }, 400);

  await env.DB.prepare('DELETE FROM locations WHERE id = ?').bind(locationId).run();
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

async function deleteCategory(env, categoryId) {
  const count = await env.DB.prepare(
    "SELECT COUNT(*) as c FROM assets WHERE category_id = ? AND status != 'disposed'"
  ).bind(categoryId).first();

  if (count.c > 0) return json({ error: 'Cannot delete category with assigned assets' }, 400);

  // Also check for children
  const children = await env.DB.prepare('SELECT COUNT(*) as c FROM categories WHERE parent_id = ?').bind(categoryId).first();
  if (children.c > 0) return json({ error: 'Cannot delete category with subcategories' }, 400);

  await env.DB.prepare('DELETE FROM categories WHERE id = ?').bind(categoryId).run();
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
    console.log('Image upload - key:', key, 'contentType:', contentType);
    if (!ALLOWED_IMAGE_TYPES.has(contentType)) {
      console.log('Image upload - rejected: unsupported type');
      return json({ error: 'Unsupported image type' }, 415);
    }

    const declaredLen = parseInt(request.headers.get('Content-Length') || '0', 10);
    if (declaredLen && declaredLen > MAX_IMAGE_BYTES) {
      console.log('Image upload - rejected: too large', declaredLen);
      return json({ error: 'Image too large' }, 413);
    }

    const imageData = await request.arrayBuffer();
    console.log('Image upload - received bytes:', imageData.byteLength);
    if (imageData.byteLength > MAX_IMAGE_BYTES) {
      return json({ error: 'Image too large' }, 413);
    }

    console.log('Image upload - saving to R2...');
    await env.IMAGES.put(key, imageData, { httpMetadata: { contentType } });
    console.log('Image upload - saved to R2:', key);
    return json({ url: `/images/${key}` }, 201);
  }

  return json({ error: 'Method not allowed' }, 405);
}

// ─── Entra ID User Sync ──────────────────────────────

async function syncEntraUsers(request, env) {
  const data = await body(request);
  const tenantId = data.tenant_id || env.ENTRA_TENANT_ID;
  const clientId = data.client_id || env.ENTRA_CLIENT_ID;
  const clientSecret = data.client_secret || env.ENTRA_CLIENT_SECRET;

  if (!tenantId || !clientId || !clientSecret) {
    return json({ error: 'Missing Entra config (tenant_id, client_id, client_secret)' }, 400);
  }

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

      if (existing) {
        // Update existing person
        await env.DB.prepare(`
          UPDATE people SET name = ?, department = ?, position = ?, phone = ?, active = ?
          WHERE id = ?
        `).bind(
          user.displayName,
          user.department || null,
          user.jobTitle || null,
          user.mobilePhone || null,
          user.accountEnabled ? 1 : 0,
          existing.id
        ).run();
        updated++;
      } else {
        // Create new person
        const personId = id();
        await env.DB.prepare(`
          INSERT INTO people (id, name, email, department, position, phone, active, notes, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          personId,
          user.displayName,
          email,
          user.department || null,
          user.jobTitle || null,
          user.mobilePhone || null,
          user.accountEnabled ? 1 : 0,
          'Imported from Entra ID',
          now()
        ).run();
        created++;
      }
    } catch (err) {
      errors.push(`${user.displayName}: ${err.message}`);
    }
  }

  // Delete people imported from Entra that don't match the domain filter
  let deleted = 0;
  try {
    const result = await env.DB.prepare(`
      DELETE FROM people WHERE notes = 'Imported from Entra ID'
      AND (email NOT LIKE ? OR email IS NULL)
    `).bind('%@' + domain.toLowerCase()).run();
    deleted = result.meta?.changes || 0;
  } catch (err) {
    errors.push('Cleanup: ' + err.message);
  }

  return json({
    total_fetched: allUsers.length,
    created,
    updated,
    skipped,
    deleted,
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
