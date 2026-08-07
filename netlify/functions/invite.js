// /netlify/functions/invite.js
//
// Admin action: invite one or many people by name+email. For each one,
// generates a fresh random token on the fly, stores only its hash, and
// sends an activation email via Brevo. No pre-generated key pool.
//
// Request body: { invited_by: <team_members.id or null for the very first
//   admin bootstrap>, invites: [ { name, email, key_type: 'admin'|'member' }, ... ] }
//
// Env vars required (in addition to SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY):
//   BREVO_API_KEY
//   APP_BASE_URL   (e.g. https://prepdo.netlify.app)

const { supaGet, supaPost, generateToken, hashToken, respond, handleOptions } = require('./_lib.js');

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return handleOptions();
  if (event.httpMethod !== 'POST') {
    return respond(405, { ok: false, message: 'Method Not Allowed' });
  }

  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch (e) {
    return respond(400, { ok: false, message: 'Invalid request body.' });
  }

  const { invited_by, invites } = payload;
  if (!Array.isArray(invites) || invites.length === 0) {
    return respond(400, { ok: false, message: 'Provide at least one invite: { name, email, key_type }.' });
  }

  try {
    // If invited_by is provided, confirm that person is actually an admin.
    // (Skip this check only for the one-time first-admin bootstrap, invited_by = null.)
    if (invited_by) {
      const inviter = await supaGet(`team_members?id=eq.${invited_by}&select=key_type`);
      if (!inviter.length || inviter[0].key_type !== 'admin') {
        return respond(403, { ok: false, message: 'Only an admin can invite team members.' });
      }
    }
  } catch (err) {
    return respond(500, { ok: false, message: 'Server error checking inviter: ' + err.message });
  }

  const results = [];

  for (const row of invites) {
    const { name, email, key_type } = row;
    if (!name || !email || !['admin', 'member'].includes(key_type)) {
      results.push({ email: email || '(missing)', ok: false, message: 'Missing or invalid name/email/key_type.' });
      continue;
    }

    const token = generateToken();
    const token_hash = hashToken(token);

    try {
      await supaPost('invites', {
        email: email.toLowerCase().trim(),
        name: name.trim(),
        token_hash,
        key_type,
        invited_by: invited_by || null
      });

      const activationLink = `${process.env.APP_BASE_URL}/?activate=${token}`;

      const emailSent = await sendActivationEmail({ name, email, activationLink });

      results.push({ email, ok: true, emailSent });
    } catch (err) {
      results.push({ email, ok: false, message: err.message });
    }
  }

  return respond(200, { ok: true, results });
};

async function sendActivationEmail({ name, email, activationLink }) {
  const BREVO_API_KEY = process.env.BREVO_API_KEY;
  if (!BREVO_API_KEY) {
    // Brevo not wired up yet — this is expected during early testing.
    // The activation link is still returned in the function result so
    // it can be copied manually.
    return { sent: false, reason: 'BREVO_API_KEY not configured', activationLink };
  }

  try {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': BREVO_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        sender: { name: 'PREPDO Team', email: 'noreply@lmi-india.in' },
        to: [{ email, name }],
        subject: 'Welcome to PREPDO — Activate Your Account',
        htmlContent: `<p>Hi ${name},</p><p>You have been invited to PREPDO AI Sales Coach. Click below to activate your account:</p><p><a href="${activationLink}">${activationLink}</a></p><p>This link expires in 7 days.</p><p>Regards,<br>PREPDO Team</p>`
      })
    });

    return { sent: res.ok, statusCode: res.status, activationLink };
  } catch (err) {
    // Even if Brevo itself fails/is misconfigured, don't crash the whole
    // invite — the link is still returned so it can be shared manually.
    return { sent: false, reason: err.message, activationLink };
  }
}
