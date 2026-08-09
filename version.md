# PREPDO — Build History

This tracks the actual deployed code, separately from the design/scope conversation (which has its own versioning in the `PREPDO_AI_Sales_Coach_vX.X_Scope.md` documents). Every file in this codebase carries a header comment stating which Build it was last touched in and what changed — this file is the index of that.

## Build 1 — Initial login screen (foundation only)
- First testable batch: login screen with PREPDO wordmark, pre-generated key pool (`keys.js`, 5000 member + 10 admin keys), basic `login.js` function, initial `schema.sql`.
- **Superseded entirely by Build 2** — the key-pool approach was replaced, not extended.

## Build 2 — Invite-token auth rebuild + bug fixes
- Replaced the pre-generated key pool with on-the-fly invite tokens: `invite.js`, `activate.js`, `check-session.js`, `request-login-link.js`.
- New `invites` table; `team_members.access_key` removed in favor of `session_token_hash`.
- **Bug fixes found during real-world testing:**
  - CORS headers added (fixed "Failed to fetch" from tools hosted off the main domain)
  - Every Supabase call wrapped in try/catch (fixed a silent 502 crash in `check-session.js` — errors now return readable JSON instead of an opaque server error)
  - Diagnosed and fixed a Supabase `service_role` permissions gap (`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO service_role;`) — not a code bug, but a required one-time database fix

## Build 3 — Prospects + Presales Prep (current)
- New: `prospects.js` (list/create/get, scoped by owner)
- New: `presales-research.js` (Step 1 — real web search via Claude API)
- New: `presales-generate.js` (Step 2 — full 4-part report using `lmi-context.md`)
- New: `app.html` (the actual app UI — Prospects list, detail, new-prospect form, Presales Prep flow with tabs and Save-as-Word)
- Updated: `index.html` (redirects into `app.html` on successful login instead of dead-ending)
- Updated: `_lib.js` (added `getMemberFromSession()`, `callClaude()`, `extractText()`)
- New: `migration_v1.sql` (additive — 3 new columns on `reports`)
- New env var required: `ANTHROPIC_API_KEY`

## Convention going forward

Every file change gets a header comment at the top:
