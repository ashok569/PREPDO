# SPIN Sales Context (v1 draft) — Reference Frame for PREPDO's Non-LMI Users

**Purpose:** This is the Non-LMI counterpart to `lmi-context.md`. It's embedded into every PREPDO AI call (Presales Prep, Meeting Analysis, Role Play debrief) for users flagged as `non_lmi`, so their reports reason entirely in general B2B consultative-selling terms — grounded in Neil Rackham's SPIN Selling framework (a well-established, publicly documented methodology, not proprietary to any single organization) plus widely-taught consultative sales practice.

**The one hard rule this whole file exists to enforce:** nothing LMI-specific appears anywhere in output generated against this context — no PBM, no RRR, no "Sales Cycle" as an 11-stage named structure, no EDM, no Needs=Motives four-category framing, no LMI product names (EPP, etc.), no LMI-specific scripts or phrasing. Every concept below is either genuinely universal to consultative selling or deliberately reframed in generic language. If a reasoning pattern only makes sense with LMI's specific vocabulary attached, it does not belong in this file — find or build the SPIN-generic equivalent instead, or leave it out.

**Where this applies:** identical scope to `lmi-context.md` — Presales Prep's Strategy generation, Meeting Analysis's Detailed/Score/Probability reasoning, and Role Play's debrief. Role Play's live in-character turns (`roleplay-turn.js`) already don't load either context file, by design — the AI-played persona shouldn't "know" about any sales methodology regardless of which segment the salesperson practicing belongs to.

---

## Core Methodology: SPIN

The whole reasoning frame is the SPIN question sequence — nothing layered on top, no secondary framework:

| Stage | What it does | What to listen for |
|---|---|---|
| **Situation** | Establishes context — current setup, scale, how things work today | Facts, not yet pain — resist reading problems into neutral situational answers |
| **Problem** | Surfaces difficulties, dissatisfactions, friction the prospect names themselves | The prospect's own words for what's not working — don't put words in their mouth |
| **Implication** | Explores the consequences and cost of the problem staying unaddressed | Whether the prospect connects the dots themselves to a real cost (time, money, risk, missed opportunity) — a salesperson asserting the implication is far weaker than a prospect arriving at it themselves |
| **Need-Payoff** | Gets the prospect to state, in their own words, the value of solving the problem | This is the single most important distinction in the whole framework: **value the prospect verbalises themselves is real progress; value the salesperson asserts on the prospect's behalf is not** — treat these as categorically different outcomes, never conflate them |

**Core principle carried through every module:** a good consultative meeting moves through this sequence roughly in order, but real conversations aren't linear — a prospect can jump back to Situation mid-Implication, or reveal a second Problem while answering a Need-Payoff question. Judge the meeting on whether these four kinds of ground genuinely got covered, not on whether they happened in a rigid sequence.

---

## Opening and Rapport

Generic, not tied to any named script: a first meeting should establish genuine rapport and basic credibility before moving into structured questioning — jumping straight into Situation Questions without any relationship-building context reads as interrogative, not consultative. There's no fixed time window this needs to take (context-dependent — a warm referral needs less than a cold approach), but it should be a deliberate, noticeable phase of the conversation, not skipped.

**Talk-ratio guidance, phase-aware:** the opening/rapport phase is naturally salesperson-heavy — this is normal and correct, not a flaw. Once genuine Situation/Problem questioning begins, the ratio should shift — the prospect should be doing meaningfully more of the talking than the salesperson from that point forward. **When assessing talk-ratio in Meeting Analysis or a Role Play debrief, only judge the portion of the conversation after this shift — penalizing the opening phase for being salesperson-heavy would be judging correct technique as a mistake.**

**Permission before probing:** a brief, explicit check-in before moving from small talk into real questioning (something like "would it be alright if I asked you a bit about how things currently work?") reads as more respectful and produces more open answers than sliding into Situation Questions without any transition. Its absence isn't disqualifying, but its presence is a positive, noticeable signal of good technique.

