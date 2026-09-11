// PREPDO — admin-user-setup.js
// BUILD 2 | 2026-09-11
// Real UX fix, per direct feedback: the create-user response used to
// tell the new user to open DevTools Console and run a raw JS
// command to set localStorage — a genuinely bad first experience for
// someone who isn't a developer. Now returns a clickable setup_url
// (index.html?setup_token=...) instead, landing on a simple
// "confirm your email" screen (new: redeem-setup-token.js + an
// index.html update), with a manual email+token fallback for when
// the link itself doesn't come through cleanly.
//
// New file. A proper admin-driven user/organization setup process,
// replacing manual SQL inserts. Explicitly delinked from billing per
// request — subscription/seat enforcement is NOT built here; a
// subscription row still gets created (status 'active',
// activation_method 'admin_offline') purely so the schema stays
// populated and consistent for whenever real billing arrives, not as
// a gate on anything in this file.
//
// Deliberately generates a real, working session token directly on
// user creation, rather than routing through request-login-link.js's
// email flow or activate.js — neither has been confirmed to actually
// work end-to-end (request-login-link.js's real email-sending
// capability is still an open, unconfirmed question from earlier this
// session). This reuses the exact token/hash mechanism already proven
// twice today for real account recovery: a random token is generated,
// its hash is stored on the new team_members row directly, and the
// raw token is returned in the response for the admin to hand to the
// new user themselves — not dependent on anything unverified.
//
// Three actions:
//   'list-organizations' — for the setup UI's org picker. platform_admin/
//                           institutional_admin see every org; org_admin
//                           sees only their own (can't create users
//                           elsewhere, so no reason to see other orgs).
//   'create-organization' — platform_admin/institutional_admin only.
//   'create-user'         — creates the team_members row directly,
//                           active immediately (admin action IS the
//                           activation, replacing the old subscription-
//                           triggers-activation workflow), with a real
//                           token ready to share.
//
// Permission rule: granting a tier STRICTLY ABOVE your own is always
// blocked. A PEER grant (org_admin creating another org_admin,
// institutional_admin creating another institutional_admin) is
// allowed — two co-equal admins at one company is a normal, real
// need. platform_admin can NEVER be created through this tool, by
// anyone, including an existing platform_admin — that one action
// stays a direct, deliberate database action. org_admin is
// additionally restricted to their own organization_id.

const crypto = require('crypto');
const { getMemberFromSession, supaGet, supaPost, hashToken, respond, handleOptions } = require('./_lib.js');

const TIER_RANK = { member: 0, org_admin: 1, institutional_admin: 2, platform_admin: 3 };

