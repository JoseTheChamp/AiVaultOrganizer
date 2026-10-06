# 0007. Planner: classification cascade, normalization and the drafting agent

- Status: Accepted
- Date: 2026-10-06

## Context

M8 turns a charter into a full re-organization plan (PLAN §2, §7.6–7.8). The plan must:

- move notes into the charter's destinations and subfolders;
- normalize properties and tags;
- add accepted related links, and maps of content or category notes;
- warn about queries that the moves would break.

All of it has to work at Tier 0 and get better with embeddings and a language model. The confidence
on every decision must mean what it says, because the review offers "accept everything above X". And
a plan must be safe to apply as a whole: invariants 2 and 3 apply to everything the model touches.

Live probes on the fixtures showed where the naive versions fail:

- Raw model confidences averaged 0.88–0.94 while half of the answers were wrong (ACE).
- Raw model subfolder names matched the expected ones 0 times out of 29.
- Daily notes, and notes filed by their kind, dominated the kNN vote.
- Ollama's default 4,096-token window silently cut an oversized batch, instructions first.
- The first eval run found more: an optional field is never written under schema-constrained
  decoding, and terse destination descriptions ("Recurring efforts that never really end") sent
  most ACE project notes to Atlas.

## Decision

**Note cards** are the only form in which note content reaches a model:

- title, folder, tags, whitelisted properties, headings, outgoing links, cluster label, age bucket,
  and a word-bounded excerpt of 600 characters;
- private notes get no card, so they cannot be sent;
- the prompts of M7 render cards unchanged, and only `classify-notes` shows the extended fields.

**The cascade** (PLAN §7.6) decides each note at the cheapest stage that can:

1. *Rules.* Charter rules, daily-note patterns, and notes already where the charter puts them.
   Confidence 1.
2. *kNN.* The decided notes are anchors. A note's 7 nearest neighbours vote, and kNN decides only
   when the leader holds at least 75 % of the vote from at least 3 anchors, above a similarity
   floor (0.5 for embeddings, 0.15 for word statistics). Daily notes and *kind destinations* do not
   vote. A kind destination is one that rules fill by note type or filename date, such as ACE
   "Calendar". Similar content says nothing about the kind of a note, and these anchors had pulled
   every vote.
3. *Language model.* The `classify-notes` prompt (v2) gets batches of up to 10 cards. Its schema
   accepts only the batch's note ids and the charter's destination ids plus `abstain`, each note
   exactly once, so the model cannot invent a destination.
   - Every field is required, and the rationale comes before the decision, so a constrained decoder
     writes the reason first.
   - Each destination lists its subfolders in use: existing folders, those of notes already placed,
     and names proposed by earlier batches.
   - Kind destinations say which notes they take, from their rules.
   - Batches are sized against 90 % of the provider's context window.
   - When the model names a subfolder that is in use under exactly one other subfolder-per-item
     destination, the note goes there: a project or an area has one folder, and the model
     recognizes what a note belongs to better than how the method sorts it.
4. *Abstain.* Everything else becomes `flag: ambiguous` for the user. A failed batch abstains; it is
   never guessed.

**A second sample.** Answers with a self-reported confidence between 0.4 and 0.95 are asked again
in reverse order, so they land in different batches. The range is wide because self-reports barely
vary: qwen3:8b said 0.9 for right and wrong answers alike. Agreement does separate them. On
en-small, confirmed answers were right 92 % of the time and contradicted ones 34 %. This roughly
doubles the model calls of classification.

**Calibration** maps every signal to one confidence:

- Rules give 1.
- kNN gives its vote share × (0.85 + 0.03 × supporters, at most 5).
- The model's self-report is shrunk towards 0.5 by a trust factor of 0.6. It then gains or loses
  with kNN agreement (±0.1 or 0.2, scaled by the vote share) and with the second sample (+0.15 or
  −0.35). A 0.9 answer ends at 0.89 when confirmed and 0.39 when contradicted.
- Everything is capped at 0.95, so only rules are certain.

The weights were set from live probes, and the evals check them with ECE (`docs/EVALS.md`).

**Subfolders.** Proposed names are reconciled before any model names them:

- A name matches an existing subfolder when their keys are equal. The key ignores case, diacritics,
  punctuation and a plural "s". It also matches when the restricted edit distance is at most one per
  8 characters.
- Prefixes never merge: "Web" is not "Web app".
- Similar proposals are merged with each other. Only new names go to the `subfolder-naming` prompt,
  and a failed call keeps them.

**A new operation, `renameProperty`,** joins the domain model.

