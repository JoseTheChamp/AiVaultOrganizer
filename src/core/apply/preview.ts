import { replaceCharterBlock } from '../markdown/charter-block';
import { rewriteFrontmatter } from '../markdown/frontmatter-edit';
import { replaceGeneratedSection } from '../markdown/generated-sections';
import { type DiffLine, lineDiff } from '../markdown/line-diff';
import { insertRelatedLinks } from '../markdown/related-links';
import { addTagsToFrontmatter, replaceInlineTag, replaceTagInFrontmatter } from '../markdown/tags-edit';
import type { Operation } from '../model/operation';
import { fileName } from '../model/paths';
import { renameProperty } from './executor';

/** What an operation would do, for the review (PLAN §9.1: path diff, frontmatter diff, inserted lines). */
export type OperationPreview =
  | { kind: 'move'; from: string; to: string }
  | { kind: 'folder'; path: string }
  | { kind: 'remove-folder'; path: string }
  | { kind: 'edit'; path: string; lines: DiffLine[] }
  | { kind: 'create'; path: string; content: string }
  | { kind: 'flag'; path: string; related: string[] }
  /** The edit would change nothing, or cannot be applied to the note as it is now. */
  | { kind: 'none'; path: string; reason: string };

export interface PreviewDeps {
  read: (path: string) => Promise<string>;
  /** How a link to `target` is written from `source`; plain file names when absent. */
  linkText?: (target: string, source: string) => Promise<string>;
}

/**
 * Applies an operation to the note's current text in memory, with the same edit functions the
 * executor uses, and shows the difference. Nothing is written. Moves show their paths; Obsidian
 * rewrites links to a moved note, which the preview does not list.
 */
export async function previewOperation(op: Operation, deps: PreviewDeps): Promise<OperationPreview> {
  switch (op.kind) {
    case 'createFolder':
      return { kind: 'folder', path: op.path };
    case 'removeEmptyFolder':
      return { kind: 'remove-folder', path: op.path };
    case 'move':
      return { kind: 'move', from: op.from, to: op.to };
    case 'createNote':
      return { kind: 'create', path: op.path, content: op.content };
    case 'flag':
      return { kind: 'flag', path: op.path, related: op.related ?? [] };
    case 'setProperty':
      return edit(op, deps, (content) => rewriteFrontmatter(content, (fm) => (fm[op.key] = op.value)));
    case 'renameProperty':
      return edit(op, deps, (content) => rewriteFrontmatter(content, (fm) => renameProperty(fm, op.from, op.to)));
    case 'addTags':
      return edit(op, deps, (content) => rewriteFrontmatter(content, (fm) => void addTagsToFrontmatter(fm, op.tags)));
    case 'replaceTag':
      return edit(op, deps, (content) => replaceInlineTag(rewriteFrontmatter(content, (fm) => void replaceTagInFrontmatter(fm, op.from, op.to)), op.from, op.to));
    case 'addRelatedLinks': {
      const texts = await Promise.all(op.targets.map((target) => (deps.linkText ? deps.linkText(target, op.path) : Promise.resolve(fileName(target).replace(/\.md$/i, '')))));
      return edit(op, deps, (content) => insertRelatedLinks(content, op.heading, texts).content);
    }
    case 'updateGeneratedSection':
      return edit(op, deps, (content) => {
        const result = replaceGeneratedSection(content, op.sectionId, op.content);
        if (!result.ok) throw new Error(`its generated section "${op.sectionId}" is ${result.error}`);
        return result.value;
      });
    case 'updateCharterRules':
      return edit(op, deps, (content) => {
        const result = replaceCharterBlock(content, op.yaml);
        if (!result.ok) throw new Error('it has no charter block');
        return result.value;
      });
  }
}

async function edit(op: Operation & { path: string }, deps: PreviewDeps, change: (content: string) => string): Promise<OperationPreview> {
  // An edit to a note that also moves names its new path; until the move it is where its
  // precondition says.
  const path = op.path;
  let before: string;
  try {
    before = await deps.read(op.precondition?.path ?? path);
  } catch {
    return { kind: 'none', path, reason: 'The note no longer exists.' };
  }
  try {
    const after = change(before);
    if (after === before) return { kind: 'none', path, reason: 'Nothing would change: the note already looks like this.' };
    return { kind: 'edit', path, lines: lineDiff(before, after) };
  } catch (error) {
    return { kind: 'none', path, reason: `This cannot be applied: ${error instanceof Error ? error.message : String(error)}.` };
  }
}
