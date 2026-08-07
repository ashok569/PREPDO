// /netlify/functions/_lib.js
//
// Shared helpers for the invite/activation/session system.
// Not deployed as its own endpoint — required by the other functions.

const crypto = require('crypto');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function supaHeaders(extra = {}) {
  return {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    ...extra
  };
}

async function supaGet(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: supaHeaders() });
  if (!res.ok) throw new Error(`Supabase GET ${path} failed: ${res.status}`);
  return res.json();
}

async function supaPost(path, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'POST',
    headers: supaHeaders({ Prefer: 'return=representation' }),
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`Supabase POST ${path} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function supaPatch(path, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'PATCH',
    headers: supaHeaders({ Prefer: 'return=representation' }),
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`Supabase PATCH ${path} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

// Generates a random URL-safe token. Only its hash is ever stored.
function generateToken() {
  return crypto.randomBytes(32).toString('base64url'); // 43 chars, URL-safe
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function respond(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  };
}

// Computes subscription_start_date / subscription_expiry_date / status
// for a first activation, matching the trial=3mo / paid=1yr rule.
function computeSubscriptionFields(subscriptionType) {
  const now = new Date();
  const expiry = new Date(now);
  if (subscriptionType === 'paid') {
    expiry.setFullYear(expiry.getFullYear() + 1);
  } else {
    expiry.setMonth(expiry.getMonth() + 3);
  }
  return {
    first_login_at: now.toISOString(),
    subscription_start_date: now.toISOString().slice(0, 10),
    subscription_expiry_date: expiry.toISOString().slice(0, 10),
    subscription_status: 'active'
  };
}

module.exports = {
  supaGet, supaPost, supaPatch,
  generateToken, hashToken,
  respond,
  computeSubscriptionFields
};
