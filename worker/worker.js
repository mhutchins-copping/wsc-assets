// WSC IT Asset Management System — Cloudflare Worker API
// All endpoints require X-Api-Key header (except CORS preflight)

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // CORS preflight
    if (request.method === 'OPTIONS') return corsResponse();

    // Auth check for all /api/* routes
    if (url.pathname.startsWith('/api/')) {
      if (!authenticate(request, env)) {
        return json({ error: 'Unauthorized' }, 401);
      }
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
};

// ─── Auth ──────────────────────────────────────────────
// Abstracted into a single function for easy swap to Entra ID later

function authenticate(request, env) {
  const key = request.headers.get('X-Api-Key');
  return key && key === env.API_KEY;
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
    return deleteAsset(env, path.match(/^\/api\/assets\/([^/]+)$/)[1]);
  }
  if (path.match(/^\/api\/assets\/([^/]+)\/purge$/) && method === 'DELETE') {
    return purgeAsset(env, path.match(/^\/api\/assets\/([^/]+)\/purge$/)[1]);
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

  // Stats
  if (path === '/api/stats' && method === 'GET') return getStats(env);

  // Import / Export
  if (path === '/api/import/csv' && method === 'POST') return importCSV(request, env);
  if (path === '/api/export/csv' && method === 'GET') return exportCSV(env, url);

  return null;
}

// ─── Helpers ───────────────────────────────────────────

