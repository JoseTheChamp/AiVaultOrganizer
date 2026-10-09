# AI Vault Organizer

Keep your Obsidian vault organized against a written **charter**: AI proposes, you approve, no note is
ever deleted, and every change can be undone.

> **Status:** early development, not yet released. See [`docs/PLAN.md`](docs/PLAN.md) for the roadmap.

**New here?** Read the [user guide](docs/USER_GUIDE.md). How it works inside, the AI included: [how it works](docs/HOW_IT_WORKS.md).

## Why

Vaults drift. Notes pile up in the root, tags fork into variants, folders stop meaning what they used to,
and reorganizing by hand is slow and risky. Existing tools either clean up one note at a time or produce a
report you still have to act on.

AI Vault Organizer treats your vault like infrastructure: the **charter** is the desired state, a **plan**
is the diff, **apply** is a transaction with backup, journal and undo, and **drift** is the distance between
the two.

## How it works

1. **Diagnose** the vault: structure, links, orphans, tag variants, the organization method you already use.
2. **Choose a method** (PARA, Johnny.Decimal, ACE, Zettelkasten, Flat + categories, Topic folders), codify
   your current structure, or let a language model draft a charter from samples of your notes.
3. **Write the charter**, a note that explains the system to you and holds the rules for the plugin.
4. **Plan**: rules place what they can, notes like the ones already placed follow them, and a language
   model (if you set one up and agree) proposes places for the rest.
5. **Review the plan** of moves, properties, tags and links. Accept or reject every item, or everything
   above a confidence you choose; your decisions teach the plugin where similar notes belong.
6. **Apply** after an automatic backup; links are verified after every batch; undo is one command.
7. **Check drift** later and re-align only what changed.

The **dashboard** (ribbon icon, or **Open dashboard**) shows the vault's health, the charter and how many
notes are off it, a plan waiting for review, the last run and your AI setup.

**Find similar notes** shows the notes closest to the one you are reading. Without any AI it compares
the words notes share. With **Better similarity** on, it compares meaning, which also finds related
notes written in another language. The first search indexes the vault; later searches only index notes
that changed. Click the progress notice to stop indexing at any time.

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

