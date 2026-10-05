# 0003. Charter format

- Status: Accepted
- Date: 2026-10-05

## Context

The charter is the product's center: the desired state the planner works toward and drift is measured against.
It has two audiences. People (the owner, future-them, collaborators) need prose that explains the system.
The plugin (and other agents) need precise, machine-checkable rules. If these live apart, they drift apart;
if the plugin rewrites the note, it must never destroy what the user wrote. The format is a long-lived
contract with users' vaults, so changes to it are expensive.

## Decision

**One Markdown note** in the vault, `Vault Charter.md` by default (configurable), as specified in PLAN §3:

- Frontmatter `charter: true` and `charter-version: <revision>`, so Bases and Dataview can find it.
- **Generated sections** between `<!-- charter:generated:start id="…" -->` and `<!-- charter:generated:end -->`:
  `overview`, `where-does-it-go`, `conventions`. They are rendered deterministically from the rules, in English
  or Czech, so the charter works without any AI (a language model may write richer prose later).
- **Everything outside the markers belongs to the user** and is preserved byte for byte.
- A fenced ` ```charter ` **YAML block is authoritative**. Reading view renders it as a summary card, or as a
  list of problems with line numbers when invalid; while invalid, nothing is planned against it.

**Schema** (`src/core/charter/schema.ts`, zod, `version: 1`), strict so typos surface as errors:
destinations (id, folder path and/or category, description, layout, rules, examples), inbox, system folders,
ignore globs, conventions, MOC and drift settings, Johnny.Decimal index.

**Rule semantics.** A destination matches when *any* of its rules matches: `property` equals (case-insensitive,
any element of a list), `property` exists, `tag` (including nested children), `filename` regex, `pathGlob`.
When several destinations match, the highest `priority` wins, then charter order. In properties mode the vault
root is a valid home for notes. Daily notes are recognized by the charter's moment-style date format.

**Revisions.** `revision` changes only when the plugin writes a charter whose *meaning* changed, identified by a
fingerprint (hash of the charter without its revision). Drift and run state compare fingerprints, so a user's
hand edit is noticed immediately, and the revision catches up on the plugin's next write. When only the
revision needs updating, the user's YAML is kept with its comments (yaml Document API).

**Writes go through plans** like every other change: `createNote` for a new charter; otherwise only what
changed: `updateGeneratedSection` per section, `updateCharterRules` (replaces only the YAML inside the block),
`setProperty charter-version`, all with a content-hash precondition.

### Additions to PLAN §3.2

- `{ property, exists }` rule, for example web clippings that have a `source` URL.
- Destination `priority`, so "status: done → Archive" can override "type: project → Projects".
- `updateCharterRules` operation kind, to update the block without wrapping it in generated markers, which keeps
  the note layout exactly as specified in §3.3.
- Revision bumps happen on the plugin's next write rather than on every user save (the plugin does not watch the
  charter note); the fingerprint gives drift detection the same effect immediately.

## Consequences

- A vault's organization is documented where users look, readable without the plugin, and usable by other
  tools and agents.
- The strict schema means a newer plugin's charter may not load in an older plugin; `version` exists to manage
  that, and migrations will be explicit.
- Localized prose and folder names exist for English and Czech; other languages fall back to English until
  translations are added.

## Alternatives considered

- **Rules in frontmatter or a JSON settings file:** invisible or unreadable to humans, and the rules would
  separate from the explanation.
- **Wrapping the YAML block in generated markers:** simpler updates, but users would see their editable rules
  inside a "generated" region and the layout would differ from the plan; a dedicated operation is cleaner.
- **LLM-only prose:** pleasant text, but the charter must work at tier 0, and deterministic text makes updates
  diffable.
