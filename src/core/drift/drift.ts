import type { Charter } from '../charter/schema';
import { charterFingerprint } from '../charter/yaml';
import type { VaultSnapshot } from '../model/note';
import { plural } from '../model/text';
import { RuleEngine } from './rules';

export const DRIFT_KINDS = ['misplaced', 'missing-category', 'unplaced', 'stale-inbox', 'missing-property', 'invalid-value'] as const;
export type DriftKind = (typeof DRIFT_KINDS)[number];

export interface DriftIssue {
  path: string;
  kind: DriftKind;
  detail: string;
  /** Where the note belongs, when the rules know. */
  expected?: string;
}

export interface DriftReport {
  charterRevision: number;
  /** Identifies the charter's meaning; run state stores it to notice charter changes. */
  fingerprint: string;
  checkedAt: number;
  /** Notes the charter governs (ignored notes, templates and the charter itself excluded). */
  noteCount: number;
  /** Notes with at least one issue. */
  offCharter: number;
  issues: DriftIssue[];
  counts: Record<DriftKind, number>;
  /** Folders the charter defines that the vault does not have yet. */
  missingFolders: string[];
}

const DAY = 24 * 60 * 60 * 1000;

/**
 * Rule-based drift (tier 0, §2.2): how far the vault is from its charter right now. Cheap enough to
 * run on startup; no AI involved. Notes that only an AI could place are reported as unplaced.
 */
export function computeDrift(snapshot: VaultSnapshot, charter: Charter, options: { charterPath: string | null; now: number }): DriftReport {
  const engine = new RuleEngine(charter, options.charterPath);
  const issues: DriftIssue[] = [];
  const required = charter.conventions.properties?.required ?? [];
  const enums = charter.conventions.properties?.enums ?? {};
  const maxAge = charter.drift.inboxMaxAgeDays * DAY;
  let noteCount = 0;

  for (const note of snapshot.notes) {
    const placement = engine.evaluate(note);
    if (placement.status === 'ignored' || placement.status === 'charter') continue;
    if (placement.status === 'system' && placement.role === 'templates') continue;
    noteCount++;

    if ((placement.status === 'ruled' || placement.status === 'system') && !placement.expectation.inPlace) {
      const { expectation } = placement;
      if (expectation.path) {
        issues.push({ path: note.path, kind: 'misplaced', detail: `Rule "${placement.rule}" places it in "${expectation.folder ?? ''}".`, expected: expectation.path });
      } else if (expectation.category) {
        issues.push({ path: note.path, kind: 'missing-category', detail: `Rule "${placement.rule}" gives it the category ${expectation.category}.`, expected: expectation.category });
      }
    }
    if (placement.status === 'unplaced') {
      issues.push({ path: note.path, kind: 'unplaced', detail: 'Outside every destination of the charter.' });
    }
    if (placement.status === 'inbox' && options.now - note.mtime > maxAge) {
      const days = Math.floor((options.now - note.mtime) / DAY);
      issues.push({ path: note.path, kind: 'stale-inbox', detail: `In the inbox for ${plural(days, 'day')}.` });
    }

    if (placement.status !== 'system') {
      const missing = required.filter((key) => !hasValue(note.frontmatter[key]));
      if (missing.length > 0) {
        issues.push({ path: note.path, kind: 'missing-property', detail: `Missing ${missing.map((k) => `"${k}"`).join(', ')}.` });
      }
      for (const [key, allowed] of Object.entries(enums)) {
        const values = asList(note.frontmatter[key]);
        const invalid = values.filter((value) => !allowed.some((a) => String(a).toLowerCase() === value.toLowerCase()));
        if (invalid.length > 0) {
          issues.push({ path: note.path, kind: 'invalid-value', detail: `"${key}: ${invalid.join(', ')}" is not one of ${allowed.join(', ')}.` });
        }
      }
    }
  }

  const folders = new Set(snapshot.folders);
  const missingFolders = [
    ...charter.destinations.map((d) => d.path),
    charter.inbox,
    charter.system.daily?.path,
  ].filter((path): path is string => path !== undefined && !folders.has(path));

  const counts = Object.fromEntries(DRIFT_KINDS.map((kind) => [kind, issues.filter((i) => i.kind === kind).length])) as Record<DriftKind, number>;
  return {
    charterRevision: charter.revision,
    fingerprint: charterFingerprint(charter),
    checkedAt: options.now,
    noteCount,
    offCharter: new Set(issues.map((issue) => issue.path)).size,
    issues,
    counts,
    missingFolders,
  };
}

const KIND_TEXT: Record<DriftKind, string> = {
  misplaced: 'in the wrong folder',
  'missing-category': 'without their category',
  unplaced: 'outside every destination',
  'stale-inbox': 'waiting in the inbox too long',
  'missing-property': 'missing required properties',
  'invalid-value': 'with values the charter does not allow',
};

export const DRIFT_KIND_LABELS: Record<DriftKind, string> = {
  misplaced: 'In the wrong folder',
  'missing-category': 'Missing category',
  unplaced: 'Outside every destination',
  'stale-inbox': 'Too long in the inbox',
  'missing-property': 'Missing properties',
  'invalid-value': 'Values not allowed',
};

/** One sentence for notices and the status bar. */
export function describeDrift(report: DriftReport): string {
  if (report.offCharter === 0) return `All ${plural(report.noteCount, 'note')} follow the charter.`;
  const parts = DRIFT_KINDS.filter((kind) => report.counts[kind] > 0).map((kind) => `${report.counts[kind]} ${KIND_TEXT[kind]}`);
  return `${plural(report.offCharter, 'note')} ${report.offCharter === 1 ? 'is' : 'are'} off-charter: ${parts.join(', ')}.`;
}

function hasValue(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim() !== '';
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function asList(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  const values: unknown[] = Array.isArray(value) ? value : [value];
  return values.filter((v) => typeof v === 'string' || typeof v === 'number').map(String);
}
