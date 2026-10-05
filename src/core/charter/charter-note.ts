import { findCharterBlock } from '../markdown/charter-block';
import { listGeneratedSections, wrapGeneratedSection } from '../markdown/generated-sections';
import { parseFrontmatter } from '../markdown/frontmatter';
import { createOperation, type Operation } from '../model/operation';
import { createPlan, type Plan, type PlanWarning } from '../model/plan';
import { err, ok, type Result } from '../model/result';
import { charterText, renderSection, SECTION_IDS } from './prose';
import type { Charter } from './schema';
import { type CharterIssue, charterFingerprint, parseCharterYaml, setCharterRevision, stringifyCharter } from './yaml';

export type CharterNoteError = { kind: 'missing-block' } | { kind: 'invalid'; issues: CharterIssue[] };

export interface ParsedCharterNote {
  charter: Charter;
  yaml: string;
}

/** Reads the charter from its note. The YAML block is authoritative; prose is ignored. */
export function parseCharterNote(content: string): Result<ParsedCharterNote, CharterNoteError> {
  const block = findCharterBlock(content);
  if (!block) return err({ kind: 'missing-block' });
  const parsed = parseCharterYaml(block.yaml);
  return parsed.ok ? ok({ charter: parsed.value, yaml: block.yaml }) : err({ kind: 'invalid', issues: parsed.error });
}

/** A complete charter note for a vault that has none yet (PLAN §3.1). */
export function renderCharterNote(charter: Charter): string {
  const t = charterText(charter);
  const sections = SECTION_IDS.map((id) => wrapGeneratedSection(id, renderSection(charter, id)));
  return [
    '---',
    'charter: true',
    `charter-version: ${charter.revision}`,
    '---',
    t.title,
    '',
    ...sections.flatMap((section) => [section, '']),
    t.userHeading,
    '',
    t.userText,
    '',
    t.rulesHeading,
    '',
    t.rulesText,
    '',
    '```charter',
    stringifyCharter(charter).trimEnd(),
    '```',
    '',
  ].join('\n');
}

export interface ExistingCharterNote {
  path: string;
  content: string;
  contentHash: string;
}

/**
 * The plan that writes `charter` to the vault. For a new charter: one createNote. For an existing
 * note: only what changed — generated sections whose text differs, the rules block, and the
 * `charter-version` property — so user prose outside the markers is never touched. The revision is
 * bumped when the charter's meaning changed; if only the revision differs from the user's YAML, the
 * user's YAML is kept with its comments and just the revision updated.
 */
export function charterPlan(charter: Charter, path: string, existing: ExistingCharterNote | null, now: Date): Plan {
  const meta = { source: 'user' as const, confidence: 1, status: 'pending' as const };
  const id = `charter-${now.toISOString().replace(/[-:.]/g, '').slice(0, 15)}`;
  if (!existing) {
    return createPlan({
      id,
      createdAt: now.toISOString(),
      charterRevision: charter.revision,
      operations: [createOperation({ kind: 'createNote', path, role: 'charter', content: renderCharterNote(charter) }, { ...meta, rationale: 'Create the vault charter.' })],
    });
  }

  const operations: Operation[] = [];
  const warnings: PlanWarning[] = [];
  const precondition = { path: existing.path, contentHash: existing.contentHash };
  const current = parseCharterNote(existing.content);
  const previous = current.ok ? current.value : null;

  const changed = previous === null || charterFingerprint(previous.charter) !== charterFingerprint(charter);
  const revision = previous ? (changed ? previous.charter.revision + 1 : previous.charter.revision) : charter.revision;
  const next: Charter = { ...charter, revision };

  const sections = new Map(listGeneratedSections(existing.content).map((section) => [section.id, section.inner.trim()]));
  for (const sectionId of SECTION_IDS) {
    const text = renderSection(next, sectionId);
    if (!sections.has(sectionId)) {
      warnings.push({ code: 'section-missing', message: `The charter has no "${sectionId}" section; it was left out.`, opIds: [] });
    } else if (sections.get(sectionId) !== text.trim()) {
      operations.push(
        createOperation(
          { kind: 'updateGeneratedSection', path: existing.path, sectionId, content: text },
          { ...meta, precondition, rationale: `Regenerate the "${sectionId}" section from the rules.` },
        ),
      );
    }
  }

  const yaml = previous && !changed ? setCharterRevision(previous.yaml, revision) : stringifyCharter(next);
  if (!previous || yaml.trim() !== previous.yaml.trim()) {
    operations.push(
      createOperation(
        { kind: 'updateCharterRules', path: existing.path, yaml },
        { ...meta, precondition, rationale: changed ? `Save the new rules as revision ${revision}.` : 'Update the rules block.' },
      ),
    );
  }

  const version = parseFrontmatter(existing.content).data['charter-version'];
  if (version !== revision) {
    operations.push(
      createOperation(
        { kind: 'setProperty', path: existing.path, key: 'charter-version', value: revision },
        { ...meta, precondition, rationale: 'Keep charter-version in sync with the rules.' },
      ),
    );
  }
  return createPlan({ id, createdAt: now.toISOString(), charterRevision: revision, operations, warnings });
}
