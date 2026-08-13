// PREPDO — folders.js
// BUILD 32 | 2026-08-12
// New file. Folders are personal to each owner (same scoping pattern
// as prospects.js — admins get their own folders too, not a shared
// team-wide set, since folders are purely a personal organizing aid,
// not an access-control mechanism).
//
// Deleting a folder does NOT delete the prospects filed in it — it
// un-files them (folder_id set back to null) so they simply return to
// the default "All Prospects" view. A folder is a label, never a
// container that owns data; losing a folder should never risk losing
// a prospect.

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
      const rows = await supaGet(`folders?owner_id=eq.${member.id}&select=*&order=name.asc`);
      return respond(200, { ok: true, folders: rows });
    }

    if (action === 'create') {
      const { name } = payload;
      if (!name || !name.trim()) {
        return respond(400, { ok: false, message: 'Folder name is required.' });
      }
      const [folder] = await supaPost('folders', {
        owner_id: member.id,
        name: name.trim()
      });
      return respond(200, { ok: true, folder });
    }

    if (action === 'delete') {
      const { folder_id } = payload;
      if (!folder_id) {
        return respond(400, { ok: false, message: 'folder_id required.' });
      }
      const existing = await supaGet(`folders?id=eq.${folder_id}&select=id,owner_id`);
      if (!existing.length) {
        return respond(404, { ok: false, message: 'Folder not found.' });
      }
      if (existing[0].owner_id !== member.id) {
        return respond(403, { ok: false, message: 'Not authorized to delete this folder.' });
      }

      // Un-file every prospect in this folder before deleting it —
      // never delete prospects as a side effect of deleting a folder.
      await supaPatch(`prospects?folder_id=eq.${folder_id}`, { folder_id: null });
      await supaDelete(`folders?id=eq.${folder_id}`);

      return respond(200, { ok: true });
    }

    return respond(400, { ok: false, message: 'Unknown action: ' + action });
  } catch (err) {
    return respond(500, { ok: false, message: 'Server error: ' + err.message });
  }
};
