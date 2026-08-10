// PREPDO — meeting-analysis-start.js
// BUILD 21 | 2026-08-10
// New file. Mirrors presales-generate-start.js exactly — fast, creates
// a 'pending' report row (report_type: 'meeting_analysis'), stores the
// raw transcript and the full structured-form + self-reflection blob
// immediately (so nothing is lost even if the AI analysis later fails),
// kicks off meeting-analysis-background.js, returns report_id so the
// frontend can start polling. Includes the Build 15 fix from day one
// this time — checks the trigger response status, not just for a
// thrown exception.

const { getMemberFromSession, supaPost, supaPatch, respond, handleOptions } = require('./_lib.js');

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

  const { session_token, prospect_id, prospect, meeting } = payload;

  try {
    const member = await getMemberFromSession(session_token);
    if (!member) {
      return respond(401, { ok: false, message: 'Not logged in. Please log in again.' });
    }
    if (!prospect_id || !prospect || !meeting) {
      return respond(400, { ok: false, message: 'prospect_id, prospect, and meeting are all required.' });
    }

    // At least one real input is required — an empty form with nothing
    // to analyze isn't a useful report.
    const hasTranscript = meeting.transcript && meeting.transcript.trim();
    const hasStructured = meeting.rapport || (meeting.challenges && meeting.challenges.some((c) => c.description));
    if (!hasTranscript && !hasStructured) {
      return respond(400, { ok: false, message: 'Add a transcript, fill in the structured form, or both — at least one is needed.' });
    }

    // structured_data (jsonb) holds everything except the raw
    // transcript and meeting metadata — the structured form fields and
    // self-reflection, exactly as the frontend sent them.
    const structuredData = { ...meeting };
    delete structuredData.transcript; // stored separately in transcript_raw

    const [report] = await supaPost('reports', {
      prospect_id,
      owner_id: member.id,
      report_type: 'meeting_analysis',
      meeting_number: meeting.meeting_number || null,
      meeting_date: meeting.meeting_date || null,
      input_mode: hasTranscript && hasStructured ? 'both' : hasTranscript ? 'transcript' : 'structured',
      transcript_raw: meeting.transcript || null,
      structured_data: structuredData,
      status: 'pending'
    });

    const bgUrl = `${process.env.URL || ''}/.netlify/functions/meeting-analysis-background`;
    try {
      const triggerRes = await fetch(bgUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          report_id: report.id,
          prospect,
          meeting,
          session_token
        })
      });

      if (!triggerRes.ok) {
        const detail = await triggerRes.text().catch(() => '');
        await supaPatch(`reports?id=eq.${report.id}`, {
          status: 'failed',
          error_message: `Could not start analysis: background function returned ${triggerRes.status}. ${detail}`.trim()
        });
        return respond(200, { ok: true, report_id: report.id });
      }
    } catch (triggerErr) {
      await supaPatch(`reports?id=eq.${report.id}`, {
        status: 'failed',
        error_message: 'Could not start analysis: ' + triggerErr.message
      });
      return respond(200, { ok: true, report_id: report.id });
    }

    return respond(200, { ok: true, report_id: report.id });
  } catch (err) {
    return respond(500, { ok: false, message: 'Server error: ' + err.message });
  }
};
