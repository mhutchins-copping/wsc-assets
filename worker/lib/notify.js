// ─── Email Notifications via Microsoft Graph ────────────

async function getGraphToken(env) {
  const tenantId = env.ENTRA_TENANT_ID;
  const clientId = env.ENTRA_CLIENT_ID;
  const clientSecret = env.ENTRA_CLIENT_SECRET;

  if (!tenantId || !clientId || !clientSecret) {
    throw new Error('Missing Entra config (ENTRA_TENANT_ID, ENTRA_CLIENT_ID, ENTRA_CLIENT_SECRET)');
  }

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
    throw new Error('Entra auth failed: ' + (err.error_description || err.error || tokenRes.statusText));
  }

  const tokenData = await tokenRes.json();
  return tokenData.access_token;
}

function formatTimestamp(date = new Date()) {
  return date.toLocaleString('en-AU', {
    timeZone: 'Australia/Sydney',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short'
  });
}

function buildEmail(event, data) {
  const baseUrl = 'https://assets.it-wsc.com/#/assets/';
  let subject, verbSentence, contextLines = '', assetUrl = '';

  switch (event) {
    case 'asset_created':
      subject = `[WSC Assets] Asset created — ${data.asset.asset_tag}`;
      verbSentence = 'A new asset was added to the register.';
      contextLines = `Asset:    ${data.asset.asset_tag} — ${data.asset.name}`;
      assetUrl = baseUrl + data.asset.id;
      break;

    case 'asset_checkout':
      subject = `[WSC Assets] Checked out — ${data.asset.asset_tag} → ${data.person?.name || 'Unknown'}`;
      verbSentence = 'An asset was assigned to a person.';
      contextLines = `Asset:    ${data.asset.asset_tag} — ${data.asset.name}\nAssigned to: ${data.person?.name || 'Unknown'}${data.person?.department ? ' (' + data.person.department + ')' : ''}`;
      assetUrl = baseUrl + data.asset.id;
      break;

    case 'asset_checkin':
      subject = `[WSC Assets] Checked in — ${data.asset.asset_tag}`;
      verbSentence = 'An asset was returned.';
      contextLines = `Asset:    ${data.asset.asset_tag} — ${data.asset.name}\nReturned from: ${data.person?.name || 'Unknown'}\nCondition: ${data.condition || 'good'}`;
      assetUrl = baseUrl + data.asset.id;
      break;

    case 'asset_disposed':
      subject = `[WSC Assets] Asset disposed — ${data.asset.asset_tag}`;
      verbSentence = 'An asset was disposed.';
      contextLines = `Asset:    ${data.asset.asset_tag} — ${data.asset.name}\nStatus: disposed`;
      assetUrl = baseUrl + data.asset.id;
      break;

    case 'asset_purged':
      subject = `[WSC Assets] Asset purged — ${data.asset.asset_tag}`;
      verbSentence = 'An asset was permanently deleted (purged).';
      contextLines = `Asset:    ${data.asset.asset_tag} — ${data.asset.name}\nStatus: permanently deleted`;
      break;

    case 'master_key_login':
      subject = `[WSC Assets] Master key login — ${data.actor}`;
      verbSentence = 'A master key login occurred.';
      contextLines = `Admin: ${data.actor}\nIP: ${data.ip || 'Unknown'}`;
      break;

    case 'user_created':
      subject = `[WSC Assets] User created — ${data.user.email}`;
      verbSentence = 'A new user was added to the system.';
      contextLines = `Name:  ${data.user.display_name}\nEmail: ${data.user.email}\nRole:  ${data.user.role}`;
      break;

    default:
      throw new Error('Unknown event type: ' + event);
  }

  const timestamp = formatTimestamp();
  const actorLine = data.actor ? `Performed by: ${data.actor}${data.actorEmail ? ' (' + data.actorEmail + ')' : ''}` : '';

  const html = `<!DOCTYPE html>
<html>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #333;">
${verbSentence}
<br><br>
<pre style="background: #f5f5f5; padding: 12px; border-radius: 4px; overflow-x: auto;">
${contextLines}
</pre>
<br>
${actorLine ? actorLine + '<br>' : ''}
At:           ${timestamp}
${assetUrl ? '<br><a href="' + assetUrl + '">View asset</a>' : ''}
<br><br>
—<br>
WSC IT Asset Management
</body>
</html>`;

  const text = `${verbSentence}

Asset:    ${data.asset?.asset_tag || 'N/A'} — ${data.asset?.name || 'N/A'}
${contextLines}

${actorLine ? actorLine + '\n' : ''}At:           ${timestamp}
${assetUrl ? '\nView asset: ' + assetUrl : ''}

—
WSC IT Asset Management`;

  return { subject, html, text };
}

export async function notify(env, event, data) {
  // Check feature flag
  const notifEnabled = env.NOTIFICATIONS_ENABLED;
  if (notifEnabled === 'false') return;
  const logOnly = notifEnabled === 'log';

  // Get recipients: active admins with notifications enabled
  const admins = await env.DB.prepare(
    "SELECT email, display_name FROM users WHERE role = 'admin' AND active = 1 AND notifications_enabled = 1"
  ).all();

  if (!admins.results || admins.results.length === 0) {
    console.warn('notify: no active admins with notifications enabled');
    return;
  }

  // Build email
  const { subject, html, text } = buildEmail(event, data);

  if (logOnly) {
    console.log('notify (log-only):', event, subject, 'to:', admins.results.map(a => a.email).join(', '));
    return;
  }

  // Get Graph token and sender
  const sender = env.NOTIFICATION_SENDER;
  if (!sender) {
    console.error('notify: NOTIFICATION_SENDER not configured');
    await env.DB.prepare(
      "INSERT INTO activity_log (id, action, details, created_at) VALUES (?, 'notify_failed', ?, ?)"
    ).bind(
      crypto.randomUUID(),
      'NOTIFICATION_SENDER not configured for event: ' + event,
      new Date().toISOString()
    ).run();
    return;
  }

  let token;
  try {
    token = await getGraphToken(env);
  } catch (err) {
    console.error('notify: failed to get Graph token:', err.message);
    await logNotifyFailure(env, event, err.message);
    return;
  }

  // Send to all recipients in one call
  const toRecipients = admins.results.map(admin => ({
    emailAddress: { address: admin.email, name: admin.display_name }
  }));

  const graphBody = {
    message: {
      subject,
      body: { contentType: 'HTML', content: html },
      toRecipients,
    },
    saveToSentItems: 'true',
  };

  try {
    const res = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(sender)}/sendMail`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(graphBody),
    });

    if (!res.ok) {
      const errBody = await res.text();
      console.error('notify: Graph sendMail failed:', res.status, errBody);
      await logNotifyFailure(env, event, `Graph API error: ${res.status}`);
      return;
    }

    console.log('notify: sent', event, 'to', admins.results.length, 'admins');
  } catch (err) {
    console.error('notify: Graph fetch failed:', err);
    await logNotifyFailure(env, event, err.message);
  }
}

async function logNotifyFailure(env, event, errorMsg) {
  try {
    await env.DB.prepare(
      "INSERT INTO activity_log (id, action, details, created_at) VALUES (?, 'notify_failed', ?, ?)"
    ).bind(
      crypto.randomUUID(),
      `Email notification failed for event '${event}': ${errorMsg}`,
      new Date().toISOString()
    ).run();
  } catch (e) {
    console.error('notify: failed to log notify failure:', e);
  }
}
