import type { Charter, Destination } from '../charter/schema';
import { listGeneratedSections, wrapGeneratedSection } from '../markdown/generated-sections';
import { matchesAnyGlob } from '../model/glob';
import type { VaultSnapshot } from '../model/note';
import { createOperation, type Operation } from '../model/operation';
import { ancestorFolders, fileName, isInFolder, joinPath, parentFolder } from '../model/paths';

export interface MocInput {
  snapshot: VaultSnapshot;
  charter: Charter;
  /** The plan's operations so far: MOCs describe the vault as it will be after them. */
  operations: readonly Operation[];
  read: (path: string) => Promise<string>;
}

const MOC_SECTION = 'moc';
const CATEGORY_SECTION = 'category';

/** Where every note will be after the plan's moves. */
export function pathsAfter(snapshot: VaultSnapshot, operations: readonly Operation[]): Map<string, string> {
  const moved = new Map(operations.flatMap((op) => (op.kind === 'move' ? [[op.from, op.to] as const] : [])));
  return new Map(snapshot.notes.map((note) => [note.path, moved.get(note.path) ?? note.path]));
}

/**
 * Maps of content and category notes (PLAN §3.2 `mocs`). In folder modes, each destination gets a
 * note listing its notes, a section per subfolder, inside the destination or in `mocs.folder`. In
 * properties mode, every category that notes refer to (`categories: [[Books]]`) gets a category
 * note with a Bases view of its members, as in the Flat + categories method. Lists live in a
 * generated section: a later plan updates only that section, and a note the user wrote without
 * one is never touched.
 */
export async function mocOperations(input: MocInput): Promise<Operation[]> {
  const { charter } = input;
  if (!charter.mocs?.enabled) return [];
  return charter.mode === 'properties' ? categoryOperations(input) : destinationMocs(input);
}

async function destinationMocs(input: MocInput): Promise<Operation[]> {
  const { snapshot, charter } = input;
  const after = [...pathsAfter(snapshot, input.operations).values()];
  const titles = titleCounts(after);
  const operations: Operation[] = [];
  for (const destination of charter.destinations) {
    if (!destination.path) continue;
    const name = fileName(destination.path);
    const path = joinPath(charter.mocs?.perDestination === false && charter.mocs.folder ? charter.mocs.folder : destination.path, `${name}.md`);
    const members = after.filter((p) => p !== path && isInFolder(p, destination.path as string) && !matchesAnyGlob(p, charter.ignore)).sort();
    if (members.length === 0) continue;
    const body = mocBody(destination, members, titles);
    operations.push(...(await upsert(input, path, 'moc', MOC_SECTION, `---\ntype: moc\n---\n# ${name}\n\n${wrapGeneratedSection(MOC_SECTION, body)}\n`, body)));
  }
  return operations;
}

function mocBody(destination: Destination, members: readonly string[], titles: ReadonlyMap<string, number>): string {
  const root = destination.path as string;
  const groups = new Map<string, string[]>();
  for (const path of members) {
    const rest = path.slice(root.length + 1).split('/');
    const group = destination.layout !== 'flat' && rest.length > 1 ? (rest[0] ?? '') : '';
    groups.set(group, [...(groups.get(group) ?? []), path]);
  }
  const lines: string[] = [];
  for (const [group, paths] of [...groups].sort(([a], [b]) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b)))) {
    if (group) lines.push('', `## ${group}`);
    lines.push(...paths.map((path) => `- ${link(path, titles)}`));
  }
  return lines.join('\n').trim();
}

async function categoryOperations(input: MocInput): Promise<Operation[]> {
  const { snapshot, charter } = input;
  const folder = charter.mocs?.folder ?? charter.destinations.find((d) => d.id === 'categories')?.path ?? '';
  const existingTitles = new Set(snapshot.notes.map((note) => note.basename.toLowerCase()));
  const categories = new Set<string>();
  for (const note of snapshot.notes) {
    const value = note.frontmatter.categories;
    for (const item of Array.isArray(value) ? (value as unknown[]) : [value]) {
      const match = typeof item === 'string' ? /^\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]$/.exec(item.trim()) : null;
      if (match?.[1]) categories.add(match[1].trim());
    }
  }
  const operations: Operation[] = [];
  // Folders the plan already creates count as existing: the charter's own Categories folder is one.
  const planned = input.operations.flatMap((op) => (op.kind === 'createFolder' ? [op.path] : []));
  const folders = new Set([...snapshot.folders, ...planned].map((f) => f.toLowerCase()));
  for (const category of [...categories].sort()) {
    if (existingTitles.has(category.toLowerCase())) continue;
    const path = joinPath(folder, `${category}.md`);
    for (const ancestor of [...ancestorFolders(path)]) {
      if (folders.has(ancestor.toLowerCase())) continue;
      folders.add(ancestor.toLowerCase());
      operations.push(createOperation({ kind: 'createFolder', path: ancestor }, { source: 'rule', confidence: 1, rationale: 'Holds the category notes.' }));
    }
    const view = ['```base', 'filters:', '  and:', `    - categories.contains(link("${category}"))`, 'views:', '  - type: table', `    name: ${category}`, '```'].join('\n');
    const content = `---\ntype: category\n---\n# ${category}\n\n${wrapGeneratedSection(CATEGORY_SECTION, view)}\n`;
    operations.push(
      createOperation({ kind: 'createNote', path, role: 'category', content }, { source: 'rule', confidence: 1, rationale: `Notes refer to the category [[${category}]], but it has no note yet.` }),
    );
  }
  return operations;
}

/** A new note, or an update of its generated section; a user's note without one is left alone. */
async function upsert(input: MocInput, path: string, role: 'moc' | 'category', sectionId: string, content: string, inner: string): Promise<Operation[]> {
  const note = input.snapshot.notes.find((n) => n.path.toLowerCase() === path.toLowerCase());
  if (!note) {
    const folder = parentFolder(path);
    const needsFolder = folder !== '' && !input.snapshot.folders.some((f) => f.toLowerCase() === folder.toLowerCase()) && !input.operations.some((op) => op.kind === 'createFolder' && op.path.toLowerCase() === folder.toLowerCase());
    return [
      ...(needsFolder ? [createOperation({ kind: 'createFolder', path: folder }, { source: 'rule', confidence: 1, rationale: 'Holds the map of content.' })] : []),
      createOperation({ kind: 'createNote', path, role, content }, { source: 'rule', confidence: 1, rationale: 'The charter asks for a map of content here.' }),
    ];
  }
  const section = listGeneratedSections(await input.read(note.path)).find((s) => s.id === sectionId);
  if (!section || section.inner.trim() === inner.trim()) return [];
  return [
    createOperation(
      { kind: 'updateGeneratedSection', path: note.path, sectionId, content: inner },
      { source: 'rule', confidence: 1, rationale: 'Brings the map of content up to date.', precondition: { path: note.path, contentHash: note.contentHash } },
    ),
  ];
}

function titleCounts(paths: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const path of paths) {
    const title = fileName(path).replace(/\.md$/i, '').toLowerCase();
    counts.set(title, (counts.get(title) ?? 0) + 1);
  }
  return counts;
}

/** `[[Title]]`, or `[[Folder/Title|Title]]` when another note has the same title. */
function link(path: string, titles: ReadonlyMap<string, number>): string {
  const title = fileName(path).replace(/\.md$/i, '');
  return (titles.get(title.toLowerCase()) ?? 0) > 1 ? `[[${path.replace(/\.md$/i, '')}|${title}]]` : `[[${title}]]`;
}
