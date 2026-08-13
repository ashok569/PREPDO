// PREPDO — prospects.js
// BUILD 14 | 2026-08-12
// New: folder support (migration_v8.sql) — list now accepts an
// optional folder_id filter (a real folder id, the literal string
// 'unfiled' for prospects with no folder, or omitted entirely for the
// unfiltered "All Prospects" view), and a new move-to-folder action
// checks the target folder actually belongs to the requesting member
// before filing a prospect into it — a crafted request shouldn't be
// able to file into someone else's folder.
//
// BUILD 13 | 2026-08-10
// New this build: delete (with cascading cleanup of dependent rows —
// reports, action_items, stalls_objections_log, learnings — since
// Postgres foreign keys would otherwise block deleting a prospect that
// has any reports), archive/unarchive, and list now filters by the new
// archived flag so archived prospects don't clutter the main list.
// Both delete and archive/unarchive check ownership (or admin) before
// acting, matching the same access rule already used for list/get.

// /netlify/functions/prospects.js
//
// Handles Prospects: list (filtered to the logged-in user, or all for
// admins; optionally archived-only), create, get-one (with its report
// history), delete (permanent, cascades to dependent rows), archive,
// and unarchive.
//
// Request body always includes { session_token, action, ...fields }

const { getMemberFromSession, supaGet, supaPost, supaPatch, supaDelete, respond, handleOptions } = require('./_lib.js');

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

    if (action === 'list') {
      const scope = member.key_type === 'admin' ? '' : `&owner_id=eq.${member.id}`;
      const archivedValue = payload.archived ? 'true' : 'false';
      // folder_id filtering (BUILD 32): omit entirely for "All
      // Prospects" (default, unfiltered by folder), pass a real folder
      // id to see just that folder's prospects, or pass the literal
      // string 'unfiled' to see prospects with no folder assigned.
      let folderFilter = '';
      if (payload.folder_id === 'unfiled') {
        folderFilter = '&folder_id=is.null';
      } else if (payload.folder_id) {
        folderFilter = `&folder_id=eq.${payload.folder_id}`;
      }
      const rows = await supaGet(`prospects?select=*${scope}&archived=eq.${archivedValue}${folderFilter}&order=created_at.desc`);
      return respond(200, { ok: true, prospects: rows });
    }

    if (action === 'create') {
      const { company_name, company_website, prospect_name, linkedin_url, position, meeting_objective, notes } = payload;
      if (!company_name) {
        return respond(400, { ok: false, message: 'Company name is required.' });
      }
      const [row] = await supaPost('prospects', {
        owner_id: member.id,
        company_name,
        company_website: company_website || null,
        prospect_name: prospect_name || null,
        linkedin_url: linkedin_url || null,
        position: position || null,
        meeting_objective: meeting_objective || null,
        notes: notes || null
      });
      return respond(200, { ok: true, prospect: row });
    }

    if (action === 'get') {
      const { prospect_id } = payload;
      if (!prospect_id) return respond(400, { ok: false, message: 'prospect_id required.' });

      const rows = await supaGet(`prospects?id=eq.${prospect_id}&select=*`);
      if (!rows.length) return respond(404, { ok: false, message: 'Prospect not found.' });

      const reports = await supaGet(`reports?prospect_id=eq.${prospect_id}&select=*&order=created_at.desc`);
      return respond(200, { ok: true, prospect: rows[0], reports });
    }

    if (action === 'archive' || action === 'unarchive') {
      const { prospect_id } = payload;
      if (!prospect_id) return respond(400, { ok: false, message: 'prospect_id required.' });

      const existing = await supaGet(`prospects?id=eq.${prospect_id}&select=id,owner_id`);
      if (!existing.length) return respond(404, { ok: false, message: 'Prospect not found.' });
      if (member.key_type !== 'admin' && existing[0].owner_id !== member.id) {
        return respond(403, { ok: false, message: 'Not authorized.' });
      }

      await supaPatch(`prospects?id=eq.${prospect_id}`, { archived: action === 'archive' });
      return respond(200, { ok: true });
    }

    if (action === 'move-to-folder') {
      const { prospect_id, folder_id } = payload; // folder_id may be null (un-file)
      if (!prospect_id) return respond(400, { ok: false, message: 'prospect_id required.' });

      const existing = await supaGet(`prospects?id=eq.${prospect_id}&select=id,owner_id`);
      if (!existing.length) return respond(404, { ok: false, message: 'Prospect not found.' });
      if (member.key_type !== 'admin' && existing[0].owner_id !== member.id) {
        return respond(403, { ok: false, message: 'Not authorized.' });
      }

      // If moving INTO a folder (not un-filing), confirm that folder
      // actually belongs to this member — otherwise a crafted request
      // could file a prospect into someone else's folder.
      if (folder_id) {
        const folderCheck = await supaGet(`folders?id=eq.${folder_id}&select=id,owner_id`);
        if (!folderCheck.length || folderCheck[0].owner_id !== member.id) {
          return respond(403, { ok: false, message: 'Not authorized to use this folder.' });
        }
      }

      await supaPatch(`prospects?id=eq.${prospect_id}`, { folder_id: folder_id || null });
      return respond(200, { ok: true });
    }

    if (action === 'delete') {
      const { prospect_id } = payload;
      if (!prospect_id) return respond(400, { ok: false, message: 'prospect_id required.' });

      const existing = await supaGet(`prospects?id=eq.${prospect_id}&select=id,owner_id`);
      if (!existing.length) return respond(404, { ok: false, message: 'Prospect not found.' });
      if (member.key_type !== 'admin' && existing[0].owner_id !== member.id) {
        return respond(403, { ok: false, message: 'Not authorized.' });
      }

      // Dependent rows have to go first — Postgres foreign keys would
      // otherwise block deleting a prospect that still has reports (or
      // action items, stalls/objections, learnings) pointing at it.
      await supaDelete(`reports?prospect_id=eq.${prospect_id}`);
      await supaDelete(`action_items?prospect_id=eq.${prospect_id}`);
      await supaDelete(`stalls_objections_log?prospect_id=eq.${prospect_id}`);
      await supaDelete(`learnings?prospect_id=eq.${prospect_id}`);
      await supaDelete(`prospects?id=eq.${prospect_id}`);

      return respond(200, { ok: true });
    }

    return respond(400, { ok: false, message: 'Unknown action: ' + action });
  } catch (err) {
    return respond(500, { ok: false, message: 'Server error: ' + err.message });
  }
};
