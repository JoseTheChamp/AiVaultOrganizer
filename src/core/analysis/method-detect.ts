import type { MethodId } from '../model/methods';
import { METHOD_LABELS } from '../model/methods';
import type { VaultSnapshot } from '../model/note';
import { fileName, parentFolder } from '../model/paths';
import { plural } from '../model/text';
import type { VaultStats } from './stats';
import { share } from './stats';
import { type FolderRole, folderRole } from './vocabulary';

export interface MethodScore {
  method: MethodId;
  /** 0..1, how strongly the vault's structure matches the method. */
  score: number;
  /** Human-readable evidence, shown in the diagnostics. */
  reasons: string[];
}

export interface MethodDetection {
  /** All methods, best match first. */
  scores: MethodScore[];
  /** The clearly dominant method, `mixed` when two methods compete, `none` when nothing fits. */
  dominant: MethodId | 'mixed' | 'none';
}

const JD_RANGE = /^\d{2}-\d{2}(?:\s|$)/;
const JD_CATEGORY = /^\d{2}(?:\s|$)/;
const JD_ID = /^\d{2}\.\d{2}(?:\s|$)/;
const ZETTEL_ID = /^(?:\d{12,14}|\d{8}[T-]?\d{4,6})(?:\s|$)/;

/**
 * Scores each organization method from structural signals: folder names (English and Czech),
 * numbering schemes, ID file names, root share, `categories` usage and link density.
 * Pure heuristics (tier 0); the scores feed the wizard's recommendation, never an automatic action.
 */
export function detectMethods(snapshot: VaultSnapshot, stats: VaultStats): MethodDetection {
  const topLevel = snapshot.folders.filter((folder) => parentFolder(folder) === '');
  const topRoles = new Map<FolderRole, string>();
  for (const folder of topLevel) {
    const role = folderRole(folder);
    if (role && !topRoles.has(role)) topRoles.set(role, folder);
  }

  const scores: MethodScore[] = [
    scorePara(topRoles),
    scoreJohnnyDecimal(snapshot, topLevel),
    scoreAce(topRoles, snapshot),
    scoreZettelkasten(snapshot, stats),
    scoreFlat(snapshot, stats, topRoles),
  ];
  scores.push(scoreTopics(snapshot, topLevel, Math.max(...scores.map((s) => s.score))));
  for (const entry of scores) entry.score = round(clamp(entry.score));
  scores.sort((a, b) => b.score - a.score);

  return { scores, dominant: pickDominant(scores) };
}

function scorePara(topRoles: Map<FolderRole, string>): MethodScore {
  const buckets: FolderRole[] = ['projects', 'areas', 'resources', 'archive'];
  const found = buckets.filter((role) => topRoles.has(role));
  const reasons: string[] = [];
  if (found.length > 0) {
    reasons.push(`Top-level folders for ${found.join(', ')}: ${found.map((r) => `"${topRoles.get(r)}"`).join(', ')}.`);
  }
  // One PARA-like folder (an "Archive" is common everywhere) is weak evidence on its own.
  let score = found.length >= 2 ? found.length / 4 : found.length * 0.1;
  if (topRoles.has('inbox') && found.length >= 2) {
    score += 0.1;
    reasons.push('Has an inbox folder.');
  }
  return { method: 'para', score, reasons };
}

function scoreJohnnyDecimal(snapshot: VaultSnapshot, topLevel: string[]): MethodScore {
  const ranges = topLevel.filter((folder) => JD_RANGE.test(folder));
  const second = snapshot.folders.filter((folder) => parentFolder(folder) !== '' && !parentFolder(parentFolder(folder)));
  const categories = second.filter((folder) => JD_CATEGORY.test(fileName(folder)));
  const ids = snapshot.notes.filter((note) => JD_ID.test(note.basename)).length;
  const reasons: string[] = [];
  if (ranges.length > 0) reasons.push(`${plural(ranges.length, 'area folder')} numbered like "10-19".`);
  if (categories.length > 0) reasons.push(`${plural(categories.length, 'category folder')} numbered like "11".`);
  if (ids > 0) reasons.push(`${plural(ids, 'note')} with IDs like "11.01".`);
  const score =
    ranges.length < 2
      ? 0
      : 0.5 * share(ranges.length, topLevel.length) +
        0.25 * share(categories.length, second.length) +
        0.25 * share(ids, snapshot.notes.length);
  return { method: 'johnny-decimal', score: ranges.length >= 2 ? score + 0.2 : score, reasons };
}

