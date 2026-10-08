# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Release tags are bare versions (`1.0.0`).

## [Unreleased]

### Added

- Plugin scaffold: build, lint, test and release tooling.
- `Analyze vault` command: health score, detected organization method with evidence, link graph,
  tag variants, empty folders, stubs and isolated notes, with a copyable Markdown report.
- Safety layer: every change goes through a validated plan, a mandatory zip backup, batched apply with
  link verification after each batch, and an append-only journal.
- Plan review in its own tab (`Review pending plan`): changes grouped by kind and destination, filters by
  who decided, confidence, destination and status, a preview of exactly what each change does, accept or
  reject per row or everything above a confidence, and keyboard review (j, k, a, r, u, Enter). Decisions
  are saved as you make them.
- Applying shows its progress and can be cancelled; the run report lists what was skipped or failed and
  why, the health score before and after, and offers to undo the run.
- `Learn from my decisions` in the review: places you accepted or rejected re-score the undecided changes
  and can propose a place for flagged notes, without asking any model.
- `Undo last run` command: restores notes byte for byte; notes edited after the run are left alone and listed.
- `Create backup` command and backup settings (retention, attachments).
- Vault charter: a note that explains your system and holds its rules, with presets for PARA, ACE,
  Flat + categories, Johnny.Decimal, Zettelkasten and Topic folders (English and Czech), or a charter that
  codifies your current folders.
- Setup wizard (`Set up charter`): every method shown as the folder tree it would give your vault, with
  how many notes fit each folder and what the method is good and not so good for; folder names you can
  change with a live preview; and the charter note before anything is written. AI can suggest a system
  from samples of your notes.
- `Set up AI`: one dialog to run AI on this computer or with your API key (stored in Obsidian's keychain),
  with a connection test that names a missing local model.
- Charter rules render as a summary card in reading view, or as a list of problems with line numbers.
- `Check drift` and `Organize vault`: see where the vault departs from its charter, and get a plan for
  the whole vault. Rules decide first; notes no rule covers follow the placed notes they resemble; a
  language model proposes places for the rest. Properties and tags are normalized, maps of content and
  category notes updated, and queries the moves would change are flagged.
- Before any note goes to a language model, a dialog shows which model and host, exactly what is sent,
  how many requests and tokens it takes, how long it may take at the pace of the last run and, with
  prices set, what it costs.
- Dashboard in the sidebar (ribbon icon or `Open dashboard`): the vault's health, the one next step
  (choose a system, review, organize), and the system, AI and last change at a glance.
- Long tasks (organizing, indexing, a suggested system) show in a notice and on the dashboard what they
  are doing, how many notes are done, how long they have run and, once the pace is known, how long is
  left. They can be stopped from either place.
- AI settings: choose a language model from Ollama, LM Studio, OpenAI, Anthropic, OpenRouter, Google
  Gemini, Mistral, Groq or any OpenAI-compatible endpoint, and test the connection. An optional
  "Better similarity" setting adds an embedding model; it uses the language model's provider and key
  when that provider has one, and a local Ollama model otherwise. API keys are kept in Obsidian's
  keychain, never in the plugin settings.
- Local-only mode, on by default: requests to anything other than this computer are blocked.
- A "Thinking" setting for models that reason before answering (Qwen 3, DeepSeek R1, OpenAI o-series).
  It is off by default for Ollama, so local thinking models answer quickly instead of running out of
  tokens mid-thought.
- Limits for model use: parallel requests, requests per minute, a token budget per run and optional
  prices for cost estimates. Responses are cached so repeated runs are free; the cache can be cleared
  in settings.
- `Find similar notes` command: the closest notes to the active one, by shared words (no AI needed) or
  by meaning with an embedding model. Indexing is incremental and can be stopped from its progress
  notice. Notes are sent to a cloud embedding provider only after you agree, and notes marked
  `ai-vault-organizer: private` are never sent.
