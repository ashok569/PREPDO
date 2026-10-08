// PREPDO — admin-user-setup.js
// BUILD 8 | 2026-10-02
// Privacy and the temporary credit-request marker (migration_v27.sql):
//  - create-user and adjust-user take can_clear_data (true/false) — whether a
//    user may clear their own prospects' data from the cloud. Defaults to true.
//    Only platform-level admins (platform_admin, institutional_admin) may set
//    it; an org_admin who supplies it is refused, so it can't be quietly
//    changed by someone who doesn't own that decision.
//  - list-users and summarize return can_clear_data and the credit_request_*
//    fields. adjust-user clears a pending credit request automatically when
//    credits are added, and also accepts dismiss_credit_request for the case
//    where the admin decides not to grant it. The credit-request pieces are
//    TEMPORARY, to be removed with the real email system (see settings.js 57).
//
// BUILD 7 | 2026-09-29
// Real gap found while tracing custom (non-public) industries end to end: an
// org_admin could pass a custom industry's id directly in industry_ids on
// create-user — hidden from their own checklist (settings.js list-industries),
// but not actually blocked server-side. Now checked explicitly: a non-public
// industry in the submitted ids is refused unless the ACTING admin (member,
// not the user being created) is platform-level.
//
// BUILD 6 | 2026-09-28
// User lifecycle and visibility, from real use of Build 5:
//  - create-user takes an optional `name` (stored in team_members.name, shown in
//    the Users list).
//  - 'deactivate-user': blocks login and spending, ends any live session at once
//    (session_expires_at set to now), keeps all their work. If the user's
//    organization has a credit pool, their UNUSED credits are released back to the
//    pool (their allocation becomes what they actually used) and a 'release'
//    ledger entry is written. Reversible.
//  - 'reactivate-user': turns the account back on. Their old login stays closed —
//    use regenerate-access for a new link — and released credits are not
//    restored automatically (top up).
//  - 'delete-user': permanent, and ONLY for a user with no data. Almost every table
//    points at users with a blocking foreign key, so a plain delete would fail for
//    anyone who has done anything; instead the server counts the linked rows and, if
//    any exist, refuses and reports them (deactivate instead). Requires the user's
//    email typed exactly. Never allowed on yourself, a platform admin, or anyone
//    above your tier. Their ledger rows go with them (ON DELETE CASCADE).
//  - 'ledger-check': writes and removes a test ledger row and reports the real
//    database error if it cannot. create-user and adjust-user now return a
//    `warnings` list when their history entry could not be saved — found in real
//    use: the ledger table had no permission for service_role and every write
//    failed silently (by design non-fatal), so nobody could see it.
//
// BUILD 5 | 2026-09-28
// Credits and organization pools (replacing the run counts of the unreleased
// Build 4). A credit is a fixed slice of AI cost ($0.10 for now — see
// _access.js). Plans are now credit allowances: free_1m = 40, free_3m = 120,
// annual = 400 (PROVISIONAL), unlimited = none. Every grant and top-up is
// written to credit_ledger.
//
// Organization credit pool: an organization can have an overall pool
// (organizations.credit_pool; NULL = no pool, e.g. your own LMI organization).
// The credits allocated to its members can never exceed the pool — enforced
// here on create-user and adjust-user. A pooled organization cannot have
// no-limit users (that would make the pool meaningless). New action
// 'set-org-pool' (platform/institutional admins) changes an organization's
// pool, never below what is already allocated. create-organization takes an
// optional credit_pool. list-organizations returns pool, allocated and
// unallocated. The institutional admin's own allocation dashboard is deferred;
// until then allocation happens through the Users list.
//
// (Build 4 notes follow — unchanged rules for plans, access level, industries.)
//
// BUILD 4 | 2026-09-24
// Plans, access levels, industry restrictions, user list and run top-ups.
//
// create-user now takes:
//   plan          REQUIRED — 'free_1m' (1 month, 40 credits), 'free_3m' (3 months,
//                 120 credits), 'annual' (1 year, 400 credits — PROVISIONAL, revisit
//                 when pricing is set) or 'unlimited' (no expiry, no cap — for
//                 internal/team users). Required on purpose: a caller that
//                 forgets it gets an error, never an accidentally-unlimited user.
//   access_level  'full' (default) or 'roleplay_only'
//   credits_total optional override of the plan's credit allowance
//   industry_ids  optional, B2B users only — restricts them to these
//                 industries. One = preset and locked (no dropdown), several =
//                 a dropdown limited to those, none = the full list.
// Plan and quota rules live HERE, on the server. Only platform_admin and
// institutional_admin may choose 'annual'/'unlimited' or override credits —
// an org_admin can create users on the free plans only, so creating users
// can never become a way around the contained-spend limits.
//
// New actions: 'list-users' (scoped by tier; never returns token hashes) and
// 'adjust-user' (add credits, extend the plan, change access level — platform or
// institutional admins only).
//
// BUILD 3 | 2026-09-11
// Added 'regenerate-access' — for an EXISTING user who's lost their session.
// Reuses the token/setup_url mechanism from create-user. Same tier rule as
// create-user, but DELIBERATELY without its "platform_admin can never be
// created through this tool" exception — refreshing an existing credential
// grants no new privilege. Only helps when some OTHER admin still has an
// active session to act on the locked-out person's behalf.
//
// BUILD 2 | 2026-09-11
// create-user returns a clickable setup_url (index.html?setup_token=...)
// instead of DevTools instructions; manual email+token fallback exists for
// links that don't come through cleanly.
//
// BUILD 1 | 2026-09-11
// New file. Admin-driven user/organization setup, replacing manual SQL
// inserts. Generates a real working session token directly rather than
// depending on request-login-link.js (which silently sends nothing unless
// BREVO_API_KEY is configured). Permission rule: granting a tier STRICTLY
// ABOVE your own is blocked; peer grants are allowed; platform_admin can
// never be created through create-user; org_admin is confined to their own
// organization_id.

