import type { Operation, OperationKind } from './operation';

/** One-line, sentence-case description of what an operation proposes. */
export function describeOperation(op: Operation): string {
  switch (op.kind) {
    case 'createFolder':
      return `Create folder "${op.path}"`;
    case 'move':
      return `Move "${op.from}" to "${op.to}"`;
    case 'setProperty':
      return `Set "${op.key}" to ${JSON.stringify(op.value)} in "${op.path}"`;
    case 'renameProperty':
      return `Rename property "${op.from}" to "${op.to}" in "${op.path}"`;
    case 'addTags':
      return `Add ${op.tags.map((tag) => `#${tag}`).join(', ')} to "${op.path}"`;
    case 'replaceTag':
      return `Rename #${op.from} to #${op.to} in "${op.path}"`;
    case 'addRelatedLinks':
      return `Link "${op.path}" to ${op.targets.map((t) => `"${t}"`).join(', ')}`;
    case 'createNote':
      return `Create ${op.role === 'moc' ? 'map of content' : op.role} note "${op.path}"`;
    case 'updateGeneratedSection':
      return `Update generated section "${op.sectionId}" in "${op.path}"`;
    case 'updateCharterRules':
      return `Update the rules block of "${op.path}"`;
    case 'flag':
      return `Flag "${op.path}" as ${op.issue.replace('-', ' ')}`;
  }
}

export const KIND_LABELS: Record<OperationKind, string> = {
  createFolder: 'New folders',
  move: 'Moves',
  setProperty: 'Properties',
  renameProperty: 'Property renames',
  addTags: 'Tags',
  replaceTag: 'Tag renames',
  addRelatedLinks: 'Related links',
  createNote: 'New notes',
  updateGeneratedSection: 'Generated sections',
  updateCharterRules: 'Charter rules',
  flag: 'Flags for you to look at',
};
