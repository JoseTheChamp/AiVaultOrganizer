# 0002. No-delete invariant and the plan/apply transaction

- Status: Accepted, amended by [0009](0009-remove-emptied-folders.md) (folders a plan leaves empty)
- Date: 2026-10-05

## Context

The plugin reorganizes people's notes, often hundreds at once, partly on the advice of a language model.
The worst outcome is lost or silently corrupted notes; the second worst is a reorganization the user cannot
take back. Manual advice from the community before restructuring is always the same: zip the vault, pause
sync, check links afterwards. The safety layer has to make that advice automatic and provable.

## Decision

**1. There is no delete.** The operation model has no delete kind, and the `VaultWriter` port has no delete
method. "Removing" a note means moving it into an archive destination, proposed and reviewed like any other
change. The only removals the plugin can perform are trashing files it created itself (generated notes) and
removing empty folders it created, both only while undoing a run, and both through `fileManager.trashFile`,
which respects the user's trash setting.

**2. Every change is a transaction:** plan → validate → backup → apply → journal → verify, implemented once
in `src/core/apply` (`ApplyRunService`) and nowhere else.

- *Plan:* operations are plain data with deterministic ids, a rationale, a confidence and a review status.
  Only `accepted` operations execute.
- *Validate:* before review and again right before apply, the plan is simulated over a virtual copy of the
  vault's paths in execution order (collisions between operations, case-insensitive targets, protected and
  ignored paths, charter destinations, dependencies, stale preconditions).
- *Backup:* mandatory zip of all notes, canvases and bases with a SHA-256 manifest. No backup, no apply.
- *Apply:* phases (folders → moves → frontmatter → links → generated notes) in batches; preconditions are
  checked before anything is written.
- *Journal:* each applied operation is appended to a JSONL journal together with its inverse before the next
  operation starts, so any interruption leaves an undoable state.
- *Verify:* after each batch, every pre-existing link must still resolve to the same file (mapped through the
  run's moves) and the number of unresolved links must not grow. Violations stop the run.

**3. Inverses are concrete, and undo is hash-guarded.** Instead of semantic inverses ("remove exactly these
tags"), content edits journal the previous content plus the hash of what the plugin wrote. Moves journal the
previous content of every note whose links Obsidian rewrote, and the notes whose unchanged link text started
resolving to the moved note (redirects). Undo restores a file only if it still has exactly the hash the run
left behind; otherwise that step is skipped and reported. This makes undo byte-exact when nothing changed
and conservative when something did.

**4. Obsidian's configuration folder is not backed up.** PLAN §5.4 lists `.obsidian/*.json`; we deviate: the
plugin never writes there, and reading it would need `vault.adapter` outside the plugin's own folder, which
CLAUDE.md restricts. Revisit if a future operation ever touches configuration.

## Consequences

- Undo of a run that nobody touched afterwards is byte-identical. This is proven by a property-based test
  (`round-trip.property.test.ts`) over random vaults and random plans, which already found one real bug: link
  redirects caused by a move. A second property covers runs stopped by verification.
- Journals can be large (full previous content of edited notes). Acceptable: they are local, text, and much
  smaller than the zip backups; pruning journals is a later concern.
- `waitForIndex` in the Obsidian adapter waits for the metadata cache's `resolved` event or a short quiet
  period, per move. Large migrations pay ~150 ms per move; to be optimized in the performance milestone.
- Verification can stop a run for reasons outside the plugin's control (sync conflicts, link auto-update off).
  That is intended: stopping and offering undo is always better than continuing.
- A tag or link edit inside a note the user changes between planning and applying is skipped, not merged.

## Alternatives considered

- **Semantic inverses** (as first sketched in PLAN §5.6): smaller journals and possible undo after unrelated
  user edits, but frontmatter re-serialization and Obsidian's link rewriting make exact restoration
  impossible to guarantee. Rejected in favor of provable identity.
- **Git as the transaction log:** precise and familiar, but most vaults are not repositories, and the plugin
  must not require one. The README still recommends committing before apply for git users.
- **A delete operation with confirmation:** simpler cleanups, but one bug or one bad model suggestion away
  from data loss. Archiving costs nothing and is reversible.