**The underlying exchange being set up:** consultative selling only works if what's being offered is perceived to outweigh what it costs to act — effort, money, change, risk. A prospect who intellectually agrees a problem exists still won't move if the perceived gain doesn't clearly exceed the perceived pain of doing something about it. When judging why a well-probed conversation still didn't lead anywhere, check this balance specifically, not just whether the right questions got asked.

**Conversation, not interrogation:** probing should read as a genuine back-and-forth — question, then real listening to the answer, then a response that either builds on what was just said or asks a natural follow-up — not a rehearsed list of questions fired one after another regardless of what came back. A sequence of technically-correct SPIN questions can still fail this test if each one ignores what the prospect just said. When a prospect asks a question back (for clarification, for more information, or as a genuine challenge), answer what was actually asked and return to the flow — lingering into an extended, unprompted explanation of the whole offering at that point is a common way conversations quietly drift off track.

**Stay on the actual presenting problem:** once a prospect names a real pain point, effective probing drills down specifically on that thread — narrowing in on exactly what it is, why it matters, what's been tried — rather than collecting a series of loosely related facts that never quite converge on the actual issue. Broad, scattered questioning that touches many surface details without ever narrowing in on the one that matters is a common, avoidable weakness, easy to mistake for thoroughness.

---

## What Drives the Decision — Buying Motive, Generically Framed

Instead of a fixed named category system, reason about buying motive along these general, universally-applicable lines — a prospect's real motive for engaging usually maps onto one or more of:

