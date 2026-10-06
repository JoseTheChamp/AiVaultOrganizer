# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Release tags are bare versions (`1.0.0`).

## [Unreleased]

### Added

- Plugin scaffold: build, lint, test and release tooling.
- `Analyze vault` command: health score, detected organization method with evidence, link graph,
  tag variants and empty folders, with a copyable Markdown report.
- Safety layer: every change goes through a validated plan, a mandatory zip backup, batched apply with
  link verification after each batch, and an append-only journal.
- `Review pending plan` command: accept or reject each proposed change, then apply.
- `Undo last run` command: restores notes byte for byte; notes edited after the run are left alone and listed.
- `Create backup` command and backup settings (retention, attachments).
- Vault charter: a note that explains your system and holds its rules, with presets for PARA, ACE,
  Flat + categories, Johnny.Decimal, Zettelkasten and Topic folders (English and Czech), or a charter that
  codifies your current folders. `Set up charter` previews what the rules would do before anything is written.
- Charter rules render as a summary card in reading view, or as a list of problems with line numbers.
- `Check drift` and `Plan re-alignment`: see where the vault departs from its charter and review the moves
  its rules imply.
- AI settings: choose a language model from Ollama, LM Studio, OpenAI, Anthropic, OpenRouter, Google
  Gemini, Mistral, Groq or any OpenAI-compatible endpoint, and test the connection. An optional
  "Better similarity" setting adds an embedding model; it uses the language model's provider and key
  when that provider has one, and a local Ollama model otherwise. API keys are kept in Obsidian's
  keychain, never in the plugin settings.
- Local-only mode, on by default: requests to anything other than this computer are blocked.
- Limits for model use: parallel requests, requests per minute, a token budget per run and optional
  prices for cost estimates. Responses are cached so repeated runs are free; the cache can be cleared
  in settings.
- `Find similar notes` command: the closest notes to the active one, by shared words (no AI needed) or
  by meaning with an embedding model. Indexing is incremental and can be stopped from its progress
  notice. Notes are sent to a cloud embedding provider only after you agree, and notes marked
  `ai-vault-organizer: private` are never sent.
