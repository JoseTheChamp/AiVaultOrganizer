import { subfolderNamingV1 } from '../ai/prompts/subfolder-naming.v1';
import { runPrompt } from '../ai/prompts/types';
import type { ChatProvider } from '../ai/types';
import type { Charter } from '../charter/schema';
import { isInFolder } from '../model/paths';
import type { Classification, Placement } from './classify';
import { safeFolderName } from './placement-plan';

/** Asks for better names for new subfolders (Tier 2); returns proposal key → chosen name. */
export type SubfolderNamer = (request: NamingRequest) => Promise<Map<string, string>>;

export interface NamingRequest {
  destination: { id: string; description: string };
  existing: string[];
  /** New subfolders to name: a normalized key, the proposed name and a few of their notes. */
  proposals: { key: string; name: string; notes: string[] }[];
}

export interface SubfolderReport {
  /** Placements whose subfolder now points at an existing folder. */
  reused: number;
  /** Proposed spellings merged into another spelling or an existing folder. */
  merged: number;
  /** New subfolders the plan will create. */
  created: number;
}

/** Folds case, diacritics, punctuation and a plural "s", so spellings of one name compare equal. */
export function folderKey(name: string): string {
  const folded = name
    .normalize('NFD')
    .replace(/\p{Mn}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
  return folded.length > 4 && folded.endsWith('s') && !folded.endsWith('ss') ? folded.slice(0, -1) : folded;
}

/**
 * Two keys name the same thing: equal, or a typo apart in a long name. Deliberately not prefixes:
 * "Health" and "Health insurance" are different areas.
 */
function sameFolder(a: string, b: string): boolean {
  if (a === b) return true;
  const longest = Math.max(a.length, b.length);
  return longest >= 8 && editDistance(a, b) <= Math.floor(longest / 8);
}

/**
 * Names subfolders for item and topic layouts (PLAN §7.6 "Subfolders"). Every proposed subfolder
 * is matched against the folders that already exist under its destination, ignoring case,
 * diacritics, punctuation and plurals, so notes join "Website relaunch" rather than creating
 * "website-relaunch". Proposals that only differ in spelling are merged into the most common one.
 * Whatever is still new can be renamed by a language model (`subfolder-naming`), which sees the
 * existing folders and is asked to prevent near-duplicates.
 */
export async function reconcileSubfolders(classification: Classification, charter: Charter, folders: readonly string[], namer?: SubfolderNamer): Promise<SubfolderReport> {
  const report: SubfolderReport = { reused: 0, merged: 0, created: 0 };
  for (const destination of charter.destinations) {
    if (!destination.path || destination.layout === 'flat') continue;
    const root = destination.path;
    const placements = [...classification.placements.values()].filter((p) => p.destination === destination.id && p.subfolder);
    if (placements.length === 0) continue;
    const existing = folders
      .filter((folder) => isInFolder(folder, root) && folder !== root && !folder.slice(root.length + 1).includes('/'))
      .map((folder) => folder.slice(root.length + 1))
      .sort();

    // 1. Reuse existing folders.
    const open: Placement[] = [];
    for (const placement of placements) {
      const proposed = placement.subfolder as string;
      const match = existing.find((name) => sameFolder(folderKey(name), folderKey(proposed)));
      if (match) {
        if (match !== proposed) report.merged++;
        report.reused++;
        update(classification, placement, match);
      } else {
        open.push(placement);
      }
    }

    // 2. Merge spellings of new names into the most common one (rules and kNN before the model).
    const groups: { key: string; names: Map<string, number>; members: Placement[] }[] = [];
    for (const placement of open) {
      const name = safeFolderName(placement.subfolder as string);
      const key = folderKey(name);
      let group = groups.find((g) => sameFolder(g.key, key));
      if (!group) groups.push((group = { key, names: new Map(), members: [] }));
      const weight = placement.source === 'llm' ? 1 : 2;
      group.names.set(name, (group.names.get(name) ?? 0) + weight);
      group.members.push(placement);
    }
    const chosen = new Map(groups.map((group) => [group.key, [...group.names].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0] ?? group.key]));

    // 3. Optionally let a model improve the new names, with the existing ones in view.
    if (namer && groups.length > 0) {
      const names = await namer({
        destination: { id: destination.id, description: destination.description },
        existing,
        proposals: groups.map((group) => ({ key: group.key, name: chosen.get(group.key) ?? group.key, notes: group.members.slice(0, 5).map((m) => title(m.path)) })),
      });
      for (const [key, name] of names) {
        const safe = safeFolderName(name);
        if (!safe || !chosen.has(key)) continue;
        const reuse = existing.find((folder) => folderKey(folder) === folderKey(safe));
        chosen.set(key, reuse ?? safe);
      }
    }

    for (const group of groups) {
      const name = chosen.get(group.key) ?? group.key;
      if (existing.includes(name)) report.reused += group.members.length;
      else report.created++;
      for (const placement of group.members) {
        if (placement.subfolder !== name) report.merged++;
        update(classification, placement, name);
      }
    }
  }
  return report;
}

function update(classification: Classification, placement: Placement, subfolder: string): void {
  classification.placements.set(placement.path, { ...placement, subfolder });
}

function title(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/i, '');
}

/** Optimal string alignment distance: insertions, deletions, substitutions and swapped neighbours. */
function editDistance(a: string, b: string): number {
  const rows = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  const at = (i: number, j: number): number => rows[i]?.[j] ?? 0;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let best = Math.min(at(i - 1, j) + 1, at(i, j - 1) + 1, at(i - 1, j - 1) + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) best = Math.min(best, at(i - 2, j - 2) + 1);
      const row = rows[i];
      if (row) row[j] = best;
    }
  }
  return at(a.length, b.length);
}

export interface NamerStats {
  calls: number;
  failures: number;
}

/**
 * A subfolder namer backed by the `subfolder-naming` prompt. A failed call keeps the proposed
 * names (they are already reconciled and safe), so naming can only improve a plan.
 */
export function createSubfolderNamer(provider: ChatProvider, language: 'en' | 'cs'): { namer: SubfolderNamer; stats: NamerStats } {
  const stats: NamerStats = { calls: 0, failures: 0 };
  const namer: SubfolderNamer = async (request) => {
    const keyed = request.proposals.map((proposal, i) => ({ ...proposal, key: `f${i + 1}` }));
    const result = await runPrompt(provider, subfolderNamingV1, { language, destination: request.destination, existing: request.existing, proposals: keyed });
    stats.calls += result.ok ? result.value.attempts : result.error.attempts;
    if (!result.ok) {
      stats.failures++;
      return new Map();
    }
    const byKey = new Map(result.value.value.folders.map((folder) => [folder.key, folder.name]));
    return new Map(keyed.flatMap((proposal, i) => {
      const name = byKey.get(proposal.key);
      const original = request.proposals[i];
      return name && original ? [[original.key, name] as const] : [];
    }));
  };
  return { namer, stats };
}
