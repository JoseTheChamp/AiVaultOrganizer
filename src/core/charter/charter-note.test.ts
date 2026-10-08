import { describe, expect, it } from 'vitest';
import { sha256Hex } from '../hash';
import { findCharterBlock, replaceCharterBlock } from '../markdown/charter-block';
import { parseFrontmatter } from '../markdown/frontmatter';
import { listGeneratedSections } from '../markdown/generated-sections';
import { applyHarness } from '../testing/apply-harness';
import { charterPlan, parseCharterNote, renderCharterNote } from './charter-note';
import { presetCharter } from './presets/index';
import { renderSection } from './prose';

const now = new Date('2026-10-05T12:00:00Z');
const accept = <T extends { operations: { status: string }[] }>(plan: T): T => ({
  ...plan,
  operations: plan.operations.map((op) => ({ ...op, status: 'accepted' })),
});

describe('renderCharterNote', () => {
  it('writes frontmatter, generated sections, a user section and the rules block', () => {
    const charter = presetCharter('para', 'cs');
    const note = renderCharterNote(charter);
    expect(parseFrontmatter(note).data).toEqual({ charter: true, 'charter-version': 1 });
    expect(note).toContain('# Charta vaultu');
    expect(listGeneratedSections(note).map((s) => s.id)).toEqual(['overview', 'where-does-it-go', 'conventions']);
    expect(note).toContain('## Moje poznámky k systému');
    expect(parseCharterNote(note)).toEqual({ ok: true, value: { charter, yaml: findCharterBlock(note)?.yaml } });
  });

  it('explains where notes go, including rules and layouts', () => {
    const text = renderSection(presetCharter('para', 'en'), 'where-does-it-go');
    expect(text.split('\n')).toEqual([
      '## Where does a new note go?',
      '1. Unprocessed capture → `0 Inbox`',
      '2. Active projects with a clear goal and an end → `1 Projects/<item>` (automatically when `type: project`)',
      '3. Ongoing responsibilities that never end (health, finances, work) → `2 Areas/<item>` (automatically when `type: area`)',
      '4. Topics of interest and reference material that need no action → `3 Resources/<topic>` (automatically when `type: resource`)',
      '5. Inactive items from the other categories → `4 Archive` (automatically when `status: done | archived`)',
      '6. Daily notes (`YYYY-MM-DD`) → `Daily`',
    ]);
  });

  it('reports a missing or invalid rules block', () => {
    expect(parseCharterNote('# No rules')).toEqual({ ok: false, error: { kind: 'missing-block' } });
    const invalid = parseCharterNote('```charter\nversion: 2\n```\n');
    expect(!invalid.ok && invalid.error.kind).toBe('invalid');
  });

  it('replaces only the rules block', () => {
    const note = 'Before\n```charter\nold: 1\n```\nAfter';
    expect(replaceCharterBlock(note, 'new: 2')).toEqual({ ok: true, value: 'Before\n```charter\nnew: 2\n```\nAfter' });
    expect(replaceCharterBlock('none', 'x')).toEqual({ ok: false, error: 'missing' });
  });
});

describe('charterPlan', () => {
  it('creates the note when there is none', () => {
    const plan = charterPlan(presetCharter('ace', 'en'), 'Vault Charter.md', null, now);
    expect(plan.operations.map((op) => op.kind)).toEqual(['createNote']);
  });

  it('changes nothing when the charter is unchanged', async () => {
    const charter = presetCharter('para', 'en');
    const content = renderCharterNote(charter);
    const plan = charterPlan(charter, 'Vault Charter.md', { path: 'Vault Charter.md', content, contentHash: await sha256Hex(content) }, now);
    expect(plan.operations).toEqual([]);
  });

  it('updates rules and sections, bumps the revision and keeps the user\'s prose', async () => {
    const original = renderCharterNote(presetCharter('para', 'en')).replace(
      'Anything you write outside the generated sections is yours; the plugin never changes it.',
      'I file recipes under Resources. My own words.',
    );
    const { vault, executor } = applyHarness({ 'Vault Charter.md': original });
    const changed = { ...presetCharter('para', 'en'), inbox: 'Inbox' };
    const plan = charterPlan(changed, 'Vault Charter.md', { path: 'Vault Charter.md', content: original, contentHash: await sha256Hex(original) }, now);
    expect(plan.operations.map((op) => op.kind)).toEqual(['updateGeneratedSection', 'updateCharterRules', 'setProperty']);
    expect(plan.charterRevision).toBe(2);

    expect((await executor.apply(accept(plan))).status).toBe('completed');
    const updated = await vault.read('Vault Charter.md');
    expect(updated).toContain('I file recipes under Resources. My own words.');
    expect(updated).toContain('1. Unprocessed capture → `Inbox`');
    const parsed = parseCharterNote(updated);
    expect(parsed.ok && parsed.value.charter).toMatchObject({ revision: 2, inbox: 'Inbox' });
    expect(parseFrontmatter(updated).data['charter-version']).toBe(2);
  });

  it('keeps comments in hand-edited YAML when only the version needs syncing', async () => {
    const charter = presetCharter('para', 'en');
    const commented = renderCharterNote(charter).replace('preset: para', 'preset: para # my choice').replace('charter-version: 1', 'charter-version: 0');
    const plan = charterPlan(charter, 'C.md', { path: 'C.md', content: commented, contentHash: await sha256Hex(commented) }, now);
    expect(plan.operations.map((op) => op.kind)).toEqual(['setProperty']);
  });
});

describe('destination lines', () => {
  it('drop only a trailing period from descriptions', () => {
    const charter = { ...presetCharter('topics', 'en') };
    charter.destinations = [{ ...charter.destinations[0]!, description: 'No period here' }];
    expect(renderSection(charter, 'where-does-it-go')).toContain('No period here → `Notes/<topic>`');
  });

  it('say which folder takes what nothing else fits', () => {
    const charter = presetCharter('topics', 'en');
    charter.destinations = [...charter.destinations, { id: 'other', path: 'Other', fallback: true, description: 'Notes that fit no other folder.', layout: 'flat', priority: 0, match: [], examples: [] }];
    expect(renderSection(charter, 'where-does-it-go')).toContain('Notes that fit no other folder → `Other` (when nothing else fits)');
  });
});