- Normalization renames case variants and synonyms: `Type` becomes `type`, `kind` becomes `type`,
  `tag` becomes `tags`.
- Renaming keeps the property's position and value. It refuses to run when the target key exists,
  and it is undone exactly like any content edit.
- A remove-and-set pair would lose key order, and it would put a destructive-looking step into the
  plan.

**Tags and values.** Tag variant groups map to one canonical form in the charter's style. Enum values
are fixed to the charter's spelling, after any rename of their key. A required `created` property is
filled from the file's creation time.

**Maps of content and category notes.**

- Each destination gets a MOC listing its notes by subfolder. In properties mode, each category gets
  a note with a Bases view of its members.
- The plan writes only inside the plugin's generated section, through `updateGeneratedSection`.
  Anything the user wrote around that section stays untouched.

**Query breakage.**

- Dataview `FROM "folder"`, `dv.pages("folder")` and Bases `file.inFolder(...)`, `file.folder ==`
  and `file.path.startsWith(...)` filters are found by pattern.
- When a move changes what such a query shows, the plan carries a `flag: query-breakage` with the
  line and an example note. Queries are not rewritten in v1.

**One plan, in order.** `buildPlan` assembles every step. An edit planned for a note that also moves
is retargeted to the new path and depends on the move. Its precondition keeps the original path,
because preconditions are checked before anything moves. If the move fails, its edits are skipped.

**The charter drafting agent** (PLAN §7.7):

- It works in a bounded loop: at most 8 steps and a 40,000-token budget.
- It has six read-only tools over the in-memory analysis, plus `propose_charter`. That tool takes
  charter YAML and validates it with the same parser as the charter note, and against the vault.
  Errors go back to the model to correct.
- The result is a draft for the wizard. It is never written without the user.

**The plan summary.**

- `plan-summary` sees counts, destinations and up to 8 operation descriptions, never note content.
- Without a model, or when the model fails, a summary is composed from the same numbers.

### Deviations from PLAN §7.6–7.8

- **No `tag-normalize` prompt.** Variant groups and the charter's tag style decide the canonical form
  deterministically. The groups on the fixtures needed no judgement, and a model would only add
  cost. The prompt can come later if real vaults need it.
- **Batch size 10**, at the low end of PLAN's 8–15, and it shrinks further to fit small context
  windows. Larger batches cut a 4,096-token window.
- **An extra commit.** `buildPlan`, which assembles all the steps, was its own commit before the
  eval commit. The plan's commit list had no place for it.
- **Preset fixes found by the evals.** The Czech Flat + categories charter recognizes `[[Knihy]]`,
  `[[Lidé]]` and the other Czech names, as well as the English ones. Johnny.Decimal gained a
  daily-notes folder (`00-09 System/02 Daily`). Destination descriptions of ACE, Johnny.Decimal and
  Flat + categories now say concretely what they hold, because the classifier knows a destination
  by nothing else.
- **A second sample for most answers**, not only borderline ones (see above).

## Consequences

- Every planner step works without a model. A language model only decides what rules and kNN could
  not, and names new subfolders.
- Confidence is comparable across stages, so a single "accept above X" threshold is meaningful. ECE
  is pinned in CI for every preset.
- The domain model has 11 operation kinds. The executor, validator, journal and review labels all
  handle `renameProperty`.
- Eval cassettes must be re-recorded when cards, batching, the second sample or a prompt change,
  because requests are content-keyed. Evals build cards without ages for this reason.
- Human-in-the-loop re-ranking (PLAN §7.6) is not built yet. It needs the review UI (M9), and the
  anchors it would feed already exist.

## Alternatives considered

- **Trusting the model's confidence as reported.** It was above 0.85 for wrong and right answers
  alike.
- **Logprob-based confidence.** Not every provider returns log probabilities, and the cascade must
  behave the same with all of them.
- **A second sample only for borderline answers** (0.4–0.85), as first built. With self-reports at
  0.9 for nearly everything, it almost never ran.
- **Three or more samples with a majority vote.** More calls again, while two samples already
  separate right from wrong answers well.
- **Letting the model choose existing subfolders by name.** The schema would need every subfolder as
  an enum, which does not fit small context windows. The model also invented near-duplicates anyway.
- **Rewriting broken queries.** Dataview and Bases queries can be arbitrarily complex. A wrong rewrite
  is worse than a flag the user can act on.
- **A free-form agent that edits the charter note.** Rejected by invariant 3. The agent returns a
  validated draft, and only the wizard writes it, through the plan.
