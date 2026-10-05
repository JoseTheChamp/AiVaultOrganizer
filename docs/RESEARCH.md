# Research: how people organize Obsidian vaults

Snapshot as of October 2026. This document explains *why* AI Vault Organizer is designed the way it is.
Product spec and implementation live in `PLAN.md`.

---

## 1. The building blocks people combine

| Block | What it is | Strengths | Weaknesses |
|---|---|---|---|
| **Folders** | Physical location on disk, one per note | Work outside Obsidian (Finder, git, other apps); zero setup; simple queries ("everything in Tasks/") | A note can live in only one place; forces a decision at capture time; structure goes stale as projects change |
| **Links** | `[[wikilinks]]` between notes, many-to-many | Auto-update on rename; build a graph; context lives in the link | Need discipline; orphans accumulate silently |
| **Tags** | `#tag` or `tags:` property, nestable `#a/b` | Flexible, multi-membership, autocomplete | Don't auto-refactor on rename; case/language variants explode (`#project-management`, `#ProjectManagement`, …) |
| **Properties** | Typed YAML frontmatter (`type`, `status`, `categories`, `created`) | Machine-readable; queryable; reusable across categories | Inconsistent keys/values without a convention |
| **MOCs / index notes** | Notes that curate links to other notes (Maps of Content, structure notes, hubs) | Human-curated overview; can explain *why* notes belong together | Manual upkeep; go stale |
| **Bases** (core plugin) | Database-like views over properties, embeddable in notes (` ```base ` blocks / `.base` files) | Organize *retroactively*: notes get sorted by metadata, not by where they were filed | Requires consistent properties |
| **Daily / periodic notes** | Date-named notes (`YYYY-MM-DD`) | Natural capture inbox; time-based recall | Content buried by date unless linked out |

Community consensus that keeps reappearing in forum threads and blogs:

- **Folders are logistics, links/properties are semantics.** Many experienced users keep folders few and
  coarse and do the real organizing with links, properties and views.
- The trend since Properties (2023) and Bases (2025) is **fewer folders + consistent properties + views**.
- "Structure must be earned": start minimal, add folders only when a real need appears.
- Whatever the system, **consistency beats the choice of system.**

## 2. The organization methods in the wild

### 2.1 PARA (Tiago Forte)

- **Idea:** organize by *actionability*. Projects (goal + end), Areas (ongoing responsibility), Resources
  (topics of interest), Archive (inactive from the other three). Usually plus an Inbox.
- **Typical layout:** `0 Inbox/`, `1 Projects/<project>/`, `2 Areas/<area>/`, `3 Resources/<topic>/`, `4 Archive/`, `Templates/`, `Attachments/`.
- **Failure modes:** the Project vs Area boundary is fuzzy; notes migrate between buckets and break
  queries that hardcode folder paths; "Resources" turns into a junk drawer; knowledge notes get archived
  together with the project they came from.
- **Detection signals:** top-level folder names matching projects/areas/resources/archive (any language,
  optionally numbered).
- **Plugin implications:** needs per-item subfolders (one folder per project/area), a "done → archive"
  rule driven by a `status` property, and a guard against archiving reusable knowledge notes.

### 2.2 Johnny.Decimal

- **Idea:** every item gets a permanent numeric address. Max 10 areas (`10-19 Finance`), each with max 10
  categories (`11 Banking`), each with IDs (`11.01 Statements`). An index is central.
- **Failure modes:** designing areas/categories is hard; scope creep ("my entire life"); renumbering pain.
- **Detection signals:** folders matching `^\d{2}-\d{2}\b`, `^\d{2}\b`; notes or folders matching `^\d{2}\.\d{2}\b`.
- **Plugin implications:** the charter must hold the index (areas → categories); new IDs are allocated
  deterministically (next free number), never by the LLM. The LLM only picks the category.

### 2.3 ACE (Nick Milo, Linking Your Thinking)

- **Idea:** organize by *intention / headspace*. **Atlas** = knowledge (to understand, "space"),
  **Calendar** = time-based notes (to focus/reflect), **Efforts** = projects and actions (to act, "importance").
  Successor of the earlier ACCESS framework.
- **Typical layout:** `Atlas/` (Maps, Notes/Ideas, Sources, People), `Calendar/` (Daily, Logs, Meetings),
  `Efforts/` (optionally split into On / Ongoing / Simmering / Sleeping), plus optional helper folders for
  inbox and extras (templates, attachments).
- **Notable:** Milo now promotes a **"vault map"** — a manual for navigating the vault, kept as a file in it.
  That is essentially what our *charter* is, which validates the core idea.
- **Detection signals:** top-level Atlas / Calendar / Efforts.
- **Plugin implications:** classification is by *note type and intention*, not topic; MOCs ("Maps") are
  first-class; Efforts have a priority sub-state.

### 2.4 Zettelkasten

- **Idea:** atomic notes, each with a unique ID, densely linked; fleeting → literature → permanent notes;
  structure notes / hubs instead of folders.
- **Typical layout:** almost flat; maybe `Fleeting/`, `Literature/`, `Permanent/` (or `Zettel/`), `Sources/`.
- **Failure modes:** link maintenance is the whole system — orphans mean lost knowledge; non-atomic notes.
- **Detection signals:** filenames with timestamp IDs (`^\d{12,14}`), high link density, low folder count.
- **Plugin implications:** the most valuable features here are link suggestions, orphan integration,
  stub/atomicity hints and hub/structure-note proposals — not folder moves.

### 2.5 Flat + categories (Steph Ango / "kepano" style)

- **Idea:** very few folders. Personal notes live in the root; a `categories` property (always a link to a
  category note, e.g. `[[Books]]`) carries the classification; category notes show a Bases view of their members.
- **Typical folders:** References (things outside your world: books, movies, people), Clippings (others'
  writing), Attachments, Daily (`YYYY-MM-DD`), Templates, Categories.
- **Conventions:** pluralize categories and tags, link profusely, `YYYY-MM-DD` dates everywhere, short and
  reusable property names.
- **Detection signals:** high share of notes in root, widespread `categories` property, `.base` files.
- **Plugin implications:** organizing = setting properties and creating category notes with Bases views,
  not moving files. Proves the plugin must support **property-based charters**, not only folder ones.

### 2.6 Topic folders (the default)

- **Idea:** folders by subject (`Programming/`, `Health/`, `Travel/`), often deep and inconsistent.
- **Failure modes:** notes that fit several topics, multiple "Notes" folders, empty pre-created folders,
  root clutter, attachments scattered, inconsistent naming.
- **Plugin implications:** this is where clustering shines — discover the real topics, propose a shallow
  topic tree and MOCs.

### 2.7 Hybrids

Very common: PARA + Zettelkasten (Resources holds the slip-box), ACE with PARA-style efforts, Johnny.Decimal
index notes inside an otherwise linked vault, personal-vs-work splits at the top level. **Conclusion:** presets
are starting points; the charter must be editable and support a "codify my current structure" mode.

## 3. Recurring pain points (evidence from forums and blogs)

1. **Reorganizing over and over** — and reorganizing as procrastination.
2. **Ambiguity** — a note plausibly belongs to several folders, so filing takes willpower and stalls.
3. **Structural rot** — empty pre-created folders, root clutter, multiple "Notes" folders, inconsistent
   naming and casing, attachments in random places.
4. **Moves break queries** — Dataview `FROM "folder"` and Bases folder filters silently break after a restructure.
5. **Tag chaos** — case, separator and language variants of the same tag.
6. **Orphans and forgotten notes** — useful notes nobody links to.
7. **Common manual advice before restructuring:** zip the whole vault, close sync, check broken links
   afterwards. → AI Vault Organizer automates exactly this (backup, verification, undo).

## 4. Existing tools (landscape, October 2026)

The original assumption "nobody does AI cleanup properly" is **not true anymore**. The space is active:

| Tool | What it does | Where it stops |
|---|---|---|
| **Note Companion** (formerly File Organizer 2000) | Watches an inbox folder; AI suggests/applies folder, tags, title, formatting; PARA-oriented; chat; OCR and transcription. Cloud subscription, own keys, or self-host (incl. Ollama). | Inbox-centric; no declarative spec of the whole vault; can apply changes automatically; heavy feature surface. |
| **Vaultend** | Maintenance scan (broken links, orphans, duplicates, empty notes) offline; AI tag and link suggestions per note or per folder with preview; action history with restore; cost display. | No organization *method*; no vault-wide migration plan; no notion of desired state. |
| **Vault Audit AI** | Audit modes incl. map-reduce batch analysis; clusters, orphans, restructuring suggestions as a Markdown dashboard or Canvas; semantic search; batch text transforms; OpenRouter/OpenAI/Groq/Ollama. | Recommendations are a *report*, not an executable, verifiable plan; no drift tracking. |
| **Vault Reorganizer** | Preview and apply bulk cleanup into a fixed small folder layout; uses Obsidian's file manager so links update. | Deliberately no semantics (doesn't infer projects/areas/topics). |
| **Smart Connections / Open Connections** | Local embeddings (Transformers.js, WebGPU/WASM) or API embeddings; related notes; semantic search. | Discovery only; no reorganization. Proves in-plugin local embeddings are viable. |
| **Johnny.Decimal Manager**, **Auto Note Mover**, **Janitor**, **Tag Wrangler** | Method-specific or rule-based helpers (JD addressing, move by tag/title, cleanup, tag rename). | Single-purpose, no AI, no overall model. |
| **Agent-side (Claude Code skills, MCP servers)** | Organize vaults from a terminal agent; some keep an in-vault "folder map" file as the source of truth. | Requires an agent setup; no in-app review UI; no transactional safety or undo inside Obsidian. Validates the "map in the vault" idea. |

### Where the real gap is

Nobody combines all of these:

1. **A declarative, human-readable spec of the whole vault** (the charter) that is both documentation for
   the human and rules for the machine.
2. **Method awareness** — real presets for PARA, Johnny.Decimal, ACE, Zettelkasten, Flat + categories,
   Topic folders, plus "codify my current structure".
3. **Plan → apply as a transaction** — reviewable diff, mandatory backup, journal, undo, link-integrity
   verification, query-breakage warnings.
4. **A drift loop** — later runs compare the vault to the charter and propose re-alignment, instead of
   re-analyzing from scratch.
5. **Measured AI quality** — an eval harness with ground-truth vaults and published numbers per model.
6. **Free and local by default** — useful with zero AI (rules + lexical similarity), better with local
   embeddings, best with a local or BYO LLM. No account, no server.

That combination is the product. Mental model:
**"Terraform for your vault"** — charter = desired state, plan = diff, apply = transactional change,
drift = desired vs. actual.

## 5. Platform facts that shape the design

- **Community directory moved to community.obsidian.md (May 2026).** Submissions go through the directory
  (sign in, link GitHub, add plugin). Review is automated (security/code-quality scanning, compliance
  feedback); listings show a scorecard; some plugins carry a "not manually reviewed by staff" label.
- **Release mechanics:** GitHub release whose tag equals `manifest.json` `version` (`x.y.z`), with
  `main.js`, `manifest.json`, optional `styles.css` attached. The directory reads `manifest.json` from the
  default branch HEAD. Plugin id must be unique and must not contain `obsidian`.
- **Developer policies:** no obfuscation, no client-side telemetry, no self-installing/updating code or
  dependencies. README must disclose network use (which services, why), file access outside the vault,
  accounts, payments. LICENSE required.
- **Submission requirements:** `isDesktopOnly: true` when using Node/Electron APIs; description ≤ 250 chars,
  ends with a period, no emoji; sensible `minAppVersion`; no plugin id inside command ids; remove sample code.
- **`eslint-plugin-obsidianmd`** encodes many review rules — run it in CI from day one.
- **SecretStorage** (API since Obsidian 1.11.4, Jan 2026): shared, device-local keychain for API keys,
  with a `SecretComponent` for settings UI. Not synced between devices. → use it, require `minAppVersion` ≥ 1.11.4.
- **Bases** is a core plugin; category notes can embed base views — relevant for the Flat preset.
- **Forum culture:** plugin announcements now commonly answer "Is it open source? Free? Vibe-coded beyond
  the author's comprehension?" Some listings state "developed with AI assistance, all code manually reviewed".
  → every module must be understood by its maintainer; PRs carry design notes, and the README states
    AI assistance honestly.
- **Free LLM tiers are unstable.** Gemini's free tier was cut back in 2026 (Pro models removed, lower limits;
  free-tier data may be used by the provider). → Local (Ollama) is the robust free default; cloud free tiers
  are fine for synthetic evals, not for private notes.

## 6. Design decisions derived from this research

1. Charter = one Markdown note with a human section and a machine-readable ` ```charter ` YAML block.
2. Support **folder-based and property-based** charters (PARA/JD/ACE vs. Flat + categories / Zettelkasten).
3. **Never auto-apply.** Everything is a plan for review; high-confidence bulk accept is a user action.
4. Backups and verification are built in, not advice in the README.
5. Detect and warn about Dataview/Bases queries that reference folders being moved.
6. Three capability tiers: **Tier 0** (no AI: rules, graph, TF-IDF), **Tier 1** (+ embeddings),
   **Tier 2** (+ LLM). Each tier is useful on its own and measured by evals.
7. Multilingual from the start (Czech + English fixtures): folder names, labels and prose in the vault's language.
8. Desktop-only v1; mobile later.

## Sources

- Obsidian docs — Submit your plugin: https://docs.obsidian.md/Plugins/Releasing/Submit+your+plugin
- Obsidian docs — Developer policies: https://docs.obsidian.md/Community+directory/Developer+policies
- Obsidian docs — Submission requirements: https://docs.obsidian.md/community-directory/submission-requirements-for-plugins
- Obsidian Community announcement summary (S. Dubois): https://www.dsebastien.net/obsidian-community/
- Obsidian changelog 1.11.4 (SecretStorage API): https://obsidian.md/changelog/2026-01-12-desktop-v1.11.4/
- Steph Ango — vault template and rules: https://stephango.com/vault
- Linking Your Thinking — ACE folder framework: https://blog.linkingyourthinking.com/notes/ace-folder-framework
- LYT — ACE flexes for you: https://blog.linkingyourthinking.com/notes/the-ace-folder-framework-flexes-for-you
- Obsidian forum — "The Ultimate Folder System: A quixotic journey to ACE": https://forum.obsidian.md/t/the-ultimate-folder-system-a-quixotic-journey-to-ace/63483
- Obsidian forum — Johnny.Decimal in Obsidian: https://forum.obsidian.md/t/q-for-those-using-johnny-decimal-system/87070
- Obsidian forum — How to structure notes (categories, tags, folders): https://forum.obsidian.md/t/how-to-structure-notes-categories-tags-and-folders/103125
- Obsidian forum — How do you group related notes together?: https://forum.obsidian.md/t/how-do-you-group-related-notes-together/60911
- obsidian.rocks — How I use folders: https://obsidian.rocks/how-i-use-folders-in-obsidian/
- "Organizing an Obsidian vault — lessons from doing it wrong": https://ibrah5em.duckdns.org/notes/deep-dives/organizing-obsidian-vault
- Note Companion listing: https://community.obsidian.md/plugins/fileorganizer2000
- Vaultend listing: https://community.obsidian.md/plugins/vaultend and forum post https://forum.obsidian.md/t/vaultend-scan-organize-and-maintain-your-vault-with-full-undo/116425
- Vault Audit AI forum post: https://forum.obsidian.md/t/vault-audit-ai-audit-and-organize-your-obsidian-vault-with-ai/117080
- Vault Reorganizer listing: https://community.obsidian.md/plugins/vault-reorganizer
- Open Connections listing: https://community.obsidian.md/plugins/open-connections
- Gemini API free-tier changes 2026: https://agentdeals.dev/gemini-api-pricing-changes
