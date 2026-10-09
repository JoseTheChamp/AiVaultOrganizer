# 0009. Remove the folders a plan leaves empty

- Status: Accepted, amended 2026-10-09 (empty folders outside the charter)
- Date: 2026-10-08

## Context

ADR 0002 rules out deletion: the plugin moves notes but never removes anything except, while undoing
a run, files and empty folders it created itself. A reorganization therefore leaves the old structure
behind as empty folders. On the synthetic vault, one Zettelkasten run left 17 of 22 top-level folders
empty, and the user's verdict was that the result "still looked mighty messy". An organizer that
leaves the file explorer fuller than it found it fails at its main job.

The no-delete rule exists to protect content: notes, attachments, anything a person made. An empty
folder holds none.

## Decision

**A plan may propose removing a folder that its own moves leave empty**, as an operation reviewed
like any other: `removeEmptyFolder { path }`.

- *Which folders:* those whose subtree held at least one file before the plan and holds none after its
  moves (notes and other files, including notes the plan creates), together with the empty folders
  inside them. Also, since the amendment below, folders that hold nothing and lie outside the
  charter's folders. Empty folders inside a charter folder that the plan does not empty are left alone:
  they may be placeholders someone made on purpose. Never proposed for the charter's folders and their
  parents, the inbox, the system folders (attachments, templates, daily notes) or ignored paths.
- *When:* in the last phase, after moves and generated notes, deepest folder first.
- *Safety at apply time:* the folder must still be empty, as Obsidian sees it. If it is not (a move
  out of it was rejected, a note was added since), the operation is skipped with the reason and the
  run goes on; it never fails a run. The validator warns in the review when the plan itself leaves
  something in the folder, and refuses to remove a charter folder.
- *How:* through `fileManager.trashFile`, the same call undo already uses for folders it created, so
  the user's trash setting applies.
- *Undo:* the journal records a `recreateFolder` inverse. Undo runs inverses newest first, so the
  folders come back (parents first) before the notes move back into them.

CLAUDE.md invariant 1 now reads that there is no deletion of *content*, and names this exception.

## Consequences

- A reorganized vault shows only the structure of its charter, plus whatever the user kept.
- The review shows a new group, "Empty folders to remove", accepted or rejected like moves.
- Undo stays byte-exact: an empty folder has no bytes, and the round-trip property test covers it.
- Obsidian does not list hidden files (names starting with a dot), so a folder holding only, say,
  `.DS_Store` counts as empty and goes to the trash with it. With the trash setting "Permanently
  delete", such hidden files are gone. Reading the real directory would need `vault.adapter` outside
  the plugin's own folder, which the plugin rules forbid; we accept this edge case and document it.
- The plan summary counts the new operation, so recorded model answers that summarize plans with
  emptied folders had to be re-recorded.

## Alternatives considered

- **Move emptied folders into the archive.** Keeps the letter of ADR 0002 but only relocates the
  clutter, and v1 moves notes, not folders.
- **Only list the empty folders** in the review and run report, for the user to delete. Safe, but it
  leaves the main complaint in place and makes people do by hand what the plugin could do reversibly.
- **Also remove folders that were empty before the plan, everywhere.** Cleaner still, but inside the
  charter's folders such a folder may be intended (a placeholder for next year's project). Adopted for
  folders outside the charter only; see the amendment.

## Amendment (2026-10-09)

After organizing the synthetic vault into Johnny.Decimal, `Archive old`, `New folder` and `Temp` were
still there: empty before the plan, so this decision left them alone, and the user read them as unfinished
work. A folder that is empty and no part of the charter is neither content nor structure the user chose to
keep; it is what reorganizing is meant to clear. Plans now also propose removing those, with the same
safety (reviewed, empty at apply time, trash, undo). Empty folders inside the charter's folders still stay
unless the plan empties them, and so do empty folders next to them in the same parent, such as a new
category the user made in a Johnny.Decimal area before adding it to the charter. The PARA plan tasks of both eval fixtures remove three more folders, and
their recorded plan summaries were re-recorded.