const crypto = require('crypto');
const { getMemberFromSession, supaGet, supaPost, supaPatch, supaDelete, hashToken, respond, handleOptions } = require('./_lib.js');
const { creditsRemaining, round2, tryLedger } = require('./_access.js');

const TIER_RANK = { member: 0, org_admin: 1, institutional_admin: 2, platform_admin: 3 };

// Credits per plan — the one place to change them. 1 credit = $0.10 of AI cost.
const PLANS = {
  free_1m:   { months: 1,    credits: 40 },   // was 10 runs
  free_3m:   { months: 3,    credits: 120 },  // was 30 runs
  annual:    { months: 12,   credits: 400 },  // was 100 runs — PROVISIONAL, revisit at pricing
  unlimited: { months: null, credits: null }
};
const fmt = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
const MAX_CREDITS = 10000000;

// Credits already allocated to an organization's members (unlimited users and
// the platform admin do not count against a pool).
async function orgAllocated(orgId) {
  const rows = await supaGet(`team_members?organization_id=eq.${orgId}&select=credits_total,key_type`);
  return round2(rows.filter((r) => r.key_type !== 'platform_admin' && r.credits_total != null).reduce((s, r) => s + Number(r.credits_total), 0));
}

// Returns null if `extra` more credits fit within the org's pool (or it has no
// pool), otherwise an error message.
async function poolShortfall(orgId, extra) {
  const orgs = await supaGet(`organizations?id=eq.${orgId}&select=id,credit_pool`);
  if (!orgs.length || orgs[0].credit_pool == null) return null;
  const pool = Number(orgs[0].credit_pool);
  const allocated = await orgAllocated(orgId);
  if (round2(allocated + extra) > pool) {
    return `This organization's pool has ${fmt(round2(Math.max(pool - allocated, 0)))} credits unallocated, and this needs ${fmt(extra)}. Increase the pool first.`;
  }
  return null;
}

function parseCredits(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0 || n > MAX_CREDITS) return null;
  return round2(n);
}

// Shown to the admin when a ledger entry could not be saved (the action itself
// still went through).
function ledgerWarning(what, err) {
  const detail = String(err || '').slice(0, 160);
  return `${what}, but its history entry could not be saved (${detail}). Use "Check credit ledger" in User Setup.`;
}

