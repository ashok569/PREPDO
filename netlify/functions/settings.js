// PREPDO — settings.js
// BUILD 57 | 2026-10-02
// TEMPORARY credit-request provision. There is no email service yet, so
// 'request-credits' records a user's top-up request on their own row
// (credit_request_at / credit_request_note, migration_v27.sql) — User Setup
// shows it as a tag against that user — and returns what the screen needs to
// open a pre-written email to the administrator. The server cannot send mail
// itself; the user presses Send in their own email app, and the in-app record
// is the dependable part. One request per user at a time (a new one replaces
// the old), so nothing can pile up. Refused for accounts with no credit limit.
// get-my-settings also returns credit_request_at so the screen can say a
// request is already pending. REMOVE this (and the two columns) once the real
// email / notification system exists.
//
// BUILD 56 | 2026-09-29
// Terms of Use. get-my-settings now includes a `terms` block (current version,
// the version this user last accepted, and must_accept). New actions:
// 'get-terms' returns the current version's full content (any logged-in user,
// not admin-gated — same reasoning as get-industry-preview: reading it isn't
// sensitive); 'accept-terms' records the version and timestamp on the caller's
// own row, and is pinned to the CURRENT version — a stale or guessed version
// number is rejected rather than silently accepted. platform_admin is exempt
// from must_accept (their own account, not a real user needing to consent),
// matching how they're already exempt from credits/expiry elsewhere.
//
// BUILD 55 | 2026-09-29
// Custom (non-public) industries — for a bespoke, single-client document like
// KBR's, which must never appear to an ordinary B2B user. industry_contexts
// gained is_public (migration_v23.sql; existing rows default true, so nothing
// already live changes). Two real gaps found while tracing this end to end,
// consistent with this file's own stated rule of enforcing server-side, not
// just hiding in the UI:
//  - list-industries: an unrestricted caller previously saw the WHOLE table.
//    Now: platform-level (platform_admin/institutional_admin) still sees
//    everything; anyone else unrestricted sees only is_public rows. An
//    org_admin is "anyone else" here even though they're not gated elsewhere
//    in this file — they must never see or hand out a custom industry.
//  - select-industry only checked the row EXISTED, never whether the caller
//    was allowed to pick it — a non-public id could be set directly even
//    though it was hidden from the dropdown. Now checked explicitly.
//
// BUILD 54 | 2026-09-28
// Added 'credit_ledger' (migration_v22.sql) to the Full Data Backup table
// list — the same gap Build 52 fixed for the tier tables: a new table is not
// backed up unless it is named here.
//
// BUILD 53 | 2026-09-24
// Access levels / credits / industry restrictions / roleplay language.
// get-my-settings now returns an `access` block (plan, expiry, credits
// remaining and prices, Full vs Roleplay-only, allowed industries, English-only) so
// the frontend can render limits and the credit balance. list-industries is
// filtered to the user's allowed industries (platform_admin always sees
// all — the library editor needs the full list). select-industry and
// research-org-context are ENFORCED here, not just hidden in the UI: a
// user locked to an industry cannot switch it, nor use the "Other"
// route, which would clear it. New action 'set-english-only' backs the
// roleplay language toggle.
//
// BUILD 52 | 2026-09-11
// Real gap found via a direct backup-file inspection after today's
// deploy: the 3 new tables from migration_v18.sql/v19.sql
// (organizations, subscriptions, report_backups) were never added to
// the export-all-data table list, despite existing and working
// correctly (confirmed directly — the same backup that revealed the
// gap also confirmed the tier rework and organization_id backfill had
// landed correctly). Added all 3.
//
// BUILD 51 | 2026-09-06
// Updated all 4 admin checks from 'admin' to 'platform_admin' — these
// are genuine platform-wide tool-access checks (Industry Library,
// segment switching, Full Data Backup), correctly staying exclusive to
// that one tier rather than being converted to the new org-scoped
// getScopeFilter()/isInScope() pattern used in prospects.js/roleplay-
// turn.js, which is for record-level scoping, not platform-tool access.
//
// BUILD 50 | 2026-09-06
// Added 'api_usage_log' to the Full Data Backup export table list —
// the new real API usage tracking table (migration_v16.sql, built
// alongside prompt caching in _lib.js) becomes reviewable through the
// backup you already have, rather than needing a separate new UI.
//
// BUILD 49 | 2026-08-16
// Added 'export-all-data' — a temporary, manual full-database backup
// for platform admin, given Supabase Free tier has zero automated
// backups (confirmed directly). Dumps every table as one combined
// JSON structure. Worth being honest about this being a stopgap, not
// a real backup strategy — and about a real scaling ceiling: this
// runs as a regular (non-background) function, so it will eventually
// hit Netlify's response-size/execution-time limits if data volume
// grows substantially. Fine for current, still-small scale; revisit
// if/when that changes.
//
// BUILD 42 | 2026-08-14
// Added 'get-industry-preview' — a genuinely public read action (NOT
// admin-gated), for the two-column Settings redesign: a regular Non-
// LMI user picking their own industry now sees a live preview of that
// industry's content before saving. Deliberately separate from
// 'admin-get-industry-content' below — viewing this content isn't
// sensitive (the AI already uses it when generating that user's own
// reports), only EDITING shared library content stays admin-only.
//
// BUILD 39 | 2026-08-14
// Added the pre-built industry context library (migration_v12.sql/
// migration_v13.sql). Three new actions:
//   'list-industries' — names only, for the dropdown, open to any
//     logged-in user (not admin-gated — same reasoning as
//     research-org-context: this is a real Non-LMI user's own setup).
//   'select-industry' — sets a Non-LMI user's industry_context_id +
//     company name, skips the web-search research step entirely since
//     the pre-built industry content does that job instead.
//   'admin-get-industry-content' / 'admin-update-industry-content' —
//     ADMIN-gated (unlike the two above) — this is genuinely editing
//     shared library content every future Non-LMI user in that
//     industry will see, not a personal setting, so it stays
//     restricted the same way update-my-segment does.
//
// BUILD 36 | 2026-08-13
// Real design correction made here: 'research-org-context' and
// 'get-my-settings' below are deliberately NOT admin-gated, unlike
// 'update-my-segment'. These are two genuinely different kinds of
// setting — which methodology a user gets is an access-control
// decision (stays admin-only, a real Non-LMI user shouldn't be able
// to self-upgrade into LMI's proprietary methodology), but a Non-LMI
// user's own selling-company context is them describing THEIR OWN
// business, the SPIN-side equivalent of what LMI users get for free
// from lmi-context.md. Gating that behind admin would mean a real
// non-LMI user could never complete their own setup at all.

