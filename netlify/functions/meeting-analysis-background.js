// PREPDO — meeting-analysis-background.js
// BUILD 21 | 2026-08-10
// New file. THE FILENAME SUFFIX "-background" IS REQUIRED — same rule
// as presales-generate-background.js. Do not rename without keeping it.
//
// Produces the 8 Meeting Analysis outputs, mapped onto `reports`
// columns like this (7 display tabs, since Score+Probability share one
// tab with their reasoning):
//   Detailed                -> ai_output_detailed
//   Summary                 -> ai_output_summary
//   Overall Score (/10)     -> overall_score (number) + reasoning in ai_output_extra
//   Probability of Close(%) -> probability_of_close (number) + reasoning in ai_output_extra
//   Recommended Actions     -> recommended_actions (jsonb array)
//   Missed Items            -> ai_output_missed
//   Emergent Opportunities  -> ai_output_opportunities
//   Points to Ponder        -> ai_output_ponder
//
// Split into 3 parallel calls (no time-pressure — Background Function,
// same pattern as presales-generate-background.js):
//   1. "core"    — Detailed, Summary, Overall Score
//   2. "scoring" — Probability of Close, Recommended Actions
//   3. "gaps"    — Missed Items, Emergent Opportunities, Points to Ponder
// All three get the full lmi-context.md — unlike Presales Prep,