- **Cost or risk reduction** — avoiding a loss, a failure, a compliance problem, an inefficiency that's actively costing something
- **Revenue or growth enablement** — a capability that helps them make more, grow faster, or capture an opportunity currently out of reach
- **Opportunity cost** — something time-sensitive where inaction has a real, nameable cost (a window closing, a competitor moving, a chance that won't repeat)
- **Personal or professional stakes** — the individual's own standing, workload, reputation, or career trajectory, distinct from the pure business case

These aren't mutually exclusive, and a real prospect's actual motive is often a specific, personal blend of more than one — the goal is identifying which of these is *genuinely* live for this specific person in this specific conversation, grounded in what they actually said, not a generic assumption about their role or industry.

**Who owns the pain vs. who owns the budget:** these are frequently different people, and both matter. The person who most wants a problem solved isn't always the person with authority to spend money on solving it (sometimes called the "economic buyer" in general sales literature) — track both, and don't assume a single contact is automatically both.

**Stakeholder calibration for larger organizations:** in a larger, more complex organization, reaching the actual economic buyer in a first meeting is often genuinely not achievable — there may be multiple layers between the first contact and real budget authority. This is structural, not a failure of the meeting. A first meeting that secures a clear next step and identifies who else needs to be involved is a strong outcome at that scale, even without a close or a strong buying signal — judge success bars accordingly rather than applying the same standard to every company size.

---

## Quantifying Value — Elicited, Not Asserted

The single most important quality signal in the whole framework, worth restating on its own: **when a prospect states a number, an outcome, or a value themselves, in their own words, that is real progress. When a salesperson states it on the prospect's behalf ("this would probably save you X"), that is not the same thing, even if the number is correct.**

The technique to listen for and encourage: instead of asserting a value, ask questions that lead the prospect to calculate or estimate it themselves — "if that delay didn't happen, what would that mean for your timeline?" rather than "that delay is probably costing you two weeks." The former, if answered, produces a number the prospect will defend and act on; the latter produces, at best, polite agreement.

When evaluating a meeting or a roleplay for this quality: explicitly check whether any quantified value present in the conversation was *elicited* from the prospect or *supplied* by the salesperson and merely accepted. These should never be scored as equivalent.

---

## Distinguishing Genuine Problems from Behavioural Symptoms

When a prospect names a difficulty, it's useful to distinguish two different kinds, since they call for different follow-up:

- **A result-level problem** — something with a directly measurable business cost already visible (lost revenue, missed deadlines, rising costs, customer complaints)
- **A behaviour-level problem** — something about how people currently work (inconsistent process, a skill gap, a communication breakdown) that hasn't yet been connected to a measurable result

Neither is more or less valid, but a behaviour-level problem left unconnected to a result is a weaker, less compelling case than one where the salesperson has helped the prospect draw the line from the behaviour to its actual cost. A strong Implication Question often does exactly this — bridges a named behavioural symptom to its measurable consequence.

---

## Objections and Stalls

Worth distinguishing, since they call for different handling:

- **A stall** — a vague, non-specific deferral ("let me think about it," "we're not ready yet") that often masks an underlying concern the prospect hasn't stated
- **An objection** — a specific, named concern (price, timing, a particular feature gap, a competing priority)

A stall is usually better handled by gently surfacing the real concern underneath it ("what's giving you pause?") rather than trying to counter a vague statement directly. An objection, once specific, can be addressed on its own terms. Treating a stall as if it were a specific objection (arguing against something the prospect never actually said) is a common, avoidable mistake worth flagging when it appears.

---

## Buying Signals

Two rough tiers, useful for probability-of-close reasoning:

- **Ordinary signals** — the prospect asks about price, timeline, or who else would be involved; mild, easy to read as simple curiosity rather than strong intent on their own
- **Strong signals** — the prospect asks for a proposal, asks for references, states a specific implementation timeline, or begins negotiating terms; these represent a more concrete shift toward real intent

Neither tier alone determines probability of close — they're inputs to be weighed alongside whether Need-Payoff was genuinely reached and verbalised, and where the conversation sits in the natural progression toward a decision (see below).

---

## Probability of Close — Reasoning Framework

When asked to estimate a probability of close (Meeting Analysis, Role Play debrief), ground the number in these specific, named factors — never produce an impressionistic number:

1. **Was Need-Payoff reached, and reached in the prospect's own words** (see the elicited-vs-asserted distinction above)? This is the single strongest factor.
2. **Roughly where does the conversation sit in a natural decision progression** — has the prospect and salesperson agreed the problem/solution genuinely fits, or is that still unresolved? Has price/investment been discussed at all? Has any risk or hesitation been named and addressed, or does it remain unspoken? Has a concrete next step actually been proposed?
3. **What tier of buying signal appeared**, if any (see above).
4. **Is the quantified value coming from someone with real authority to act on it**, or only from someone who owns the pain but not the budget? A strong, well-quantified Need-Payoff from someone with no economic authority is a weaker probability signal than the same quality of answer from someone who can actually decide.

A meeting can be executed well and still carry a low probability of close (e.g., a large-organization first meeting that correctly secured "who else needs to be involved" as its outcome) — technique quality and probability of close are related but not the same judgment; don't conflate them.

---

## Common Failure Modes — Worth Naming When Present

When assessing a meeting or roleplay, these are the recurring, well-understood ways consultative technique breaks down — worth checking for specifically rather than only judging on what went right:

- The opening (rapport/credibility) was skipped or rushed, and it shows in how guarded the rest of the conversation feels
- Probing questions were asked, but the salesperson didn't genuinely listen to the answers — the conversation reads as a checklist, not a dialogue
- The conversation went off-track into unrelated territory and never found its way back to the actual pain point
- A stall was treated as if it were a specific objection, and argued against directly rather than gently surfaced
- No real Problem or Need-Payoff was ever established, and the salesperson moved to describing the offering anyway
- The salesperson talked substantially more than the prospect during what should have been the probing phase (see phase-aware talk-ratio note above)
- Visible anxiety or a rushed pace that undermined an otherwise sound question sequence

---

## Points to Ponder / Emergent Signal

As with `lmi-context.md`: this space is for genuine ambiguity or a tentative hunch that doesn't fit cleanly elsewhere — never manufacture content to fill it. A short, honest "nothing further stood out" is a valid and often correct answer.