// Every table that points at a user with a blocking foreign key (from the live
// database's own constraint list). A user with rows in any of these cannot be
// deleted — only deactivated.
const OWNED_BY_USER = [
  ['prospects', 'owner_id', 'prospects'],
  ['reports', 'owner_id', 'reports'],
  ['folders', 'owner_id', 'folders'],
  ['action_items', 'owner_id', 'action items'],
  ['stalls_objections_log', 'owner_id', 'stall/objection entries'],
  ['learnings', 'owner_id', 'learnings'],
  ['api_usage_log', 'member_id', 'AI usage records'],
  ['iterative_research_sessions', 'member_id', 'Guided Research sessions'],
  ['invites', 'invited_by', 'invites sent'],
  ['gleaner_reports', 'triggered_by', 'Gleaner reports'],
  ['subscriptions', 'created_by', 'subscriptions created'],
  ['subscriptions', 'approved_by', 'subscriptions approved'],
  ['report_backups', 'downloaded_by', 'report backups downloaded'],
  ['report_backups', 'restored_by', 'report backups restored']
];
const COUNT_CAP = 1000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function generateSetupToken() {
  return crypto.randomBytes(32).toString('base64url');
}

// Calendar-correct month arithmetic: Jan 31 + 1 month = Feb 28/29, not Mar 3.
function addMonths(base, n) {
  const d = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), 1));
  d.setUTCMonth(d.getUTCMonth() + n);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(base.getUTCDate(), lastDay));
  return d;
}
const isoDate = (d) => d.toISOString().slice(0, 10);

