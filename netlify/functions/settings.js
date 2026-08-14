// PREPDO — settings.js
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

const { getMemberFromSession, supaGet, supaPatch, callClaude, extractText, respond, handleOptions } = require('./_lib.js');

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
      return respond(200, {
        ok: true,
        user_segment: member.user_segment,
        selling_company_name: member.selling_company_name,
        selling_company_website: member.selling_company_website,
        org_context_research: member.org_context_research,
        industry_context_id: member.industry_context_id
      });
    }

    if (action === 'update-my-segment') {
      if (member.key_type !== 'admin') {
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
      const rows = await supaGet(`industry_contexts?select=id,industry_name&order=display_order.asc`);
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
      // Confirm the industry actually exists before pointing at it.
      const check = await supaGet(`industry_contexts?id=eq.${industry_context_id}&select=id`);
      if (!check.length) {
        return respond(404, { ok: false, message: 'Industry not found.' });
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
      if (member.key_type !== 'admin') {
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
      if (member.key_type !== 'admin') {
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

    if (action === 'research-org-context') {
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

    return respond(400, { ok: false, message: 'Unknown action: ' + action });
  } catch (err) {
    return respond(500, { ok: false, message: 'Server error: ' + err.message });
  }
};
