import type { VaultSnapshot } from '../model/note';
import { depth, isInFolder, parentFolder } from '../model/paths';
import type { MethodDetection } from './method-detect';
import { plural, verb } from '../model/text';
import { DATED_NAME, share, type VaultStats } from './stats';
import { folderRole } from './vocabulary';

export type HealthComponentId =
  | 'orphans'
  | 'root-clutter'
  | 'inbox-backlog'
  | 'unresolved-links'
  | 'tag-variants'
  | 'property-coverage'
  | 'empty-folders'
  | 'depth';

export interface HealthComponent {
  id: HealthComponentId;
  label: string;
  /** 0..1 where 1 is healthy. */
  value: number;
  /** Relative weight; 0 when the component does not apply to this vault. */
  weight: number;
  detail: string;
}

export interface HealthReport {
  /** 0..100. */
  score: number;
  grade: 'good' | 'fair' | 'poor';
  components: HealthComponent[];
}

export interface HealthOptions {
  now: number;
  /** Inbox folder from the charter; detected by name when absent. */
  inboxFolder?: string;
  inboxMaxAgeDays?: number;
}

const DAY = 24 * 60 * 60 * 1000;

/**
 * Health score (0–100): a weighted mean of simple, explainable components. Each component maps a
 * raw ratio to 0..1 with a linear penalty up to a "fully unhealthy" threshold. Components that do
 * not apply (no inbox, no tags, no folders, root notes in a flat vault) get weight 0.
 */
export function computeHealth(
  snapshot: VaultSnapshot,
  stats: VaultStats,
  detection: MethodDetection,
  options: HealthOptions,
): HealthReport {
  const n = stats.noteCount;
  const components: HealthComponent[] = [];

  const datedOrphans = snapshot.notes.filter((note) => note.inLinks.length === 0 && DATED_NAME.test(note.basename));
  const orphanCount = stats.graph.orphans.length - datedOrphans.length;
  const orphanShare = share(orphanCount, n);
  components.push({
    id: 'orphans',
    label: 'Linked notes',
    value: penalty(orphanShare, 0.6),
    weight: n > 0 ? 0.2 : 0,
    detail: `${plural(orphanCount, 'note')} ${verb(orphanCount, 'has', 'have')} no incoming links (dated notes excluded).`,
  });

  const flat = detection.dominant === 'flat-categories';
  components.push({
    id: 'root-clutter',
    label: 'Tidy root',
    value: penalty(stats.rootShare, 0.5),
    weight: n > 0 && !flat ? 0.15 : 0,
    detail: flat
      ? 'Root notes are intended in a flat vault.'
      : `${plural(stats.rootNoteCount, 'note')} ${verb(stats.rootNoteCount, 'sits', 'sit')} in the vault root.`,
  });

  const inbox = options.inboxFolder ?? snapshot.folders.find((f) => parentFolder(f) === '' && folderRole(f) === 'inbox');
  const maxAge = (options.inboxMaxAgeDays ?? 14) * DAY;
  const stale = inbox
    ? snapshot.notes.filter((note) => isInFolder(note.path, inbox) && options.now - note.mtime > maxAge).length
    : 0;
  components.push({
    id: 'inbox-backlog',
    label: 'Inbox processed',
    value: penalty(stale, Math.max(10, n * 0.1)),
    weight: inbox ? 0.1 : 0,
    detail: inbox
      ? `${plural(stale, 'note')} in "${inbox}" ${verb(stale, 'is', 'are')} older than ${plural(options.inboxMaxAgeDays ?? 14, 'day')}.`
      : 'No inbox folder.',
  });

  components.push({
    id: 'unresolved-links',
    label: 'Working links',
    value: penalty(share(stats.notesWithUnresolvedLinks, n), 0.3),
    weight: n > 0 ? 0.15 : 0,
    detail: `${plural(stats.notesWithUnresolvedLinks, 'note')} ${verb(stats.notesWithUnresolvedLinks, 'contains', 'contain')} links to notes that don't exist.`,
  });

  const tagUses = stats.tags.usage.reduce((total, tag) => total + tag.count, 0);
  const variantUses = stats.tags.variantGroups.reduce(
    (total, group) => total + group.variants.slice(1).reduce((sum, v) => sum + v.count, 0),
    0,
  );
  components.push({
    id: 'tag-variants',
    label: 'Consistent tags',
    value: penalty(share(variantUses, tagUses), 0.2),
    weight: tagUses > 0 ? 0.1 : 0,
    detail: `${plural(stats.tags.variantGroups.length, 'tag')} ${verb(stats.tags.variantGroups.length, 'is', 'are')} spelled in more than one way.`,
  });

  components.push({
    id: 'property-coverage',
    label: 'Properties',
    value: Math.min(1, stats.frontmatterShare / 0.8),
    weight: n > 0 ? 0.1 : 0,
    detail: `${Math.round(stats.frontmatterShare * 100)} % of notes have properties.`,
  });

  components.push({
    id: 'empty-folders',
    label: 'No empty folders',
    value: penalty(share(stats.emptyFolders.length, stats.folderCount), 0.3),
    weight: stats.folderCount > 0 ? 0.1 : 0,
    detail: `${plural(stats.emptyFolders.length, 'folder')} ${verb(stats.emptyFolders.length, 'is', 'are')} empty.`,
  });

  const depthSpread = standardDeviation(snapshot.notes.map((note) => depth(note.path)));
  components.push({
    id: 'depth',
    label: 'Even depth',
    value: Math.min(penalty(depthSpread, 2), penalty(Math.max(0, stats.maxDepth - 4), 4)),
    weight: n > 0 ? 0.1 : 0,
    detail: `Notes are nested up to ${stats.maxDepth} folders deep (spread ${depthSpread.toFixed(1)}).`,
  });

  const totalWeight = components.reduce((total, c) => total + c.weight, 0);
  const weighted = components.reduce((total, c) => total + c.weight * c.value, 0);
  const score = totalWeight === 0 ? 100 : Math.round((100 * weighted) / totalWeight);
  for (const component of components) component.value = Math.round(component.value * 100) / 100;

  return { score, grade: score >= 75 ? 'good' : score >= 50 ? 'fair' : 'poor', components };
}

/** 1 at zero, falling linearly to 0 at `threshold`. */
function penalty(value: number, threshold: number): number {
  return threshold <= 0 ? 1 : Math.max(0, 1 - value / threshold);
}

function standardDeviation(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(values.reduce((total, v) => total + (v - mean) ** 2, 0) / values.length);
}
