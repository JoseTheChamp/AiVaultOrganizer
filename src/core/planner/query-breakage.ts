import { FENCE } from '../markdown/prose';
import type { VaultSnapshot } from '../model/note';
import { createOperation, type Operation } from '../model/operation';
import { isInFolder } from '../model/paths';
import { plural, verb } from '../model/text';

/** A query that selects notes by folder. */
export interface FolderQuery {
  path: string;
  /** 1-based line in the file. */
  line: number;
  folder: string;
  kind: 'Dataview' | 'Bases';
}

const DATAVIEW_FROM = /\bFROM\b(.*?)(?:\b(?:WHERE|SORT|GROUP BY|LIMIT|FLATTEN)\b|$)/i;
const QUOTED = /"([^"\n]+)"/g;
const DV_PAGES = /dv\.pages\(\s*(['`])"([^"\n]+)"\1\s*\)/g;
const BASE_FOLDER = [/file\.inFolder\(\s*["']([^"'\n]+)["']\s*\)/g, /file\.folder\s*={1,3}\s*["']([^"'\n]+)["']/g, /file\.path\.startsWith\(\s*["']([^"'\n]+)["']\s*\)/g];

/**
 * Folder references in Dataview queries (`FROM "Projects"`, `dv.pages('"Projects"')`) and Bases
 * filters (`file.inFolder("Projects")`, `file.folder == "Projects"`), in Markdown code blocks and
 * in `.base` files (PLAN §5.8). Tags (`FROM #tag`) and links don't depend on folders.
 */
export function findFolderQueries(path: string, content: string): FolderQuery[] {
  const queries: FolderQuery[] = [];
  const isBaseFile = path.toLowerCase().endsWith('.base');
  let block: 'dataview' | 'dataviewjs' | 'base' | 'other' | null = isBaseFile ? 'base' : null;
  let fence = '';
  content.split(/\r?\n/).forEach((text, index) => {
    const line = index + 1;
    if (!isBaseFile) {
      const marker = FENCE.exec(text)?.[1];
      if (block === null && marker) {
        const language = text.slice(text.indexOf(marker) + marker.length).trim().toLowerCase();
        block = language === 'dataview' || language === 'dataviewjs' || language === 'base' ? language : 'other';
        fence = marker;
        return;
      }
      if (block !== null && marker && marker[0] === fence[0] && marker.length >= fence.length) {
        block = null;
        return;
      }
    }
    if (block === 'dataview') {
      const from = DATAVIEW_FROM.exec(text)?.[1] ?? '';
      for (const match of from.matchAll(QUOTED)) if (match[1]) queries.push({ path, line, folder: match[1], kind: 'Dataview' });
    } else if (block === 'dataviewjs') {
      for (const match of text.matchAll(DV_PAGES)) if (match[2]) queries.push({ path, line, folder: match[2], kind: 'Dataview' });
    } else if (block === 'base') {
      for (const pattern of BASE_FOLDER) for (const match of text.matchAll(pattern)) if (match[1]) queries.push({ path, line, folder: match[1], kind: 'Bases' });
    }
  });
  return queries;
}

/**
 * Flags every folder query whose results the plan would change: a planned move takes a note into
 * or out of the folder it selects. One flag per file and folder, with the line, so the user can
 * update the query after applying. Rewriting queries automatically is on the roadmap.
 */
export async function queryBreakageOperations(snapshot: VaultSnapshot, operations: readonly Operation[], read: (path: string) => Promise<string>): Promise<Operation[]> {
  const moves = operations.filter((op): op is Extract<Operation, { kind: 'move' }> => op.kind === 'move');
  if (moves.length === 0) return [];
  const files = [...snapshot.notes.map((note) => note.path), ...snapshot.otherFiles.filter((file) => file.extension.toLowerCase() === 'base').map((file) => file.path)];
  const flags: Operation[] = [];
  for (const path of files) {
    const content = await read(path);
    if (!/dataview|base|file\.|dv\./i.test(content)) continue;
    const byFolder = new Map<string, FolderQuery>();
    for (const query of findFolderQueries(path, content)) if (!byFolder.has(query.folder)) byFolder.set(query.folder, query);
    for (const query of byFolder.values()) {
      const changes = moves.filter((move) => isInFolder(move.from, query.folder) !== isInFolder(move.to, query.folder));
      if (changes.length === 0) continue;
      const example = changes[0] as Extract<Operation, { kind: 'move' }>;
      const direction = isInFolder(example.from, query.folder) ? 'out of' : 'into';
      flags.push(
        createOperation(
          { kind: 'flag', path, issue: 'query-breakage', related: [query.folder] },
          {
            source: 'rule',
            confidence: 1,
            rationale: `Line ${query.line}: a ${query.kind} query reads the folder "${query.folder}", and ${plural(changes.length, 'planned move')} ${verb(changes.length, 'changes', 'change')} what it finds (for example "${example.from}" moves ${direction} it). Update the query after applying.`,
          },
        ),
      );
    }
  }
  return flags;
}
