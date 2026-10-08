// PREPDO — _access.js
// BUILD 4 | 2026-10-02
// describeAccess now reports can_clear_data — whether this user may clear a
// prospect's data from the cloud (migration_v27.sql). True unless an
// institutional/platform admin switched it off for them; platform-level
// admins themselves are never restricted. The server (prospects.js) is the
// real check — this just lets the screen show or hide the button.
//
// BUILD 3 | 2026-09-28
// Added tryLedger(): like recordLedger but reports failure ({ ok:false, error })
// instead of swallowing it, so admin actions can show a warning. Found in real
// use: the ledger table had no permission for service_role, every write failed
// silently (by design — a ledger failure must never break the action it
// records), and nobody could see it. recordLedger is unchanged in behaviour
// (still never throws) and now calls tryLedger.
//
// BUILD 2 | 2026-09-28
// Credits replace runs. A credit is a fixed slice of AI cost ($0.10 for now —
// CREDIT_UNIT_USD, revisit when pricing is set). Every action has a PRICE in
// credits (the PRICES table below, the one place to change them); the user's
// balance drops by that price. Real AI cost is still logged separately for
// every call (api_usage_log), and every charge is written to credit_ledger
// with the report it belongs to — so credits charged can be compared with real
// cost per report, and the prices tuned from beta data.
//
// Balance rules:
//  - Fixed-price actions (research, report, Meeting Analysis, Guided Research)
//    start only if the balance covers the price, so they never overdraw.
//  - Research needs a whole Presales Prep cycle available (research + report),
//    so nobody can spend on research and then be unable to generate the report.
//  - BETA RULE: roleplay turns and the debrief are charged after they happen
//    and may take the balance slightly below zero — a session already started
//    is always allowed to finish. A NEW roleplay needs at least
//    MIN_TO_START_ROLEPLAY credit.
//  - Failed research topics that are retried are free.
// platform_admin is exempt from expiry, credits and industry limits.
// Spending is a conditional update ("... WHERE credits_used = N"): if two
// requests collide, the second matches zero rows and re-reads — never
// double-spent, no database function needed. Amounts are held to 2 decimals.

const { supaGet, supaPost, supaPatch } = require('./_lib.js');

const CREDIT_UNIT_USD = 0.10;
const PRICES = {
  research: 4,          // the 12-topic research pass (Standard)
  report: 3,            // generating a Presales Prep report (incl. reruns)
  meeting_analysis: 5,
  guided_research: 4,   // starting a Guided Research session
  roleplay_turn: 0.1,   // per message exchanged
  roleplay_debrief: 1
};
const MIN_TO_START_ROLEPLAY = 1;
const FULL_CYCLE = PRICES.research + PRICES.report;
const LOW_CREDITS = 2 * FULL_CYCLE;

const round2 = (n) => Math.round(n * 100) / 100;
const fmt = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

function todayUtc() { return new Date().toISOString().slice(0, 10); }
function isExempt(member) { return member.key_type === 'platform_admin'; }

function isExpired(member) {
  if (isExempt(member)) return false;
  const exp = member.subscription_expiry_date;
  return !!exp && String(exp).slice(0, 10) < todayUtc();
}

// null = unlimited. May be negative (beta rule for roleplay).
function creditsRemaining(member) {
  if (isExempt(member) || member.credits_total == null) return null;
  return round2(Number(member.credits_total) - Number(member.credits_used || 0));
}

// null = full industry list
function industryRestriction(member) {
  if (isExempt(member)) return null;
  const a = member.allowed_industry_ids;
  return Array.isArray(a) && a.length > 0 ? a : null;
}

function deny(code, message, extra = {}) {
  return { status: 403, body: { ok: false, code, message, ...extra } };
}

// Returns null when allowed, otherwise { status, body } for respond().
function checkAccess(member, { requireFull = false, needCredits = 0 } = {}) {
  if (member.is_active === false) {
    return deny('deactivated', 'This account has been deactivated. Please contact your administrator.');
  }
  if (requireFull && member.access_level === 'roleplay_only') {
    return deny('roleplay_only', 'Your account is set up for Roleplay only.');
  }
  if (isExempt(member)) return null;
  if (isExpired(member)) {
    return deny('expired', `Your subscription ended on ${String(member.subscription_expiry_date).slice(0, 10)}. Please contact your administrator to renew.`);
  }
  if (needCredits > 0) {
    const rem = creditsRemaining(member);
    if (rem !== null && rem < needCredits) {
      return deny('no_credits',
        `This needs at least ${fmt(needCredits)} credits and you have ${fmt(Math.max(rem, 0))}. Please contact your administrator to add more.`,
        { credits_needed: needCredits, credits_remaining: rem });
    }
  }
  return null;
}

// Best-effort audit row; returns its id (or null). A ledger failure must never
// break the action it records.
async function tryLedger(row) {
  try {
    const r = await supaPost('credit_ledger', row);
    return { ok: true, id: r && r[0] ? r[0].id : null };
  } catch (e) {
    console.error('credit_ledger write failed (non-fatal):', e.message);
    return { ok: false, id: null, error: e.message };
  }
}