const { getMemberFromSession, supaGet, supaPatch, callClaude, extractText, logApiUsage, respond, handleOptions } = require('./_lib.js');
const { describeAccess, industryRestriction } = require('./_access.js');

async function currentTerms() {
  const rows = await supaGet(`legal_documents?doc_type=eq.terms_of_use&order=version.desc&limit=1`);
  return rows.length ? rows[0] : null;
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

    if (action === 'get-my-settings') {
      const terms = await currentTerms();
      const exempt = member.key_type === 'platform_admin';
      return respond(200, {
        ok: true,
        user_segment: member.user_segment,
        selling_company_name: member.selling_company_name,
        selling_company_website: member.selling_company_website,
        org_context_research: member.org_context_research,
        industry_context_id: member.industry_context_id,
        access: describeAccess(member),
        credit_request_at: member.credit_request_at || null,
        terms: {
          current_version: terms ? terms.version : null,
          accepted_version: member.terms_accepted_version || null,
          accepted_at: member.terms_accepted_at || null,
          must_accept: !exempt && !!terms && member.terms_accepted_version !== terms.version
        }
      });
    }

    if (action === 'get-terms') {
      const terms = await currentTerms();
      if (!terms) {
        return respond(404, { ok: false, message: 'No Terms of Use are published yet.' });
      }
      return respond(200, { ok: true, version: terms.version, content: terms.content, effective_date: terms.effective_date });
    }

    if (action === 'accept-terms') {
      const terms = await currentTerms();
      if (!terms) {
        return respond(404, { ok: false, message: 'No Terms of Use are published yet.' });
      }
      const { version } = payload;
      if (version !== terms.version) {
        return respond(409, { ok: false, message: 'A newer version of the Terms of Use is now current — please review it again.', current_version: terms.version });
      }
      await supaPatch(`team_members?id=eq.${member.id}`, { terms_accepted_version: terms.version, terms_accepted_at: new Date().toISOString() });
      return respond(200, { ok: true, accepted_version: terms.version });
    }

    if (action === 'update-my-segment') {
      if (member.key_type !== 'platform_admin') {
        return respond(403, { ok: false, message: 'Admin only.' });
      }
      const { segment } = payload;
      if (segment !== 'lmi' && segment !== 'non_lmi') {
        return respond(400, { ok: false, message: 'segment must be "lmi" or "non_lmi".' });
      }
      await supaPatch(`team_members?id=eq.${member.id}`, { user_segment: segment });
      return respond(200, { ok: true, user_segment: segment });
    }

    if (action === 'list-industries') {
      // Restricted users see only the industries their administrator
      // allowed (custom or public — an explicit assignment always wins).
      // An unrestricted caller sees only public industries, UNLESS they are
      // platform-level, who see everything (the library editor, and the
      // User Setup checklist, both need the full list).
      const allowedIds = industryRestriction(member);
      const platformLevel = member.key_type === 'platform_admin' || member.key_type === 'institutional_admin';
      const filter = allowedIds ? `&id=in.(${allowedIds.join(',')})` : (platformLevel ? '' : '&is_public=eq.true');
      const rows = await supaGet(`industry_contexts?select=id,industry_name&order=display_order.asc${filter}`);
      return respond(200, { ok: true, industries: rows });
    }

    if (action === 'select-industry') {
      const { industry_context_id, selling_company_name } = payload;
      if (!industry_context_id) {
        return respond(400, { ok: false, message: 'industry_context_id is required.' });
      }
      if (!selling_company_name || !selling_company_name.trim()) {
        return respond(400, { ok: false, message: 'Company name is required.' });
      }
      const allowedIds = industryRestriction(member);
      if (allowedIds && !allowedIds.includes(industry_context_id)) {
        return respond(403, { ok: false, message: 'That industry is not available on your account.' });
      }
      // Confirm the industry exists AND, for an unrestricted non-platform-level
      // caller, that it's public — enforced here, not just hidden from the
      // dropdown (an id could otherwise be set directly, bypassing the UI).
      const check = await supaGet(`industry_contexts?id=eq.${industry_context_id}&select=id,is_public`);
      if (!check.length) {
        return respond(404, { ok: false, message: 'Industry not found.' });
      }
      const platformLevel = member.key_type === 'platform_admin' || member.key_type === 'institutional_admin';
      if (!allowedIds && !platformLevel && !check[0].is_public) {
        return respond(403, { ok: false, message: 'That industry is not available on your account.' });
      }
      await supaPatch(`team_members?id=eq.${member.id}`, {
        industry_context_id,
        selling_company_name: selling_company_name.trim()
      });
      return respond(200, { ok: true });
    }

    if (action === 'get-industry-preview') {
      // Deliberately NOT admin-gated, unlike admin-get-industry-content
      // below — a regular Non-LMI user previewing an industry's content
      // before selecting it isn't a sensitive operation (the AI already
      // uses this exact content when generating their reports, so
      // there's no real confidentiality reason to hide it from them).
      // Only EDITING shared content stays admin-only.
      const { industry_context_id } = payload;
      if (!industry_context_id) {
        return respond(400, { ok: false, message: 'industry_context_id is required.' });
      }
      const rows = await supaGet(`industry_contexts?id=eq.${industry_context_id}&select=context_content`);
      if (!rows.length) {
        return respond(404, { ok: false, message: 'Industry not found.' });
      }
      return respond(200, { ok: true, context_content: rows[0].context_content });
    }

    if (action === 'admin-get-industry-content') {
      if (member.key_type !== 'platform_admin') {
        return respond(403, { ok: false, message: 'Admin only.' });
      }
      const { industry_context_id } = payload;
      if (!industry_context_id) {
        return respond(400, { ok: false, message: 'industry_context_id is required.' });
      }
      const rows = await supaGet(`industry_contexts?id=eq.${industry_context_id}&select=*`);
      if (!rows.length) {
        return respond(404, { ok: false, message: 'Industry not found.' });
      }
      return respond(200, { ok: true, industry: rows[0] });
    }

    if (action === 'admin-update-industry-content') {
      if (member.key_type !== 'platform_admin') {
        return respond(403, { ok: false, message: 'Admin only.' });
      }
      const { industry_context_id, context_content } = payload;
      if (!industry_context_id || !context_content || !context_content.trim()) {
        return respond(400, { ok: false, message: 'industry_context_id and context_content are both required.' });
      }
      await supaPatch(`industry_contexts?id=eq.${industry_context_id}`, {
        context_content: context_content.trim(),
        updated_at: new Date().toISOString()
      });
      return respond(200, { ok: true });
    }

    if (action === 'export-all-data') {
      // Temporary measure — Supabase Free tier has zero automated
      // backups (confirmed directly, not assumed). This is a stopgap
      // manual export, not a substitute for actually moving to a
      // tier with real backups when that becomes the priority it
      // should be. Dumps every table as one combined JSON structure —
      // simplest reliable format, preserves exact data types
      // (including jsonb columns) faithfully, at the cost of not
      // being directly Excel-readable. A CSV-per-table version would
      // be a reasonable future upgrade if that's ever actually needed.
      if (member.key_type !== 'platform_admin') {
        return respond(403, { ok: false, message: 'Admin only.' });
      }
      const tables = ['team_members', 'prospects', 'reports', 'folders', 'industry_contexts', 'action_items', 'stalls_objections_log', 'learnings', 'api_usage_log', 'organizations', 'subscriptions', 'report_backups', 'credit_ledger'];
      const dump = { exported_at: new Date().toISOString(), tables: {} };
      for (const table of tables) {
        try {
          dump.tables[table] = await supaGet(`${table}?select=*`);
        } catch (err) {
          // A missing/inaccessible table shouldn't abort the whole
          // export — record the failure and keep going, so a real
          // backup attempt doesn't come back completely empty over
          // one bad table.
          dump.tables[table] = { error: err.message };
        }
      }
      return respond(200, { ok: true, dump });
    }

    if (action === 'research-org-context') {
      // This route clears industry_context_id, which would bypass an
      // administrator-set industry — so it is closed to restricted users.
      if (industryRestriction(member)) {
        return respond(403, { ok: false, message: 'Your industry is set by your administrator.' });
      }
      const { selling_company_name, selling_company_website } = payload;
      if (!selling_company_name || !selling_company_name.trim()) {
        return respond(400, { ok: false, message: 'Company name is required.' });
      }

      let researchText;
      try {
        const res = await callClaude({
          model: 'claude-haiku-4-5-20251001',
          system: `You are doing one small piece of research to help a salesperson's AI sales-coaching tool understand THEIR OWN employer's business — not a prospect, their own company. Use web search — exactly one search — to find out what this company sells, who they typically sell to, and the general nature of their offering (e.g. software, consultancy, professional services, a physical product). Return 3-5 short bulleted markdown facts. If search turns up nothing useful, say plainly "Nothing specific found — proceed with the company name and website alone as context." Keep it brief and factual, not speculative.`,
          messages: [{
            role: 'user',
            content: `Company: ${selling_company_name}\nWebsite: ${selling_company_website || '(not provided)'}`
          }],
          tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 1 }],
          max_tokens: 600
        });
        await logApiUsage({ member_id: member.id, report_id: null, function_name: 'settings', action: 'research-org-context', model: res.model, claudeResponse: res });
        researchText = extractText(res) || 'Nothing specific found — proceed with the company name and website alone as context.';
      } catch (err) {
        researchText = 'Research failed (' + err.message + ') — proceed with the company name and website alone as context.';
      }

      // Choosing "Other"/company-specific research clears any
      // previously-selected pre-built industry, so the two paths don't
      // silently coexist in a confusing way — the user chose a
      // different setup path this time.
      await supaPatch(`team_members?id=eq.${member.id}`, {
        selling_company_name: selling_company_name.trim(),
        selling_company_website: (selling_company_website || '').trim() || null,
        org_context_research: researchText,
        industry_context_id: null
      });

      return respond(200, { ok: true, org_context_research: researchText });
    }

    // TEMPORARY (Build 57) — see the header note. Remove with the email system.
    if (action === 'request-credits') {
      const access = describeAccess(member);
      if (access.exempt || access.unlimited) {
        return respond(400, { ok: false, message: 'Your account has no credit limit, so there is nothing to request.' });
      }
      const note = String(payload.note || '').trim().slice(0, 300) || null;
      const requestedAt = new Date().toISOString();
      await supaPatch(`team_members?id=eq.${member.id}`, { credit_request_at: requestedAt, credit_request_note: note });
      return respond(200, {
        ok: true,
        request: {
          email: member.email,
          name: member.name || null,
          plan_type: access.plan_type,
          credits_remaining: access.credits_remaining,
          credits_total: access.credits_total,
          expires_on: access.expires_on,
          note,
          requested_at: requestedAt
        }
      });
    }

    if (action === 'set-english-only') {
      const value = payload.english_only === true;
      await supaPatch(`team_members?id=eq.${member.id}`, { english_only: value });
      return respond(200, { ok: true, english_only: value });
    }

    return respond(400, { ok: false, message: 'Unknown action: ' + action });
  } catch (err) {
    return respond(500, { ok: false, message: 'Server error: ' + err.message });
  }
};
