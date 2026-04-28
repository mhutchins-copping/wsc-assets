// ─── Email Notifications via Microsoft Graph ────────────

import { getGraphTokenCached as getGraphToken } from './graph.js';

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
  let subject, actionColor, actionLabel, details = [], timestamp, assetUrl = '';
  const timestampStr = formatTimestamp();

  switch (event) {
    case 'asset_created':
      subject = `[WSC Assets] New Asset — ${data.asset.asset_tag}`;
      actionColor = '#10b981';
      actionLabel = 'Created';
      details.push({ label: 'Asset Tag', value: data.asset.asset_tag });
      details.push({ label: 'Name', value: data.asset.name });
      if (data.asset.serial_number) details.push({ label: 'Serial', value: data.asset.serial_number });
      if (data.asset.manufacturer) details.push({ label: 'Manufacturer', value: data.asset.manufacturer });
      if (data.asset.model) details.push({ label: 'Model', value: data.asset.model });
      assetUrl = baseUrl + data.asset.id;
      break;

    case 'asset_checkout':
      subject = `[WSC Assets] Checked Out — ${data.asset.asset_tag}`;
      actionColor = '#3b82f6';
      actionLabel = 'Checked Out';
      details.push({ label: 'Asset Tag', value: data.asset.asset_tag });
      details.push({ label: 'Name', value: data.asset.name });
      details.push({ label: 'Assigned To', value: data.person?.name || 'Unknown' });
      if (data.person?.department) details.push({ label: 'Department', value: data.person.department });
      assetUrl = baseUrl + data.asset.id;
      break;

    case 'asset_checkin':
      subject = `[WSC Assets] Checked In — ${data.asset.asset_tag}`;
      actionColor = '#f59e0b';
      actionLabel = 'Checked In';
      details.push({ label: 'Asset Tag', value: data.asset.asset_tag });
      details.push({ label: 'Name', value: data.asset.name });
      details.push({ label: 'Returned From', value: data.person?.name || 'Unknown' });
      details.push({ label: 'Condition', value: data.condition || 'good' });
      assetUrl = baseUrl + data.asset.id;
      break;

    case 'asset_disposed':
      subject = `[WSC Assets] Disposed — ${data.asset.asset_tag}`;
      actionColor = '#ef4444';
      actionLabel = 'Disposed';
      details.push({ label: 'Asset Tag', value: data.asset.asset_tag });
      details.push({ label: 'Name', value: data.asset.name });
      details.push({ label: 'Status', value: 'Disposed' });
      assetUrl = baseUrl + data.asset.id;
      break;

    case 'asset_purged':
      subject = `[WSC Assets] Permanently Deleted — ${data.asset.asset_tag}`;
      actionColor = '#dc2626';
      actionLabel = 'Purged';
      details.push({ label: 'Asset Tag', value: data.asset.asset_tag });
      details.push({ label: 'Name', value: data.asset.name });
      details.push({ label: 'Status', value: 'Permanently Deleted' });
      break;

    case 'master_key_login':
      subject = `[WSC Assets] Master Key Login — ${data.actor}`;
      actionColor = '#7c3aed';
      actionLabel = 'Security Alert';
      details.push({ label: 'Admin', value: data.actor });
      details.push({ label: 'IP Address', value: data.ip || 'Unknown' });
      details.push({ label: 'Time', value: timestampStr });
      break;

    case 'user_created':
      subject = `[WSC Assets] New User — ${data.user.display_name}`;
      actionColor = '#10b981';
      actionLabel = 'User Created';
      details.push({ label: 'Name', value: data.user.display_name });
      details.push({ label: 'Email', value: data.user.email });
      details.push({ label: 'Role', value: data.user.role || 'user' });
      break;

    case 'asset_flag_filed':
      subject = `[WSC Assets] Flag Raised — ${data.asset.asset_tag}`;
      actionColor = '#f59e0b';
      actionLabel = 'Fault Flagged';
      details.push({ label: 'Asset', value: `${data.asset.asset_tag} — ${data.asset.name}` });
      details.push({ label: 'Category', value: data.category });
      if (data.description) details.push({ label: 'Description', value: data.description });
      details.push({ label: 'Reported by', value: `${data.reporter.name} <${data.reporter.email}>` });
      details.push({ label: 'Time', value: timestampStr });
      assetUrl = baseUrl + data.asset.id;
      break;

    case 'worker_error':
      subject = `[WSC Assets] Worker error on ${data.path}`;
      actionColor = '#dc2626';
      actionLabel = 'Worker error';
      details.push({ label: 'Path', value: `${data.method} ${data.path}` });
      details.push({ label: 'Error', value: data.message || '(no message)' });
      if (data.stack) details.push({ label: 'Stack', value: data.stack });
      details.push({ label: 'Time', value: timestampStr });
      break;

    case 'asset_lifecycle_digest': {
      const wCount = (data.warranties || []).length;
      const rCount = (data.retirements || []).length;
      subject = `[WSC Assets] Weekly digest — ${wCount} warranties, ${rCount} retirements`;
      actionColor = '#0ea5e9';
      actionLabel = 'Weekly digest';
      details.push({ label: 'Warranty expiring (30d)', value: wCount });
      details.push({ label: 'Retirement due (30d)', value: rCount });
      const warrantyList = (data.warranties || []).map(a =>
        `${a.asset_tag} — ${a.name} — ${a.warranty_expiry}${a.assigned_to_name ? ' (' + a.assigned_to_name + ')' : ''}`
      ).join('<br>');
      const retirementList = (data.retirements || []).map(a =>
        `${a.asset_tag} — ${a.name} — ${a.retirement_date}${a.assigned_to_name ? ' (' + a.assigned_to_name + ')' : ''}`
      ).join('<br>');
      if (warrantyList) details.push({ label: 'Warranties', value: warrantyList });
      if (retirementList) details.push({ label: 'Retirements', value: retirementList });
      details.push({ label: 'Generated', value: timestampStr });
      break;
    }

    case 'asset_issue_signed':
      subject = `[WSC Assets] Receipt Signed — ${data.asset.asset_tag}`;
      actionColor = '#10b981';
      actionLabel = 'Receipt Acknowledged';
      details.push({ label: 'Asset', value: `${data.asset.asset_tag} — ${data.asset.name}` });
      if (data.asset.serial_number) details.push({ label: 'Serial', value: data.asset.serial_number });
      details.push({ label: 'Signed by', value: data.person.name });
      if (data.signature_name) details.push({ label: 'Typed name', value: data.signature_name });
      if (data.signature_ip) details.push({ label: 'From IP', value: data.signature_ip });
      assetUrl = baseUrl + data.asset.id;
      break;

    default:
      throw new Error('Unknown event type: ' + event);
  }

  const actorLine = data.actor ? `Performed by ${data.actor}` : '';
  const actionBg = actionColor + '20';
  const actionBorder = actionColor;

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif">
  <div style="max-width:600px;margin:0 auto;padding:20px">
    <!-- Header: logo centred on white, thin green accent bar below -->
    <div style="background:#fff;padding:24px 24px 16px;text-align:center;border-radius:12px 12px 0 0;box-shadow:0 1px 3px rgba(0,0,0,0.1)">
      <img src="https://api.it-wsc.com/logo.png" alt="Walgett Shire Council" width="260" style="display:inline-block;max-width:260px;height:auto">
    </div>
    <div style="height:3px;background:#2e5842;box-shadow:0 1px 3px rgba(0,0,0,0.08)"></div>

    <!-- Action Badge -->
    <div style="background:${actionBg};border-left:4px solid ${actionBorder};padding:14px 22px;margin:0">
      <div style="color:${actionColor};font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.6px">${actionLabel}</div>
      <div style="color:#111827;font-size:15px;font-weight:600;margin-top:2px">IT Asset Register</div>
    </div>

    <!-- Content -->
    <div style="background:#fff;padding:24px;border-radius:0 0 12px 12px;box-shadow:0 1px 3px rgba(0,0,0,0.1)">
      <!-- Details Table -->
      <table style="width:100%;border-collapse:collapse;margin-bottom:20px">
        ${details.map(d => `
        <tr>
          <td style="padding:10px 0;border-bottom:1px solid #e5e7eb;color:#6b7280;font-size:13px;width:35%">${d.label}</td>
          <td style="padding:10px 0;border-bottom:1px solid #e5e7eb;color:#111827;font-size:14px;font-weight:500">${d.value}</td>
        </tr>`).join('')}
      </table>
      
      <!-- Footer Info -->
      <div style="border-top:1px solid #e5e7eb;padding-top:16px;margin-top:8px">
        ${actorLine ? `<p style="margin:0 0 4px;color:#6b7280;font-size:13px">${actorLine}</p>` : ''}
        <p style="margin:0 0 16px;color:#6b7280;font-size:13px">${timestampStr}</p>
        ${assetUrl ? `<a href="${assetUrl}" style="display:inline-block;background:#2e5842;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-size:14px;font-weight:500">View in WSC Assets →</a>` : ''}
      </div>
    </div>
    
    <!-- Footer -->
    <p style="text-align:center;color:#9ca3af;font-size:12px;margin:20px 0 0">This is an automated notification from WSC IT Asset Management.</p>
  </div>
