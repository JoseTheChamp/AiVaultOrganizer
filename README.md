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

_Coming with milestone 3._

## Safety

- No delete operation exists; "removing" means moving into an archive folder you approved.
- A zip backup is created before every apply.
- Every change is journaled with its inverse; `Undo last run` reverts it.
- Link integrity is verified after every batch.

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
