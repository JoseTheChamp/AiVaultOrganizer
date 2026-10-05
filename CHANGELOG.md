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