Run **Set up charter** (command palette or dashboard). A three-step wizard shows each method as the folder
tree it would give your vault, with how many of your notes already fit each folder and what the method is
good and not so good for. It recommends the method your vault is closest to (AI can also suggest one from
your notes), lets you rename folders, and shows the charter note before anything is written. The charter becomes a note (`Vault Charter.md`) that
explains your system in plain language (English or Czech) and ends with a ```charter YAML block holding
the rules. Edit either part; the plugin only regenerates the marked sections and never touches your own text.

**Check drift** shows where the vault departs from its charter. **Organize vault** builds a plan for the
whole vault:

- rules decide first, and are never wrong;
- notes no rule covers follow the placed notes they most resemble, by shared words, or by meaning with
  **Better similarity**;
- what is still open goes to the language model, after a dialog shows what would be sent where, how many
  requests and tokens it takes, and what it would cost at your prices; or plan without it, and those notes
  are flagged for you;
- properties and tags are normalized, maps of content updated, and queries the moves would change are
  flagged.

The **review** opens in its own tab:

- changes are grouped by what they do and where notes go, with filters by who decided (rules, similar
  notes, the model), confidence, destination and status;
- each row shows the reason, a calibrated confidence and, on demand, exactly what changes (paths,
  frontmatter lines, inserted links);
- the keyboard works throughout: <kbd>j</kbd>/<kbd>k</kbd> move, <kbd>a</kbd> accepts, <kbd>r</kbd>
  rejects, <kbd>u</kbd> undecides, <kbd>Enter</kbd> previews;
- **Learn from my decisions** re-scores the undecided rows from what you accepted and rejected, without
  asking any model.

Applying shows progress you can cancel, then a report with the health score before and after and a button
to undo the run.

## Safety

- **No note is ever deleted.** There is no delete operation for notes or files; "removing" a note means moving it
  into an archive folder you approved. Folders a plan leaves empty go to the trash only if you approve and they
  are still empty when it runs, and undo brings them back. Undo may only trash files the plugin created itself.
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

The plugin works without any AI. Rules, drift checks, analysis and undo never call a model. AI sorts the
notes your charter's rules cannot place, which in a messy vault is most of them, and can suggest a system.

The quickest way is **Set up AI** (command palette, the dashboard, or the button at the top of the AI
settings): pick *on this computer*, *with my API key* or *no AI*, paste a key if you need one, and
**Save and test**. Keys go into Obsidian's keychain; the plugin settings only keep their name. The rest of
this section describes the same choices in the settings tab.

- **Use a language model** is the main setting. The model decides where a note belongs when no rule
  does, and later helps draft your charter.
- **Better similarity** is an optional upgrade. An embedding model finds related notes by meaning
  rather than shared words, even across languages. Without it, the plugin compares words, which needs
  no setup. It uses the language model's provider and key when that provider has embeddings; Claude
  has none, so a local Ollama model is suggested instead.

**Local, free (recommended).** Install [Ollama](https://ollama.com) and pull a model, for example
`ollama pull qwen3:8b` for the language model and `ollama pull bge-m3` for better similarity. bge-m3 is
multilingual, which matters for vaults that aren't English-only. Then:

1. Turn on **Use a language model**.
2. Keep the provider **Ollama (local)**.
3. Enter the model name and click **Test connection**.

LM Studio works the same way. For models that reason before answering, such as Qwen 3, the **Thinking**
setting is off by default with Ollama. Sorting notes doesn't need long deliberation, and answers come
many times faster.

**Your own API key.**

1. Pick OpenAI, Anthropic, OpenRouter, Google Gemini, Mistral, Groq or a custom OpenAI-compatible
   endpoint.
2. Choose or add the key in Obsidian's keychain (the **API key** row).
3. Turn off **Local-only mode**.

Only the key's name is saved in the plugin settings. The key itself stays in Obsidian's keychain on this
device.

**Limits.** Set the number of parallel requests, requests per minute and a token budget per run. You can
also enter prices per million tokens to see cost estimates; no prices are built in.

## Privacy and network use

- **No servers.** No telemetry, no accounts, no update checks, no servers of our own.
- **Only your endpoints.** Network requests go only to the endpoints you configure, through Obsidian's
  `requestUrl`.
- **Local-only by default.** Local-only mode is on by default and blocks any request to a host other than
  this computer (`localhost`, `127.x.x.x`, `::1`). This is enforced in one place for every provider.
- **What is sent.**
  - **Test connection** lists the models and sends a one-word prompt, or embeds the words "connection
    test".
  - **Better similarity** (similar notes, planning, learning from decisions) sends the text of your notes
    (without frontmatter or code) to the embedding endpoint, once per note and again only after a note
    changes. For a provider that is not on this computer, it first asks, showing how many notes would go
    to which host.
  - **Organize vault with a language model** sends a *note card* for each note that rules and similar
    notes could not place: title, folder, tags, a few properties (such as type and status), headings,
    outgoing links, how recently it changed and the first few hundred characters of text. It also sends
    the plan's counts and a few one-line descriptions of changes for the summary. A dialog shows this,
    the host and the estimated cost first, every time.
  - **Ask for a draft** in the setup wizard sends the vault's statistics, keywords of its largest groups of
    similar notes and up to five note cards per group, after the same dialog.
  - Nothing else is sent.
- **Private notes.** Add `ai-vault-organizer: private` to a note's properties to keep it away from every
  AI feature. Notes your charter ignores are never sent either.
- **Where data is stored.** All of it stays inside your vault, under `.ai-vault-organizer/cache/`.
  Exclude that folder from sync if you prefer.
  - **Model responses** (`cache/llm/`), so repeated runs are free. They may quote your notes. Clear
    them with **Clear cache** in settings.
  - **The similarity index** (`cache/index/`): word counts and embedding vectors, about 4 KB per note
    for a typical model. Reset it in settings.
- **Free tiers.** Cloud providers' free tiers may train on what you send. Use a local model or a paid key
  for private notes.

## Evals

AI features are measured before they ship. `npm run eval` runs every task over synthetic English and
Czech fixture vaults with known answers: placement by each method, link suggestions, similarity,
duplicates and safety (apply and undo). CI fails on regressions. Methodology, the latest numbers and
what they mean are in [`docs/EVALS.md`](docs/EVALS.md).

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
