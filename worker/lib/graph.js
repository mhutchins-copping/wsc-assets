// ─── Microsoft Graph Helper ──────────────────────────
// Centralised Graph access token + request wrapper. Token is cached in
// Workers KV (binding `KV_GRAPH`) for `expires_in - 60s` so the wizard
// flows that fan out 5-10 Graph calls per click don't burn AAD's
// /oauth2/v2.0/token rate limit. If KV_GRAPH isn't bound (e.g. local
// dev, first-deploy before the namespace is created) the cache is
// silently bypassed — same behaviour as before this module existed.
//
// Existing call sites in lib/notify.js and the inline copy in
// syncEntraUsers were refactored to use getGraphTokenCached(env). The
// function returns the access_token string, matching the previous
// getGraphToken() signature.

const TOKEN_KV_KEY = 'graph_token_v1';
const TOKEN_REFRESH_BUFFER_MS = 60_000;

async function fetchFreshToken(env) {
  const tenantId = env.ENTRA_TENANT_ID;
  const clientId = env.ENTRA_CLIENT_ID;
  const clientSecret = env.ENTRA_CLIENT_SECRET;

  if (!tenantId || !clientId || !clientSecret) {
    throw new Error('Missing Entra config (ENTRA_TENANT_ID, ENTRA_CLIENT_ID, ENTRA_CLIENT_SECRET)');
  }

  const res = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials',
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error('Entra auth failed: ' + (err.error_description || err.error || res.statusText));
  }

  return res.json();
}

export async function getGraphTokenCached(env) {
  const kv = env.KV_GRAPH;

  if (kv) {
    try {
      const cached = await kv.get(TOKEN_KV_KEY, 'json');
      if (cached && cached.access_token && cached.expires_at > Date.now() + TOKEN_REFRESH_BUFFER_MS) {
        return cached.access_token;
      }
    } catch (e) {
      console.warn('graph: KV cache read failed, falling back to fresh fetch:', e.message);
    }
  }

  const fresh = await fetchFreshToken(env);

  if (kv && fresh.expires_in) {
    try {
      const ttl = Math.max(60, fresh.expires_in - 60);
      await kv.put(TOKEN_KV_KEY, JSON.stringify({
        access_token: fresh.access_token,
        expires_at: Date.now() + (fresh.expires_in * 1000),
      }), { expirationTtl: ttl });
    } catch (e) {
      console.warn('graph: KV cache write failed:', e.message);
    }
  }

  return fresh.access_token;
}

// Compatibility alias — keeps lib/notify.js's old import name working
// without forcing a rename in the callers.
export const getGraphToken = getGraphTokenCached;

// Wrapped Graph fetch with one 401 retry (token race after rotation),
// exponential backoff on 429, and structured error messages. Used by
// lib/intune.js. All Intune endpoints live under /beta — pass the full
// URL.
export async function fetchGraph(env, method, url, body, opts = {}) {
  const maxRetries = opts.maxRetries ?? 2;
  let attempt = 0;
  let lastErr;

  while (attempt <= maxRetries) {
    const token = await getGraphTokenCached(env);
    const headers = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    };

    let res;
    try {
      res = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      lastErr = e;
      attempt++;
      await sleep(250 * Math.pow(2, attempt));
      continue;
    }

    if (res.status === 401 && attempt === 0) {
      // Token may have just been rotated — bust the cache and retry once.
      try { await env.KV_GRAPH?.delete(TOKEN_KV_KEY); } catch {}
      attempt++;
      continue;
    }

    if (res.status === 429) {
      const retryAfterSec = parseInt(res.headers.get('Retry-After') || '1', 10);
      await sleep(Math.min(8000, (retryAfterSec * 1000) + (250 * Math.pow(2, attempt))));
      attempt++;
      continue;
    }

    if (!res.ok) {
      let errBody;
      try { errBody = await res.json(); } catch { errBody = await res.text().catch(() => ''); }
      const message = (errBody && errBody.error && errBody.error.message) || (typeof errBody === 'string' ? errBody : res.statusText);
      const err = new Error(`Graph ${res.status}: ${message}`);
      err.status = res.status;
      err.body = errBody;
      throw err;
    }

    if (res.status === 204) return null;
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }

  throw lastErr || new Error('Graph: exhausted retries');
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