function scoreAce(topRoles: Map<FolderRole, string>, snapshot: VaultSnapshot): MethodScore {
  const found = (['atlas', 'calendar', 'efforts'] as FolderRole[]).filter((role) => topRoles.has(role));
  const reasons: string[] = [];
  if (found.length > 0) reasons.push(`Top-level folders for ${found.join(', ')}.`);
  let score = found.length >= 2 ? found.length / 3 : found.length * 0.1;
  const atlas = topRoles.get('atlas');
  if (atlas && snapshot.folders.some((folder) => parentFolder(folder) === atlas && /maps?$/i.test(folder))) {
    score += 0.05;
    reasons.push('Atlas contains a Maps folder.');
  }
  return { method: 'ace', score, reasons };
}

function scoreZettelkasten(snapshot: VaultSnapshot, stats: VaultStats): MethodScore {
  const idNotes = snapshot.notes.filter((note) => ZETTEL_ID.test(note.basename)).length;
  const idShare = share(idNotes, snapshot.notes.length);
  const zettelFolders = snapshot.folders.filter((folder) => {
    const role = folderRole(fileName(folder));
    return role === 'fleeting' || role === 'literature' || role === 'permanent';
  });
  const reasons: string[] = [];
  if (idNotes > 0) reasons.push(`${Math.round(idShare * 100)} % of notes have timestamp IDs.`);
  if (zettelFolders.length > 0) reasons.push(`Folders for note kinds: ${zettelFolders.join(', ')}.`);
  const base = Math.max(idShare, zettelFolders.length > 0 ? 0.3 + 0.15 * Math.min(3, zettelFolders.length) : 0);
  const density = Math.min(1, stats.graph.avgOutDegree / 3);
  if (base > 0 && density > 0.5) reasons.push(`Dense linking (${stats.graph.avgOutDegree.toFixed(1)} links per note).`);
  return { method: 'zettelkasten', score: base * (0.7 + 0.3 * density), reasons };
}

function scoreFlat(snapshot: VaultSnapshot, stats: VaultStats, topRoles: Map<FolderRole, string>): MethodScore {
  const categories = stats.properties.find((property) => property.key.toLowerCase() === 'categories');
  const categoriesShare = categories?.share ?? 0;
  const flatFolders = (['references', 'clippings', 'categories'] as FolderRole[]).filter((role) => topRoles.has(role));
  const reasons: string[] = [];
  if (stats.rootShare >= 0.3) reasons.push(`${Math.round(stats.rootShare * 100)} % of notes live in the vault root.`);
  if (categoriesShare > 0) reasons.push(`${Math.round(categoriesShare * 100)} % of notes have a "categories" property.`);
  if (stats.baseFileCount > 0) reasons.push(`${plural(stats.baseFileCount, 'Bases file')}.`);
  if (flatFolders.length > 0) reasons.push(`Folders for ${flatFolders.join(', ')}.`);
  const score =
    0.35 * Math.min(1, stats.rootShare / 0.6) +
    0.35 * Math.min(1, categoriesShare / 0.3) +
    0.15 * (stats.baseFileCount > 0 ? 1 : 0) +
    0.15 * (flatFolders.length / 3);
  // A full root without any category signal is just clutter, not the flat method.
  return { method: 'flat-categories', score: categoriesShare === 0 && stats.baseFileCount === 0 ? score * 0.5 : score, reasons };
}

function scoreTopics(snapshot: VaultSnapshot, topLevel: string[], bestOther: number): MethodScore {
  const topicFolders = topLevel.filter((folder) => {
    const role = folderRole(folder);
    return role === null && !JD_RANGE.test(folder);
  });
  const inTopics = snapshot.notes.filter((note) => topicFolders.some((folder) => note.path.startsWith(`${folder}/`)));
  const noteShare = share(inTopics.length, snapshot.notes.length);
  const reasons: string[] = [];
  if (topicFolders.length > 0) {
    reasons.push(`${plural(topicFolders.length, 'subject folder')} such as ${topicFolders.slice(0, 3).map((f) => `"${f}"`).join(', ')}.`);
  }
  const breadth = Math.min(1, topicFolders.length / 3);
  return { method: 'topics', score: noteShare * breadth * (1 - 0.6 * bestOther), reasons };
}

function pickDominant(scores: MethodScore[]): MethodDetection['dominant'] {
  const [first, second] = scores;
  if (!first || first.score < 0.3) return 'none';
  if (second && second.score >= 0.4 && first.score - second.score < 0.15) return 'mixed';
  return first.method;
}

/** Short sentence for the diagnostics header. */
export function describeDetection(detection: MethodDetection): string {
  const { dominant, scores } = detection;
  if (dominant === 'none') return 'No clear organization method detected yet.';
  if (dominant === 'mixed') {
    const [a, b] = scores;
    return `A mix of ${a ? METHOD_LABELS[a.method] : '?'} and ${b ? METHOD_LABELS[b.method] : '?'}.`;
  }
  return `Mostly ${METHOD_LABELS[dominant]}.`;
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