async function recordLedger(row) {
  return (await tryLedger(row)).id;
}

async function linkLedger(ledgerId, reportId) {
  if (!ledgerId || !reportId) return;
  try { await supaPatch(`credit_ledger?id=eq.${ledgerId}`, { report_id: reportId }); } catch (e) { /* non-fatal */ }
}

// Spend credits for an action. opts: { amount (override the price), allowNegative
// (beta roleplay rule), reportId, note }. Returns { ok, charged, remaining, ledgerId }.
async function charge(member, actionKey, opts = {}) {
  const amount = round2(opts.amount != null ? opts.amount : PRICES[actionKey]);
  if (!(amount > 0)) throw new Error('charge: no price for action ' + actionKey);
  if (isExempt(member) || member.credits_total == null) return { ok: true, charged: 0, remaining: null, ledgerId: null };

  let current = member;
  for (let attempt = 0; attempt < 6; attempt++) {
    const total = Number(current.credits_total);
    const used = round2(Number(current.credits_used || 0));
    const remaining = round2(total - used);
    if (!opts.allowNegative && remaining < amount) {
      return { ok: false, code: 'no_credits', message: `This needs ${fmt(amount)} credits and you have ${fmt(Math.max(remaining, 0))}. Please contact your administrator to add more.` };
    }
    const newUsed = round2(used + amount);
    const rows = await supaPatch(`team_members?id=eq.${member.id}&credits_used=eq.${used}`, { credits_used: newUsed });
    if (rows.length === 1) {
      const balanceAfter = round2(total - newUsed);
      const ledgerId = await recordLedger({ member_id: member.id, report_id: opts.reportId || null, action: actionKey, delta: -amount, balance_after: balanceAfter, note: opts.note || null });
      return { ok: true, charged: amount, remaining: balanceAfter, ledgerId };
    }
    const fresh = await supaGet(`team_members?id=eq.${member.id}&select=credits_total,credits_used`);
    if (!fresh.length) break;
    current = { ...member, ...fresh[0] };
  }
  return { ok: false, code: 'busy', message: 'Could not record this charge right now — please try again.' };
}

// Give credits back when the action they were spent on never actually started.
async function refund(member, amount, opts = {}) {
  try {
    if (isExempt(member) || member.credits_total == null || !(amount > 0)) return;
    for (let attempt = 0; attempt < 5; attempt++) {
      const fresh = await supaGet(`team_members?id=eq.${member.id}&select=credits_total,credits_used`);
      if (!fresh.length) return;
      const used = round2(Number(fresh[0].credits_used || 0));
      if (used <= 0) return;
      const give = Math.min(round2(amount), used); // never below zero used
      const newUsed = round2(used - give);
      const rows = await supaPatch(`team_members?id=eq.${member.id}&credits_used=eq.${used}`, { credits_used: newUsed });
      if (rows.length === 1) {
        await recordLedger({ member_id: member.id, report_id: opts.reportId || null, action: 'refund', delta: give, balance_after: round2(Number(fresh[0].credits_total) - newUsed), note: opts.note || null });
        return;
      }
    }
  } catch (e) { /* a failed refund must never mask the real error */ }
}

// What the frontend needs to render limits, the balance, prices and menus.
function describeAccess(member) {
  const remaining = creditsRemaining(member);
  const exempt = isExempt(member);
  return {
    access_level: member.access_level || 'full',
    roleplay_only: member.access_level === 'roleplay_only',
    exempt,
    plan_type: member.plan_type || null,
    expires_on: exempt ? null : (member.subscription_expiry_date || null),
    expired: isExpired(member),
    credits_total: exempt || member.credits_total == null ? null : Number(member.credits_total),
    credits_used: round2(Number(member.credits_used || 0)),
    credits_remaining: remaining,
    unlimited: remaining === null,
    low_credits: remaining !== null && remaining <= LOW_CREDITS,
    out_of_credits: remaining !== null && remaining <= 0,
    presales_cycles_left: remaining === null ? null : Math.floor(Math.max(remaining, 0) / FULL_CYCLE),
    prices: PRICES,
    full_cycle_cost: FULL_CYCLE,
    credit_unit_usd: CREDIT_UNIT_USD,
    english_only: !!member.english_only,
    allowed_industry_ids: industryRestriction(member),
    can_clear_data: member.key_type === 'platform_admin' || member.key_type === 'institutional_admin' || member.can_clear_data !== false
  };
}

module.exports = {
  CREDIT_UNIT_USD, PRICES, MIN_TO_START_ROLEPLAY, FULL_CYCLE, LOW_CREDITS, round2,
  isExempt, isExpired, creditsRemaining, industryRestriction,
  checkAccess, charge, refund, recordLedger, tryLedger, linkLedger, describeAccess
};