</body>
</html>`;

  const text = `WSC IT Asset Management — ${actionLabel.toUpperCase()}
${'='.repeat(50)}

${details.map(d => `${d.label}: ${d.value}`).join('\n')}

${actorLine ? 'Performed by: ' + actorLine + '\n' : ''}${timestampStr}${assetUrl ? '\n\nView in WSC Assets: ' + assetUrl : ''}

—
This is an automated notification from WSC IT Asset Management.`;

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

// Lower-level email sender for flows that aren't admin-broadcast (e.g.
// the asset-issue signing link, which goes to the recipient). Shares the
// Graph token path but skips the admin lookup + shared template.
export async function sendMail(env, to, subject, html, text) {
  const notifEnabled = env.NOTIFICATIONS_ENABLED;
  if (notifEnabled === 'false') return { ok: false, skipped: 'disabled' };
  if (notifEnabled === 'log') {
    console.log('sendMail (log-only):', subject, 'to:', to);
    return { ok: true, logged: true };
  }

  const sender = env.NOTIFICATION_SENDER;
  if (!sender) {
    console.error('sendMail: NOTIFICATION_SENDER not configured');
    return { ok: false, error: 'NOTIFICATION_SENDER not configured' };
  }

  let token;
  try {
    token = await getGraphToken(env);
  } catch (err) {
    console.error('sendMail: failed to get Graph token:', err.message);
    return { ok: false, error: err.message };
  }

  const recipients = (Array.isArray(to) ? to : [to])
    .filter(Boolean)
    .map(addr => ({ emailAddress: { address: addr } }));

  if (recipients.length === 0) return { ok: false, error: 'no recipients' };

  const graphBody = {
    message: {
      subject,
      body: { contentType: 'HTML', content: html },
      toRecipients: recipients,
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
      console.error('sendMail: Graph sendMail failed:', res.status, errBody);
      return { ok: false, error: `Graph ${res.status}` };
    }
    return { ok: true };
  } catch (err) {
    console.error('sendMail: Graph fetch failed:', err);
    return { ok: false, error: err.message };
  }
}
