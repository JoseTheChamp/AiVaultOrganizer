import { describe, expect, it } from 'vitest';
import { InMemoryVault } from '../testing/in-memory-vault';
import { tinyCzechParaVault, tinyParaVault } from '../testing/fixtures';
import { computeGraphMetrics, connectedComponents } from './graph';
import { guessLanguage } from './language';
import { computeStats } from './stats';
import { computeTagStats, tagVariantKey } from './tags';

async function snapshotOf(files: Record<string, string>, folders: string[] = []) {
  return InMemoryVault.from(files, { folders }).snapshot();
}

describe('computeStats', () => {
  it('summarizes the tiny PARA vault', async () => {
    const { files, folders } = tinyParaVault();
    const stats = computeStats(await snapshotOf(files, folders));

    expect(stats.noteCount).toBe(13);
    expect(stats.attachmentCount).toBe(1);
    expect(stats.rootNoteCount).toBe(1);
    expect(stats.rootShare).toBeCloseTo(1 / 13);
    expect(stats.maxDepth).toBe(2);
    expect(stats.depthHistogram).toEqual([1, 5, 7]);
    expect(stats.emptyFolders).toEqual(['3 Resources/Empty topic']);
    expect(stats.datedNoteCount).toBe(1);
    expect(stats.topLevelFolders[0]).toEqual({ path: '2 Areas', noteCount: 3 });
    expect(stats.properties.find((p) => p.key === 'type')).toMatchObject({ count: 5 });
    expect(stats.language.language).toBe('en');
  });

  it('counts unresolved links and treats folders containing only empty folders as empty', async () => {
    const stats = computeStats(
      await snapshotOf({ 'a.md': '[[Missing]] [[Gone]]', 'b.md': '[[a]]' }, ['Outer/Inner', 'Kept']),
    );
    expect(stats.unresolvedLinkCount).toBe(2);
    expect(stats.notesWithUnresolvedLinks).toBe(1);
    expect(stats.emptyFolders).toEqual(['Kept', 'Outer', 'Outer/Inner']);
  });

  it('handles an empty vault', async () => {
    const stats = computeStats(await snapshotOf({}));
    expect(stats.noteCount).toBe(0);
    expect(stats.rootShare).toBe(0);
    expect(stats.medianWords).toBe(0);
    expect(stats.graph.largestComponentSize).toBe(0);
  });

  it('detects a Czech vault', async () => {
    const { files } = tinyCzechParaVault();
    expect(computeStats(await snapshotOf(files)).language.language).toBe('cs');
  });
});

describe('graph metrics', () => {
  it('finds orphans, dead ends, isolated notes and components', async () => {
    const snapshot = await snapshotOf({
      'a.md': '[[b]]',
      'b.md': '[[c]]',
      'c.md': '',
      'd.md': '',
      'e.md': '[[f]]',
      'f.md': '[[e]]',
    });
    const graph = computeGraphMetrics(snapshot.notes);
    expect(graph.edgeCount).toBe(4);
    expect(graph.orphans).toEqual(['a.md', 'd.md']);
    expect(graph.deadEnds).toEqual(['c.md', 'd.md']);
    expect(graph.isolated).toEqual(['d.md']);
    expect(graph.componentCount).toBe(3);
    expect(graph.largestComponentSize).toBe(3);
    expect(graph.hubs[0]?.path).toBe('b.md');
    expect(connectedComponents(snapshot.notes).map((c) => c.sort())).toContainEqual(['e.md', 'f.md']);
  });
});

describe('tags', () => {
  it('normalizes case, separators and diacritics per segment', () => {
    expect(tagVariantKey('ProjectManagement')).toBe('projectmanagement');
    expect(tagVariantKey('project-management')).toBe('projectmanagement');
    expect(tagVariantKey('Zdraví/Spánek')).toBe('zdravi/spanek');
  });

  it('groups variants and counts each tag once per note', async () => {
    const snapshot = await snapshotOf({
      'a.md': '#project-management #project-management #zdraví',
      'b.md': '#ProjectManagement #zdravi',
      'c.md': '#project_management #unique',
    });
    const tags = computeTagStats(snapshot.notes);
    expect(tags.uniqueTags).toBe(6);
    expect(tags.variantGroups.map((g) => g.key)).toEqual(['projectmanagement', 'zdravi']);
    expect(tags.variantGroups[0]?.variants.map((v) => v.count)).toEqual([1, 1, 1]);
  });
});

describe('guessLanguage', () => {
  it('returns zero confidence without evidence', () => {
    expect(guessLanguage(['1234', ''])).toEqual({ language: 'en', confidence: 0 });
  });

  it('separates Czech from English', () => {
    expect(guessLanguage(['Poznámky k projektu', 'Jak na to'])).toMatchObject({ language: 'cs' });
    expect(guessLanguage(['Notes on the project', 'How to review'])).toMatchObject({ language: 'en' });
  });
});
