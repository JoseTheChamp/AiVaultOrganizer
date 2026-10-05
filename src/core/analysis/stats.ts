import type { VaultSnapshot } from '../model/note';
import { ancestorFolders, depth, fileName, parentFolder } from '../model/paths';
import { computeGraphMetrics, type GraphMetrics } from './graph';
import { guessLanguage, type LanguageGuess } from './language';
import { computeTagStats, type TagStats } from './tags';

const ATTACHMENT_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif', 'heic',
  'pdf', 'mp3', 'wav', 'm4a', 'ogg', 'flac', 'webm', 'mp4', 'mov', 'mkv',
]);

/** `2026-10-05`, `2026-10-05 Standup`, `20261005`… at the start of a file name. */
export const DATED_NAME = /^\d{4}-?\d{2}-?\d{2}(?:\b|_|$)/;

export interface PropertyUsage {
  key: string;
  count: number;
  share: number;
}

export interface FolderUsage {
  path: string;
  /** Notes in this folder and all its subfolders. */
  noteCount: number;
}

export interface VaultStats {
  noteCount: number;
  folderCount: number;
  otherFileCount: number;
  attachmentCount: number;
  canvasCount: number;
  baseFileCount: number;
  totalWords: number;
  medianWords: number;
  rootNoteCount: number;
  rootShare: number;
  maxDepth: number;
  avgDepth: number;
  /** Index = folder depth of the note, value = number of notes. */
  depthHistogram: number[];
  /** Folders with no files anywhere below them. */
  emptyFolders: string[];
  topLevelFolders: FolderUsage[];
  /** Notes whose file name starts with a date. */
  datedNoteCount: number;
  /** Sum over notes of distinct unresolved link targets. */
  unresolvedLinkCount: number;
  notesWithUnresolvedLinks: number;
  frontmatterShare: number;
  properties: PropertyUsage[];
  graph: GraphMetrics;
  tags: TagStats;
  language: LanguageGuess;
}

export function computeStats(snapshot: VaultSnapshot): VaultStats {
  const { notes } = snapshot;
  const count = notes.length;
  const depths = notes.map((note) => depth(note.path));
  const depthHistogram: number[] = [];
  for (const d of depths) depthHistogram[d] = (depthHistogram[d] ?? 0) + 1;
  for (let i = 0; i < depthHistogram.length; i++) depthHistogram[i] ??= 0;

  const words = notes.map((note) => note.wordCount).sort((a, b) => a - b);
  const rootNoteCount = notes.filter((note) => note.folder === '').length;

  const propertyCounts = new Map<string, number>();
  let withFrontmatter = 0;
  for (const note of notes) {
    const keys = Object.keys(note.frontmatter);
    if (keys.length > 0) withFrontmatter++;
    for (const key of keys) propertyCounts.set(key, (propertyCounts.get(key) ?? 0) + 1);
  }

  return {
    noteCount: count,
    folderCount: snapshot.folders.length,
    otherFileCount: snapshot.otherFiles.length,
    attachmentCount: snapshot.otherFiles.filter((file) => ATTACHMENT_EXTENSIONS.has(file.extension)).length,
    canvasCount: snapshot.otherFiles.filter((file) => file.extension === 'canvas').length,
    baseFileCount: snapshot.otherFiles.filter((file) => file.extension === 'base').length,
    totalWords: words.reduce((total, w) => total + w, 0),
    medianWords: median(words),
    rootNoteCount,
    rootShare: share(rootNoteCount, count),
    maxDepth: Math.max(0, ...depths),
    avgDepth: count === 0 ? 0 : depths.reduce((total, d) => total + d, 0) / count,
    depthHistogram,
    emptyFolders: emptyFolders(snapshot),
    topLevelFolders: topLevelFolders(snapshot),
    datedNoteCount: notes.filter((note) => DATED_NAME.test(note.basename)).length,
    unresolvedLinkCount: notes.reduce((total, note) => total + note.unresolvedLinks.length, 0),
    notesWithUnresolvedLinks: notes.filter((note) => note.unresolvedLinks.length > 0).length,
    frontmatterShare: share(withFrontmatter, count),
    properties: [...propertyCounts]
      .map(([key, n]) => ({ key, count: n, share: share(n, count) }))
      .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key)),
    graph: computeGraphMetrics(notes),
    tags: computeTagStats(notes),
    language: guessLanguage(languageSamples(snapshot)),
  };
}

function emptyFolders(snapshot: VaultSnapshot): string[] {
  const occupied = new Set<string>();
  for (const path of [...snapshot.notes.map((n) => n.path), ...snapshot.otherFiles.map((f) => f.path)]) {
    for (const folder of ancestorFolders(path)) occupied.add(folder);
  }
  return snapshot.folders.filter((folder) => !occupied.has(folder));
}

function topLevelFolders(snapshot: VaultSnapshot): FolderUsage[] {
  const counts = new Map<string, number>();
  for (const folder of snapshot.folders) {
    if (parentFolder(folder) === '') counts.set(folder, 0);
  }
  for (const note of snapshot.notes) {
    const top = ancestorFolders(note.path)[0];
    if (top !== undefined) counts.set(top, (counts.get(top) ?? 0) + 1);
  }
  return [...counts]
    .map(([path, noteCount]) => ({ path, noteCount }))
    .sort((a, b) => b.noteCount - a.noteCount || a.path.localeCompare(b.path));
}

function languageSamples(snapshot: VaultSnapshot): string[] {
  const samples: string[] = snapshot.folders.map(fileName);
  for (const note of snapshot.notes.slice(0, 2000)) {
    samples.push(note.basename, ...note.headings.slice(0, 5).map((heading) => heading.text));
  }
  return samples;
}

export function share(part: number, whole: number): number {
  return whole === 0 ? 0 : part / whole;
}

function median(sorted: readonly number[]): number {
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? (sorted[mid] ?? 0) : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}