function id() {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function now() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

async function body(request) {
  return request.json();
}

async function logActivity(env, { asset_id, action, details, performed_by, person_id, location_id }) {
  await env.DB.prepare(
    `INSERT INTO activity_log (id, asset_id, action, details, performed_by, person_id, location_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id(), asset_id || null, action, details || null, performed_by || 'Matt', person_id || null, location_id || null, now()).run();
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
      notes, image_url, location_id, assigned_to, assigned_date, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    assetId, tag, data.name, data.serial_number || null, data.category_id || null,
    data.manufacturer || null, data.model || null, data.status || 'available',
    data.purchase_date || null, data.purchase_cost || null, data.purchase_order || null,
    data.supplier || null, data.warranty_months || null, warrantyExpiry,
    data.notes || null, data.image_url || null, data.location_id || null,
    data.assigned_to || null, data.assigned_to ? ts : null, ts, ts
  ).run();

  // If assigned on creation, set status to deployed
  if (data.assigned_to) {
    await env.DB.prepare('UPDATE assets SET status = ? WHERE id = ?').bind('deployed', assetId).run();
  }

  await logActivity(env, { asset_id: assetId, action: 'create', details: `Created asset ${tag}: ${data.name}` });

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
      warranty_months = ?, warranty_expiry = ?, notes = ?, image_url = ?, location_id = ?,
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
    data.location_id !== undefined ? data.location_id : existing.location_id,
    data.assigned_to !== undefined ? data.assigned_to : existing.assigned_to,
    data.assigned_to !== undefined && data.assigned_to !== existing.assigned_to ? ts : existing.assigned_date,
    ts,
    assetId
  ).run();

  // Build change summary
  const changes = [];
  for (const key of Object.keys(data)) {
    if (data[key] !== existing[key] && key !== 'updated_at') {
      changes.push(key);
    }
  }

  await logActivity(env, {
    asset_id: assetId,
    action: 'update',
    details: changes.length ? `Updated: ${changes.join(', ')}` : 'Updated asset'
  });

  return json({ ok: true });
}

async function deleteAsset(env, assetId) {
  const existing = await env.DB.prepare('SELECT * FROM assets WHERE id = ?').bind(assetId).first();
  if (!existing) return json({ error: 'Asset not found' }, 404);

  // Soft delete — set status to disposed
  await env.DB.prepare("UPDATE assets SET status = 'disposed', updated_at = ? WHERE id = ?").bind(now(), assetId).run();

  await logActivity(env, { asset_id: assetId, action: 'dispose', details: `Disposed asset ${existing.asset_tag}` });

  return json({ ok: true });
}

async function purgeAsset(env, assetId) {
  const existing = await env.DB.prepare('SELECT * FROM assets WHERE id = ?').bind(assetId).first();
  if (!existing) return json({ error: 'Asset not found' }, 404);

  await env.DB.prepare('DELETE FROM activity_log WHERE asset_id = ?').bind(assetId).run();
  await env.DB.prepare('DELETE FROM maintenance_log WHERE asset_id = ?').bind(assetId).run();
  await env.DB.prepare('DELETE FROM audit_items WHERE asset_id = ?').bind(assetId).run();
  await env.DB.prepare('DELETE FROM assets WHERE id = ?').bind(assetId).run();

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

  const person = await env.DB.prepare('SELECT name FROM people WHERE id = ?').bind(data.person_id).first();

  await logActivity(env, {
    asset_id: assetId,
    action: 'checkout',
    details: data.notes || `Checked out to ${person?.name || 'unknown'}`,
    person_id: data.person_id,
    location_id: data.location_id || asset.location_id
  });

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

  await logActivity(env, {
    asset_id: assetId,
    action: 'checkin',
    details: data.notes || `Checked in from ${person?.name || 'unknown'} (condition: ${condition})`,
    person_id: previousPerson,
    location_id: asset.location_id
  });

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
    data.cost || null, data.performed_by || 'Matt', data.date || now().slice(0, 10),
    data.next_due || null, now()
  ).run();

  await logActivity(env, {
    asset_id: assetId,
    action: 'maintenance',
    details: `${data.type}: ${data.description}`
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

  // Find the highest existing tag number for this prefix
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

async function nextTag(env, prefix) {
  const tag = await generateTag(env, null);
  // Use the provided prefix directly
  const fullPrefix = `${env.ASSET_TAG_PREFIX || 'WSC'}-${prefix}-`;
  const result = await env.DB.prepare(
    `SELECT asset_tag FROM assets WHERE asset_tag LIKE ? ORDER BY asset_tag DESC LIMIT 1`
  ).bind(fullPrefix + '%').first();

  let nextNum = 1;
  if (result) {
    const match = result.asset_tag.match(/-(\d+)$/);
    if (match) nextNum = parseInt(match[1]) + 1;
  }

  return json({ tag: fullPrefix + String(nextNum).padStart(4, '0') });
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
  const result = await env.DB.prepare(`
    SELECT au.*, l.name as location_name
    FROM audits au
    LEFT JOIN locations l ON au.location_id = l.id
    ORDER BY au.started_at DESC
  `).all();

  return json({ data: result.results });
}

async function startAudit(request, env) {
  const data = await body(request);
  if (!data.location_id) return json({ error: 'location_id is required' }, 400);

  // Get all assets at this location that aren't disposed
  const assets = await env.DB.prepare(
    "SELECT id FROM assets WHERE location_id = ? AND status != 'disposed'"
  ).bind(data.location_id).all();

  const auditId = id();
  const ts = now();

  await env.DB.prepare(`
    INSERT INTO audits (id, location_id, status, started_at, notes, total_expected)
    VALUES (?, ?, 'in_progress', ?, ?, ?)
  `).bind(auditId, data.location_id, ts, data.notes || null, assets.results.length).run();

  // Create audit items for each expected asset
  for (const asset of assets.results) {
    await env.DB.prepare(`
      INSERT INTO audit_items (id, audit_id, asset_id, status)
      VALUES (?, ?, ?, 'pending')
    `).bind(id(), auditId, asset.id).run();
  }

  return json({ id: auditId, total_expected: assets.results.length }, 201);
}

async function getAudit(env, auditId) {
  const audit = await env.DB.prepare(`
    SELECT au.*, l.name as location_name
    FROM audits au
    LEFT JOIN locations l ON au.location_id = l.id
    WHERE au.id = ?
  `).bind(auditId).first();

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

// ─── Stats ─────────────────────────────────────────────

async function getStats(env) {
  const byStatus = await env.DB.prepare(
    "SELECT status, COUNT(*) as count FROM assets WHERE status != 'disposed' GROUP BY status"
  ).all();

  const byCategory = await env.DB.prepare(`
    SELECT c.name, c.icon, COUNT(a.id) as count
    FROM categories c
    LEFT JOIN assets a ON a.category_id = c.id AND a.status != 'disposed'
    WHERE c.parent_id IS NOT NULL
    GROUP BY c.id
    ORDER BY count DESC
  `).all();

  const byLocation = await env.DB.prepare(`
    SELECT l.name, COUNT(a.id) as count
    FROM locations l
    LEFT JOIN assets a ON a.location_id = l.id AND a.status != 'disposed'
    GROUP BY l.id
    ORDER BY count DESC
  `).all();

  const total = await env.DB.prepare(
    "SELECT COUNT(*) as count FROM assets WHERE status != 'disposed'"
  ).first();

  // Warranty expiring in 30/60/90 days
  const warrantyAlerts = await env.DB.prepare(`
    SELECT a.id, a.asset_tag, a.name, a.warranty_expiry,
           CAST(julianday(a.warranty_expiry) - julianday('now') AS INTEGER) as days_remaining
    FROM assets a
    WHERE a.warranty_expiry IS NOT NULL
      AND a.status != 'disposed'
      AND julianday(a.warranty_expiry) > julianday('now')
      AND julianday(a.warranty_expiry) <= julianday('now', '+90 days')
    ORDER BY a.warranty_expiry ASC
  `).all();

  // Recent activity
  const recentActivity = await env.DB.prepare(`
    SELECT al.*, a.asset_tag, a.name as asset_name, p.name as person_name
    FROM activity_log al
    LEFT JOIN assets a ON al.asset_id = a.id
    LEFT JOIN people p ON al.person_id = p.id
    ORDER BY al.created_at DESC
    LIMIT 10
  `).all();

  return json({
    total: total.count,
    by_status: byStatus.results,
    by_category: byCategory.results,
    by_location: byLocation.results,
    warranty_alerts: warrantyAlerts.results,
    recent_activity: recentActivity.results
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

async function handleImages(request, env, url) {
  const key = url.pathname.replace('/images/', '');

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

  if (request.method === 'PUT' || request.method === 'POST') {
    if (!authenticate(request, env)) return json({ error: 'Unauthorized' }, 401);

    const contentType = request.headers.get('Content-Type') || 'image/jpeg';
    const imageData = await request.arrayBuffer();

    await env.IMAGES.put(key, imageData, {
      httpMetadata: { contentType }
    });

    return json({ url: `/images/${key}` }, 201);
  }

  if (request.method === 'DELETE') {
    if (!authenticate(request, env)) return json({ error: 'Unauthorized' }, 401);
    await env.IMAGES.delete(key);
    return json({ ok: true });
  }

  return json({ error: 'Method not allowed' }, 405);
}