function summarize(row) {
  return {
    id: row.id,
    email: row.email,
    name: row.name || null,
    is_active: row.is_active !== false,
    key_type: row.key_type,
    user_segment: row.user_segment,
    access_level: row.access_level,
    plan_type: row.plan_type || null,
    expires_on: row.subscription_expiry_date || null,
    credits_total: row.credits_total == null ? null : Number(row.credits_total),
    credits_used: round2(Number(row.credits_used || 0)),
    credits_remaining: creditsRemaining(row),
    can_clear_data: row.can_clear_data !== false,
    credit_request_at: row.credit_request_at || null,
    credit_request_note: row.credit_request_note || null
  };
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
    if (member.key_type === 'member') {
      return respond(403, { ok: false, message: 'Admin only.' });
    }
    const platformLevel = member.key_type === 'platform_admin' || member.key_type === 'institutional_admin';

    if (action === 'list-organizations') {
      const rows = platformLevel
        ? await supaGet(`organizations?select=id,name,type,default_user_segment,credit_pool&order=name.asc`)
        : await supaGet(`organizations?id=eq.${member.organization_id}&select=id,name,type,default_user_segment,credit_pool`);
      // For pooled organizations, show how much of the pool is already allocated.
      const withAlloc = [];
      for (const o of rows) {
        if (o.credit_pool == null) { withAlloc.push({ ...o, credit_pool: null, credits_allocated: null, credits_unallocated: null }); continue; }
        const allocated = await orgAllocated(o.id);
        withAlloc.push({ ...o, credit_pool: Number(o.credit_pool), credits_allocated: allocated, credits_unallocated: round2(Number(o.credit_pool) - allocated) });
      }
      return respond(200, { ok: true, organizations: withAlloc });
    }

    if (action === 'create-organization') {
      if (!platformLevel) {
        return respond(403, { ok: false, message: 'Only platform or institutional admins can create new organizations.' });
      }
      const { name, type, default_user_segment, credit_pool } = payload;
      if (!name || !name.trim()) {
        return respond(400, { ok: false, message: 'Organization name is required.' });
      }
      if (type !== 'individual' && type !== 'company') {
        return respond(400, { ok: false, message: 'type must be "individual" or "company".' });
      }
      if (default_user_segment !== 'lmi' && default_user_segment !== 'non_lmi') {
        return respond(400, { ok: false, message: 'default_user_segment must be "lmi" or "non_lmi".' });
      }

      let pool = null;
      if (credit_pool !== undefined && credit_pool !== null && credit_pool !== '') {
        const n = Number(credit_pool);
        if (!Number.isFinite(n) || n < 0 || n > MAX_CREDITS) {
          return respond(400, { ok: false, message: 'The credit pool must be a number of credits (0 or more), or left blank for no pool.' });
        }
        pool = round2(n);
      }
      const createdOrg = await supaPost('organizations', { name: name.trim(), type, default_user_segment, credit_pool: pool });
      const org = createdOrg[0];

      // Schema-consistency only — not a gate. Billing is delinked right now.
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

    if (action === 'set-org-pool') {
      if (!platformLevel) {
        return respond(403, { ok: false, message: 'Only platform or institutional admins can change an organization\'s pool.' });
      }
      const { organization_id, credit_pool } = payload;
      if (!organization_id || !UUID_RE.test(organization_id)) {
        return respond(400, { ok: false, message: 'A valid organization is required.' });
      }
      const orgs = await supaGet(`organizations?id=eq.${organization_id}&select=id`);
      if (!orgs.length) return respond(404, { ok: false, message: 'Organization not found.' });
      let pool = null;
      if (credit_pool !== null && credit_pool !== undefined && credit_pool !== '') {
        const n = Number(credit_pool);
        if (!Number.isFinite(n) || n < 0 || n > MAX_CREDITS) {
          return respond(400, { ok: false, message: 'The credit pool must be a number of credits (0 or more), or blank to remove the pool.' });
        }
        pool = round2(n);
        const allocated = await orgAllocated(organization_id);
        if (pool < allocated) {
          return respond(400, { ok: false, message: `${fmt(allocated)} credits are already allocated to this organization's users, so the pool cannot be lower than that.` });
        }
      }
      await supaPatch(`organizations?id=eq.${organization_id}`, { credit_pool: pool });
      const allocated = await orgAllocated(organization_id);
      return respond(200, { ok: true, organization_id, credit_pool: pool, credits_allocated: pool == null ? null : allocated, credits_unallocated: pool == null ? null : round2(pool - allocated) });
    }

    if (action === 'create-user') {
      const { email, key_type, user_segment, organization_id, access_level, plan, credits_total: creditsOverride, industry_ids, name, can_clear_data } = payload;
      if (!email || !email.trim()) {
        return respond(400, { ok: false, message: 'Email is required.' });
      }
      let cleanName = null;
      if (name !== undefined && name !== null && String(name).trim() !== '') {
        cleanName = String(name).trim();
        if (cleanName.length > 100) {
          return respond(400, { ok: false, message: 'Name must be 100 characters or fewer.' });
        }
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
      const level = access_level || 'full';
      if (level !== 'full' && level !== 'roleplay_only') {
        return respond(400, { ok: false, message: 'access_level must be "full" or "roleplay_only".' });
      }
      const planDef = PLANS[plan];
      if (!planDef) {
        return respond(400, { ok: false, message: 'Choose a plan for this user.' });
      }

      // Tier rule: never grant above your own tier; platform_admin is never
      // created through this tool; org_admin stays inside their own org.
      if (key_type === 'platform_admin') {
        return respond(403, { ok: false, message: 'platform_admin can only be created via a direct database action, never through this tool.' });
      }
      if (TIER_RANK[key_type] > TIER_RANK[member.key_type]) {
        return respond(403, { ok: false, message: `You cannot grant a tier above your own (${member.key_type}).` });
      }
      if (member.key_type === 'org_admin' && organization_id !== member.organization_id) {
        return respond(403, { ok: false, message: 'You can only create users within your own organization.' });
      }

      // Contained-spend rule: only platform-level admins may hand out the
      // bigger plans or change the run allowance.
      if (!platformLevel) {
        if (plan !== 'free_1m' && plan !== 'free_3m') {
          return respond(403, { ok: false, message: 'Your account can create users on the free plans only.' });
        }
        if (creditsOverride !== undefined && creditsOverride !== null && creditsOverride !== '') {
          return respond(403, { ok: false, message: 'Your account cannot change the credit allowance.' });
        }
      }
      let creditsTotal = planDef.credits;
      if (creditsOverride !== undefined && creditsOverride !== null && creditsOverride !== '') {
        if (plan === 'unlimited') {
          return respond(400, { ok: false, message: 'A no-limit plan has no credit allowance to set.' });
        }
        const n = parseCredits(creditsOverride);
        if (n === null) {
          return respond(400, { ok: false, message: 'Credits must be a positive number (up to 10,000,000).' });
        }
        creditsTotal = n;
      }

      // Data-clearing permission: only platform-level admins may set it.
      let canClearData = null; // null = leave the database default (true)
      if (can_clear_data !== undefined && can_clear_data !== null && can_clear_data !== '') {
        if (!platformLevel) {
          return respond(403, { ok: false, message: 'Your account cannot change the data-clearing permission.' });
        }
        if (typeof can_clear_data !== 'boolean') {
          return respond(400, { ok: false, message: 'can_clear_data must be true or false.' });
        }
        canClearData = can_clear_data;
      }

      // Industry restriction (B2B only). Every id is validated as a UUID
      // BEFORE being placed in a query filter.
      let allowedIds = null;
      if (Array.isArray(industry_ids) && industry_ids.length > 0) {
        if (user_segment !== 'non_lmi') {
          return respond(400, { ok: false, message: 'Industry selection applies to B2B users only.' });
        }
        const ids = [...new Set(industry_ids)];
        if (ids.length > 40 || !ids.every((i) => typeof i === 'string' && UUID_RE.test(i))) {
          return respond(400, { ok: false, message: 'Invalid industry selection.' });
        }
        const found = await supaGet(`industry_contexts?id=in.(${ids.join(',')})&select=id,is_public`);
        if (found.length !== ids.length) {
          return respond(400, { ok: false, message: 'One or more selected industries no longer exist.' });
        }
        if (!platformLevel && found.some((f) => !f.is_public)) {
          return respond(403, { ok: false, message: 'Your account cannot assign a custom industry.' });
        }
        allowedIds = ids;
      }

      const existing = await supaGet(`team_members?email=eq.${encodeURIComponent(email.trim())}&select=id`);
      if (existing.length) {
        return respond(400, { ok: false, message: 'A user with this email already exists.' });
      }
      const orgCheck = await supaGet(`organizations?id=eq.${organization_id}&select=id,credit_pool`);
      if (!orgCheck.length) {
        return respond(404, { ok: false, message: 'Organization not found.' });
      }
      // Pooled organization: every user must draw a defined allocation from the
      // pool, and the pool can never be over-allocated.
      if (orgCheck[0].credit_pool != null) {
        if (creditsTotal == null) {
          return respond(400, { ok: false, message: 'This organization has a credit pool, so every user needs a plan with credits — a no-limit user would make the pool meaningless.' });
        }
        const shortfall = await poolShortfall(organization_id, creditsTotal);
        if (shortfall) return respond(400, { ok: false, message: shortfall });
      }

      const setupToken = generateSetupToken();
      const tokenHash = hashToken(setupToken);
      const farFuture = new Date();
      farFuture.setFullYear(farFuture.getFullYear() + 2);
      const now = new Date();

      const row = {
        email: email.trim(),
        key_type,
        user_segment,
        organization_id,
        is_active: true,
        access_level: level,
        plan_type: plan,
        subscription_start_date: isoDate(now),
        subscription_status: 'active',
        credits_total: creditsTotal,
        credits_used: 0,
        allowed_industry_ids: allowedIds,
        session_token_hash: tokenHash,
        session_expires_at: farFuture.toISOString()
      };
      // Omitted (not set to null) for a no-limit plan: the earlier
      // create-user worked without these columns, so omitting is safe.
      if (planDef.months) row.subscription_expiry_date = isoDate(addMonths(now, planDef.months));
      if (plan === 'annual') row.subscription_type = 'paid';
      if (allowedIds) row.industry_context_id = allowedIds[0];
      if (canClearData === false) row.can_clear_data = false;
      if (cleanName) row.name = cleanName;

      const created = await supaPost('team_members', row);
      const warnings = [];
      if (creditsTotal != null) {
        const led = await tryLedger({ member_id: created[0].id, action: 'initial_grant', delta: creditsTotal, balance_after: creditsTotal, actor_id: member.id, note: 'plan ' + plan });
        if (!led.ok) warnings.push(ledgerWarning('The credits were granted', led.error));
      }

      return respond(200, {
        ok: true,
        member: summarize(created[0]),
        warnings,
        setup_token: setupToken,
        setup_url: `${process.env.URL || 'https://prepdo.netlify.app'}/index.html?setup_token=${setupToken}`,
        instructions: 'Share this link with the new user — they just click it and confirm their email. If the link doesn\'t come through cleanly, they can also go to the login page, choose "Have an access token instead?", and enter their email plus the token below manually.'
      });
    }

    if (action === 'list-users') {
      const cols = 'id,email,name,key_type,user_segment,organization_id,access_level,plan_type,subscription_expiry_date,credits_total,credits_used,allowed_industry_ids,is_active,last_login,created_at,can_clear_data,credit_request_at,credit_request_note';
      let rows = [];
      if (platformLevel) {
        rows = await supaGet(`team_members?select=${cols}&order=created_at.desc`);
      } else if (member.organization_id) {
        rows = await supaGet(`team_members?organization_id=eq.${member.organization_id}&select=${cols}&order=created_at.desc`);
      }
      // Never show people above your own tier.
      rows = rows.filter((r) => (TIER_RANK[r.key_type] ?? 0) <= TIER_RANK[member.key_type]);
      return respond(200, { ok: true, users: rows.map((r) => ({ ...r, credits_total: r.credits_total == null ? null : Number(r.credits_total), credits_used: round2(Number(r.credits_used || 0)), credits_remaining: creditsRemaining(r) })) });
    }

    if (action === 'adjust-user') {
      if (!platformLevel) {
        return respond(403, { ok: false, message: 'Only platform or institutional admins can change credits or plans.' });
      }
      const { user_id, add_credits, extend_months, access_level, can_clear_data, dismiss_credit_request } = payload;
      if (!user_id || !UUID_RE.test(user_id)) {
        return respond(400, { ok: false, message: 'A valid user is required.' });
      }
      const found = await supaGet(`team_members?id=eq.${user_id}&select=*`);
      if (!found.length) {
        return respond(404, { ok: false, message: 'User not found.' });
      }
      const target = found[0];
      if (target.key_type === 'platform_admin') {
        return respond(400, { ok: false, message: 'This account is not metered, so there is nothing to adjust.' });
      }
      if (TIER_RANK[target.key_type] > TIER_RANK[member.key_type]) {
        return respond(403, { ok: false, message: 'You cannot change a user above your own tier.' });
      }

      const updates = {};
      let addedCredits = null;
      if (add_credits !== undefined && add_credits !== null && add_credits !== '') {
        const n = parseCredits(add_credits);
        if (n === null) {
          return respond(400, { ok: false, message: 'Credits to add must be a positive number (up to 10,000,000).' });
        }
        if (target.credits_total == null) {
          return respond(400, { ok: false, message: 'This user has no credit limit, so there is nothing to add to.' });
        }
        const shortfall = await poolShortfall(target.organization_id, n);
        if (shortfall) return respond(400, { ok: false, message: shortfall });
        updates.credits_total = round2(Number(target.credits_total) + n);
        addedCredits = n;
      }
      if (extend_months !== undefined && extend_months !== null && extend_months !== '') {
        const m = Number(extend_months);
        if (![1, 3, 12].includes(m)) {
          return respond(400, { ok: false, message: 'Extend by 1, 3 or 12 months.' });
        }
        if (!target.subscription_expiry_date) {
          return respond(400, { ok: false, message: 'This user has no expiry date, so there is nothing to extend.' });
        }
        // From the later of (current expiry, today): extending an already-expired
        // plan starts from today, not from a date in the past.
        const cur = new Date(String(target.subscription_expiry_date).slice(0, 10) + 'T00:00:00Z');
        const today = new Date(isoDate(new Date()) + 'T00:00:00Z');
        updates.subscription_expiry_date = isoDate(addMonths(cur > today ? cur : today, m));
      }
      if (access_level !== undefined && access_level !== null && access_level !== '') {
        if (access_level !== 'full' && access_level !== 'roleplay_only') {
          return respond(400, { ok: false, message: 'access_level must be "full" or "roleplay_only".' });
        }
        updates.access_level = access_level;
      }
      if (can_clear_data !== undefined && can_clear_data !== null && can_clear_data !== '') {
        if (typeof can_clear_data !== 'boolean') {
          return respond(400, { ok: false, message: 'can_clear_data must be true or false.' });
        }
        updates.can_clear_data = can_clear_data;
      }
      // TEMPORARY credit-request marker: topping up answers it; dismissing
      // does too. Remove with the email system.
      if (dismiss_credit_request === true || addedCredits != null) {
        updates.credit_request_at = null;
        updates.credit_request_note = null;
      }
      if (Object.keys(updates).length === 0) {
        return respond(400, { ok: false, message: 'Nothing to change.' });
      }

      const patched = await supaPatch(`team_members?id=eq.${user_id}`, updates);
      const warnings = [];
      if (addedCredits != null) {
        const led = await tryLedger({ member_id: user_id, action: 'top_up', delta: addedCredits, balance_after: creditsRemaining(patched[0]), actor_id: member.id, note: null });
        if (!led.ok) warnings.push(ledgerWarning('The credits were added', led.error));
      }
      return respond(200, { ok: true, user: summarize(patched[0]), warnings });
    }

    if (action === 'ledger-check') {
      if (!platformLevel) {
        return respond(403, { ok: false, message: 'Only platform or institutional admins can run this check.' });
      }
      let probe;
      try {
        probe = await supaPost('credit_ledger', { member_id: member.id, action: 'health_check', delta: 0, balance_after: null, actor_id: member.id, note: 'ledger check' });
      } catch (e) {
        return respond(200, { ok: true, healthy: false, message: 'The credit ledger is NOT working — a test entry could not be written: ' + String(e.message).slice(0, 300) });
      }
      try {
        await supaDelete(`credit_ledger?id=eq.${probe[0].id}`);
      } catch (e) {
        return respond(200, { ok: true, healthy: false, message: 'The ledger accepted a test entry but it could not be removed: ' + String(e.message).slice(0, 300) });
      }
      return respond(200, { ok: true, healthy: true, message: 'The credit ledger is working: a test entry was written and removed.' });
    }

    if (action === 'deactivate-user' || action === 'reactivate-user' || action === 'delete-user') {
      if (!platformLevel) {
        return respond(403, { ok: false, message: 'Only platform or institutional admins can deactivate or delete users.' });
      }
      const { user_id } = payload;
      if (!user_id || !UUID_RE.test(user_id)) {
        return respond(400, { ok: false, message: 'A valid user is required.' });
      }
      const found = await supaGet(`team_members?id=eq.${user_id}&select=*`);
      if (!found.length) {
        return respond(404, { ok: false, message: 'User not found.' });
      }
      const target = found[0];
      if (target.id === member.id) {
        return respond(400, { ok: false, message: 'You cannot do this to your own account.' });
      }
      if (target.key_type === 'platform_admin') {
        return respond(400, { ok: false, message: 'A platform admin account cannot be deactivated or deleted through this tool.' });
      }
      if (TIER_RANK[target.key_type] > TIER_RANK[member.key_type]) {
        return respond(403, { ok: false, message: 'You cannot change a user above your own tier.' });
      }

      if (action === 'deactivate-user') {
        if (target.is_active === false) {
          return respond(400, { ok: false, message: 'This user is already deactivated.' });
        }
        // Ending the session is what actually stops a user who is logged in right now:
        // not every function re-checks is_active, but every one checks the session.
        const updates = { is_active: false, session_expires_at: new Date().toISOString() };
        let released = 0;
        if (target.credits_total != null && target.organization_id) {
          const orgs = await supaGet(`organizations?id=eq.${target.organization_id}&select=credit_pool`);
          if (orgs.length && orgs[0].credit_pool != null) {
            const used = round2(Number(target.credits_used || 0));
            const unused = round2(Number(target.credits_total) - used);
            if (unused > 0) {
              updates.credits_total = used; // their allocation shrinks to what they actually used
              released = unused;
            }
          }
        }
        const patched = await supaPatch(`team_members?id=eq.${user_id}`, updates);
        const warnings = [];
        if (released > 0) {
          const led = await tryLedger({ member_id: user_id, action: 'release', delta: -released, balance_after: creditsRemaining(patched[0]), actor_id: member.id, note: 'unused credits released to the pool on deactivation' });
          if (!led.ok) warnings.push(ledgerWarning('The credits were released', led.error));
        }
        return respond(200, { ok: true, user: summarize(patched[0]), released, warnings });
      }

      if (action === 'reactivate-user') {
        if (target.is_active !== false) {
          return respond(400, { ok: false, message: 'This user is already active.' });
        }
        const patched = await supaPatch(`team_members?id=eq.${user_id}`, { is_active: true });
        return respond(200, {
          ok: true,
          user: summarize(patched[0]),
          message: 'Reactivated. Their old login stays closed — use Regenerate Access to give them a new link. Credits released when they were deactivated are not restored automatically; top up if needed.'
        });
      }

      // delete-user — only for a user with no data at all.
      const counts = await Promise.all(OWNED_BY_USER.map(async ([table, col, label]) => {
        const rows = await supaGet(`${table}?${col}=eq.${user_id}&select=${col}&limit=${COUNT_CAP}`);
        return { label, n: rows.length };
      }));
      const merged = {};
      counts.filter((c) => c.n > 0).forEach((c) => { merged[c.label] = (merged[c.label] || 0) + c.n; });
      const blockers = Object.entries(merged).map(([label, n]) => ({ label, n }));
      if (blockers.length) {
        const list = blockers.map((b) => `${b.n >= COUNT_CAP ? COUNT_CAP + '+' : b.n} ${b.label}`).join(', ');
        return respond(400, {
          ok: false,
          blockers,
          message: `This user has activity that would be lost: ${list}. Deactivate them instead — nothing is deleted and they can be reactivated.`
        });
      }
      const typed = String(payload.confirm_email || '').trim().toLowerCase();
      if (!typed || typed !== String(target.email).toLowerCase()) {
        return respond(400, { ok: false, message: 'To confirm the deletion, type this user\'s email exactly.' });
      }
      try {
        await supaDelete(`team_members?id=eq.${user_id}`);
      } catch (e) {
        return respond(409, { ok: false, message: 'Could not delete: the database still has records linked to this user. Deactivate them instead. (' + String(e.message).slice(0, 200) + ')' });
      }
      return respond(200, { ok: true, deleted_email: target.email });
    }

    if (action === 'regenerate-access') {
      const { email } = payload;
      if (!email || !email.trim()) {
        return respond(400, { ok: false, message: 'Email is required.' });
      }

      const existing = await supaGet(`team_members?email=eq.${encodeURIComponent(email.trim())}&select=*`);
      if (!existing.length) {
        return respond(404, { ok: false, message: 'No user found with this email.' });
      }
      const targetUser = existing[0];

      if (TIER_RANK[targetUser.key_type] > TIER_RANK[member.key_type]) {
        return respond(403, { ok: false, message: `You cannot regenerate access for a tier above your own (${member.key_type}).` });
      }
      if (member.key_type === 'org_admin' && targetUser.organization_id !== member.organization_id) {
        return respond(403, { ok: false, message: 'You can only regenerate access for users within your own organization.' });
      }
      if (!targetUser.is_active) {
        return respond(403, { ok: false, message: 'This account is deactivated — reactivate it before regenerating access.' });
      }

      const setupToken = generateSetupToken();
      const tokenHash = hashToken(setupToken);
      const farFuture = new Date();
      farFuture.setFullYear(farFuture.getFullYear() + 2);

      await supaPatch(`team_members?id=eq.${targetUser.id}`, {
        session_token_hash: tokenHash,
        session_expires_at: farFuture.toISOString()
      });

      return respond(200, {
        ok: true,
        email: targetUser.email,
        setup_token: setupToken,
        setup_url: `${process.env.URL || 'https://prepdo.netlify.app'}/index.html?setup_token=${setupToken}`,
        instructions: 'Share this link with them — they click it and confirm their email, same as a new user.'
      });
    }

    return respond(400, { ok: false, message: `Unknown action: ${action}` });
  } catch (err) {
    return respond(500, { ok: false, message: 'Server error: ' + err.message });
  }
};
