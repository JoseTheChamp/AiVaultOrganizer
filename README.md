# AI Vault Organizer

Keep your Obsidian vault organized against a written **charter**: AI proposes, you approve, nothing is
ever deleted, and every change can be undone.

> **Status:** early development, not yet released. See [`docs/PLAN.md`](docs/PLAN.md) for the roadmap.

## Why

Vaults drift. Notes pile up in the root, tags fork into variants, folders stop meaning what they used to,
and reorganizing by hand is slow and risky. Existing tools either clean up one note at a time or produce a
report you still have to act on.

AI Vault Organizer treats your vault like infrastructure: the **charter** is the desired state, a **plan**
is the diff, **apply** is a transaction with backup, journal and undo, and **drift** is the distance between
the two.

## How it works

1. **Diagnose** the vault: structure, links, orphans, tag variants, the organization method you already use.
2. **Choose a method** (PARA, Johnny.Decimal, ACE, Zettelkasten, Flat + categories, Topic folders) or codify
   your current structure.
3. **Write the charter**, a note that explains the system to you and holds the rules for the plugin.
4. **Review a plan** of moves, properties, tags and links. Accept or reject every item.
5. **Apply** after an automatic backup; links are verified after every batch; undo is one command.
6. **Check drift** later and re-align only what changed.

## Supported methods

| Method | How notes are organized | Rules out of the box |
|---|---|---|
| **PARA** | `Projects`, `Areas`, `Resources`, `Archive` (+ inbox) | `type: project/area/resource`, `status: done` → archive |
| **ACE** | `Atlas` (maps, notes, sources, people), `Calendar`, `Efforts` (on, ongoing, simmering, sleeping) | `type`, `status`, dated meeting notes |
| **Flat + categories** | Notes in the root, a `categories` property; folders only for references, clippings, daily | notes with a `source` URL → clippings |
| **Johnny.Decimal** | `10-19 Area/11 Category` with IDs like `11.01` | IDs place notes in their category |
| **Zettelkasten** | Fleeting, literature, permanent and hub notes | `type`, timestamp IDs |
| **Topic folders** | One folder per subject | (your folders) |
| **Keep my current structure** | Codifies the folders you already have | (your folders) |

Run **Set up charter** (command palette). The plugin detects what you already use, recommends a method, and
previews what its rules would do before writing anything. The charter becomes a note (`Vault Charter.md`)
that explains your system in plain language (English or Czech) and ends with a ```charter YAML block holding
the rules. Edit either part; the plugin only regenerates the marked sections and never touches your own text.

**Check drift** shows where the vault departs from its charter; **Plan re-alignment** proposes the moves the
rules imply for your review. Placing notes that no rule covers needs the AI tiers (coming next).

## Safety

- **Nothing is ever deleted.** There is no delete operation; "removing" a note means moving it into an archive
  folder you approved. Undo may only trash files the plugin created itself.
- **You review everything.** Changes are proposals until you apply them (`Review pending plan`).
- **A backup comes first.** Every apply starts with a zip of all notes, canvases and bases in
  `.ai-vault-organizer/backups/` (the last 10 are kept; configurable).
- **Links are verified** after every batch: if any existing link would stop resolving, the run stops.
- **Undo is exact.** `Undo last run` restores notes byte for byte. Notes you edited after the run are left as
  they are and listed, never overwritten.

### Restoring a backup by hand

Each backup zip contains `vault/` (your files, with their folder structure) and `manifest.json` (every file's
size and SHA-256). To restore, close Obsidian, extract the zip and copy the contents of `vault/` over your
vault. Guided restore is on the roadmap.

Tips: pause third-party sync (iCloud, Dropbox, OneDrive) while a large plan is applied, and if your vault is a
git repository, commit before applying. Exclude `.ai-vault-organizer/backups/` from sync if you don't want
backups uploaded.

## AI setup

The plugin works without any AI. Optional tiers add local embeddings and a language model you choose
(Ollama locally, or your own API key). _Details coming with milestone 4._

## Privacy and network use

No telemetry, no accounts, no servers. Network requests go only to AI endpoints you configure yourself.
_Full disclosure coming before the first release._

## Evals

_Coming with milestone 6._

## Architecture

Hexagonal: a pure TypeScript core (`src/core`) with Obsidian adapters (`src/obsidian`) and a Node eval CLI
(`eval/`). See [`docs/adr/`](docs/adr/).

## Development

```bash
npm install
npm run dev:vault  # build and copy a fixture vault into dev-vault/ with the plugin enabled
npm run dev        # watch build into dev-vault/.obsidian/plugins/ai-vault-organizer
npm run check      # lint + typecheck + test (required before every commit)
npm run build      # production bundle
npm run analyze -- <vault-folder>   # the "Analyze vault" diagnostics from the command line
```

Open `dev-vault/` in Obsidian ("Open folder as vault") for manual testing. All fixture vaults under
`fixtures/` are synthetic.

The Node CLI and the plugin must see a vault identically. `fixtures/contract/` holds metadata caches recorded
in real Obsidian with `scripts/record-obsidian-cache.js`; the contract test fails when our parser and
Obsidian disagree. Re-record after upgrading Obsidian or adding a fixture.

Commits follow [Conventional Commits](https://www.conventionalcommits.org/); see [`CLAUDE.md`](CLAUDE.md).

## License

[MIT](LICENSE). Developed with AI assistance (Claude Code); every module is reviewed and understood by the
maintainer.