function generateSetupToken() {
  return crypto.randomBytes(32).toString('base64url');
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return handleOptions();
  if (event.httpMethod !== 'POST') {
    return respond(405, { ok: false, message: 'Method Not Allowed' });
  }

  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch (e) {
    return respond(400, { ok: false, message: 'Invalid request.' });
  }

  const { session_token, action } = payload;

  try {
    const member = await getMemberFromSession(session_token);
    if (!member) {
      return respond(401, { ok: false, message: 'Not logged in. Please log in again.' });
    }
    if (!(member.key_type in TIER_RANK)) {
      return respond(403, { ok: false, message: 'Not authorized.' });
    }
    // Ordinary members have no business here at all — every action
    // below requires at least org_admin.
    if (member.key_type === 'member') {
      return respond(403, { ok: false, message: 'Admin only.' });
    }

    if (action === 'list-organizations') {
      const rows = member.key_type === 'platform_admin' || member.key_type === 'institutional_admin'
        ? await supaGet(`organizations?select=id,name,type,default_user_segment&order=name.asc`)
        : await supaGet(`organizations?id=eq.${member.organization_id}&select=id,name,type,default_user_segment`);
      return respond(200, { ok: true, organizations: rows });
    }

    if (action === 'create-organization') {
      if (member.key_type !== 'platform_admin' && member.key_type !== 'institutional_admin') {
        return respond(403, { ok: false, message: 'Only platform or institutional admins can create new organizations.' });
      }
      const { name, type, default_user_segment } = payload;
      if (!name || !name.trim()) {
        return respond(400, { ok: false, message: 'Organization name is required.' });
      }
      if (type !== 'individual' && type !== 'company') {
        return respond(400, { ok: false, message: 'type must be "individual" or "company".' });
      }
      if (default_user_segment !== 'lmi' && default_user_segment !== 'non_lmi') {
        return respond(400, { ok: false, message: 'default_user_segment must be "lmi" or "non_lmi".' });
      }

      const createdOrg = await supaPost('organizations', {
        name: name.trim(),
        type,
        default_user_segment
      });
      const org = createdOrg[0];

      // Schema-consistency only — not a gate. Billing is explicitly
      // delinked right now; this row exists so the shape is right
      // whenever real billing arrives, nothing in this file checks it.
      await supaPost('subscriptions', {
        organization_id: org.id,
        seats_purchased: 1,
        status: 'active',
        activation_method: 'admin_offline',
        created_by: member.id,
        approved_by: member.id,
        approved_at: new Date().toISOString()
      });

      return respond(200, { ok: true, organization: org });
    }

    if (action === 'create-user') {
      const { email, key_type, user_segment, organization_id } = payload;
      if (!email || !email.trim()) {
        return respond(400, { ok: false, message: 'Email is required.' });
      }
      if (!(key_type in TIER_RANK)) {
        return respond(400, { ok: false, message: 'Invalid key_type.' });
      }
      if (user_segment !== 'lmi' && user_segment !== 'non_lmi') {
        return respond(400, { ok: false, message: 'user_segment must be "lmi" or "non_lmi".' });
      }
      if (!organization_id) {
        return respond(400, { ok: false, message: 'organization_id is required.' });
      }

      // Permission rule, corrected after direct testing caught a real
      // inconsistency with the design intent: granting a tier STRICTLY
      // ABOVE your own is always blocked, but a PEER grant (org_admin
      // creating another org_admin, institutional_admin creating
      // another institutional_admin) is legitimate and allowed — two
      // co-equal admins at one company is a normal, real need. The one
      // deliberate exception: platform_admin can NEVER be created
      // through this tool, by anyone, including an existing
      // platform_admin — that specific action is sensitive enough to
      // stay a direct, deliberate database action, not a routine UI
      // operation.
      if (key_type === 'platform_admin') {
        return respond(403, { ok: false, message: 'platform_admin can only be created via a direct database action, never through this tool.' });
      }
      if (TIER_RANK[key_type] > TIER_RANK[member.key_type]) {
        return respond(403, { ok: false, message: `You cannot grant a tier above your own (${member.key_type}).` });
      }
      // org_admin is additionally confined to their own organization.
      if (member.key_type === 'org_admin' && organization_id !== member.organization_id) {
        return respond(403, { ok: false, message: 'You can only create users within your own organization.' });
      }

      const existing = await supaGet(`team_members?email=eq.${encodeURIComponent(email.trim())}&select=id`);
      if (existing.length) {
        return respond(400, { ok: false, message: 'A user with this email already exists.' });
      }

      const orgCheck = await supaGet(`organizations?id=eq.${organization_id}&select=id`);
      if (!orgCheck.length) {
        return respond(404, { ok: false, message: 'Organization not found.' });
      }

      // Real token generated directly — see file header for why this
      // deliberately bypasses the email/activate-link flow.
      const setupToken = generateSetupToken();
      const tokenHash = hashToken(setupToken);
      const farFuture = new Date();
      farFuture.setFullYear(farFuture.getFullYear() + 2);

      const created = await supaPost('team_members', {
        email: email.trim(),
        key_type,
        user_segment,
        organization_id,
        is_active: true,
        session_token_hash: tokenHash,
        session_expires_at: farFuture.toISOString()
      });

      // Real UX fix, per direct feedback: the original version told
      // the new user to open DevTools Console and run a raw JS
      // command — a genuinely bad first experience for someone who
      // isn't a developer. Now returns a clickable URL
      // (index.html?setup_token=...) that lands on a simple "confirm
      // your email" screen, handled by redeem-setup-token.js — no
      // console, no manual localStorage command.
      return respond(200, {
        ok: true,
        member: created[0],
        setup_token: setupToken,
        setup_url: `${process.env.URL || 'https://prepdo.netlify.app'}/index.html?setup_token=${setupToken}`,
        instructions: 'Share this link with the new user — they just click it and confirm their email. If the link doesn\'t come through cleanly, they can also go to the login page, choose "Have an access token instead?", and enter their email plus the token below manually.'
      });
    }

    return respond(400, { ok: false, message: `Unknown action: ${action}` });
  } catch (err) {
    return respond(500, { ok: false, message: 'Server error: ' + err.message });
  }
};
