import type { Charter } from '../charter/schema';
import { matchesAnyGlob } from '../model/glob';
import type { VaultSnapshot } from '../model/note';
import { createOperation, type Operation } from '../model/operation';
import { parentFolder } from '../model/paths';
import { charterRoots } from './charter-roots';

/**
 * Removals for empty folders (ADR 0009): folders whose subtree held a file before the plan and holds
 * none after it, and folders that hold nothing and are no part of the charter (a stray "New folder"),
 * together with the empty folders inside them. Empty folders inside the charter's folders were left
 * empty on purpose (a placeholder for a project) and stay unless the plan empties them; the charter's
 * folders and their parents, the system folders and ignored ones always stay. Deepest first, so each
 * folder is empty when its turn comes.
 *
 * A removal is as confident as the least confident move out of its folder, so accepting "80 % or
 * more" never removes a folder whose notes are not all accepted to leave.
 */
export function emptiedFolderOperations(snapshot: VaultSnapshot, charter: Charter, operations: readonly Operation[]): Operation[] {
  const moves = operations.filter((op): op is Extract<Operation, { kind: 'move' }> => op.kind === 'move');
  const movedTo = new Map(moves.map((op) => [op.from, op.to]));
  const before = [...snapshot.notes.map((note) => note.path), ...snapshot.otherFiles.map((file) => file.path)];
  const after = [
    ...before.map((path) => movedTo.get(path) ?? path),
    // New notes, and folders the plan creates, keep their folder in use.
    ...operations.flatMap((op) => (op.kind === 'createNote' || op.kind === 'createFolder' ? [op.path] : [])),
  ];
  const holds = (paths: readonly string[], folder: string) => paths.some((path) => inside(path, folder) && path.toLowerCase() !== folder.toLowerCase());

  const kept = [...charterRoots(charter), charter.system.attachments, charter.system.templates].filter((path): path is string => Boolean(path));
  const protectedFolder = (folder: string) => kept.some((root) => inside(root, folder)) || matchesAnyGlob(`${folder}/x`, charter.ignore);
  // Inside a charter folder, above one (an area), or next to them in the same parent (a new category in
  // a Johnny.Decimal area, made by the user and not in the charter yet): part of the system's structure.
  const inCharter = (folder: string) => {
    const parent = parentFolder(folder);
    return kept.some((root) => inside(folder, root) || inside(root, folder) || (parent !== '' && inside(root, parent)));
  };

  const emptied = snapshot.folders.filter((folder) => holds(before, folder) && !holds(after, folder));
  const strays = snapshot.folders.filter((folder) => !holds(before, folder) && !holds(after, folder) && !inCharter(folder));
  const tops = [...emptied, ...strays];
  const removable = snapshot.folders.filter(
    (folder) =>
      tops.some((top) => inside(folder, top)) &&
      // A protected folder keeps its parents too.
      !snapshot.folders.some((other) => inside(other, folder) && protectedFolder(other)),
  );

  const depth = (path: string) => path.split('/').length;
  return removable
    .sort((a, b) => depth(b) - depth(a) || a.localeCompare(b))
    .map((path) => {
      const leaving = moves.filter((op) => inside(op.from, path));
      const confidence = Math.min(1, ...leaving.map((op) => op.confidence));
      const rationale =
        leaving.length > 0
          ? `Left empty when ${leaving.length === 1 ? 'its note moves' : `its ${leaving.length} notes move`}. Undo brings it back.`
          : emptied.some((top) => inside(path, top))
            ? 'An empty folder inside one this plan empties. Undo brings it back.'
            : 'Empty, and no part of your system. Undo brings it back.';
      return createOperation({ kind: 'removeEmptyFolder', path }, { source: 'rule', confidence, rationale });
    });
}

/** `path` is `folder` or inside it, ignoring case as Windows and macOS do. */
function inside(path: string, folder: string): boolean {
  const [p, f] = [path.toLowerCase(), folder.toLowerCase()];
  return p === f || p.startsWith(`${f}/`);
}
