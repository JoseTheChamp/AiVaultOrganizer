import { describe, expect, it } from 'vitest';
import { InMemoryVault } from '../testing/in-memory-vault';
import type { Clustering } from './clusters';
import { DEFAULT_CANDIDATES, linkCandidates } from './link-candidates';

async function notes(files: Record<string, string>) {
  return (await InMemoryVault.from(files).snapshot()).notes;
}

/** Similarity by shared subject prefix of the file name: garden-* notes are alike, and so on. */
const bySubject = (a: string, b: string): number => (a.split('-')[0] === b.split('-')[0] ? 0.8 : 0.1);

describe('linkCandidates', () => {
  it('suggests similar notes that are not linked yet, best first', async () => {
    const vault = await notes({
      'garden-tomatoes.md': 'Tomatoes. See [[garden-compost]].',
      'garden-compost.md': 'Compost.',
      'garden-beds.md': 'Raised beds.',
      'running-plan.md': 'Plan.',
      '2026-01-05.md': 'Worked on [[garden-beds]].',
    });
    const result = linkCandidates({ notes: vault, similarity: bySubject }, { ...DEFAULT_CANDIDATES, floor: 0.5 });
    expect(result.get('garden-tomatoes.md')?.map((c) => c.target)).toEqual(['garden-beds.md']);
    expect(result.get('garden-beds.md')?.map((c) => c.target)).toEqual(['garden-compost.md', 'garden-tomatoes.md']);
    expect(result.get('running-plan.md')).toEqual([]);
    // Daily notes neither get nor become suggestions.
    expect(result.has('2026-01-05.md')).toBe(false);
  });

  it('ranks shared tags and shared neighbours above similarity alone', async () => {
    const vault = await notes({
      'garden-a.md': '---\ntags: [veg]\n---\nA links [[hub]].',
      'garden-b.md': '---\ntags: [veg]\n---\nB links [[hub]].',
      'garden-c.md': 'C.',
      'hub.md': 'Hub.',
    });
    const [first, second] = linkCandidates({ notes: vault, similarity: (a, b) => (a === 'hub.md' || b === 'hub.md' ? 0 : bySubject(a, b)) }).get('garden-a.md') ?? [];
    expect(first).toMatchObject({ target: 'garden-b.md', sharedTags: 1 });
    expect(first?.sharedNeighbors).toBeCloseTo(1 / Math.log(2), 10);
    expect(first?.score).toBeGreaterThan(second?.score ?? 0);
    expect(second).toMatchObject({ target: 'garden-c.md', sharedTags: 0, sharedNeighbors: 0 });
  });

  it('respects exclusions and k', async () => {
    const vault = await notes({ 'garden-1.md': '1', 'garden-2.md': '2', 'garden-3.md': '3', 'garden-4.md': '4' });
    const result = linkCandidates(
      { notes: vault, similarity: bySubject, exclude: (source, target) => source === 'garden-1.md' && target === 'garden-2.md' },
      { ...DEFAULT_CANDIDATES, k: 1 },
    );
    expect(result.get('garden-1.md')?.map((c) => c.target)).toEqual(['garden-3.md']);
  });

  it('searches only the own and nearest clusters when given a clustering', async () => {
    const vault = await notes({ 'a.md': 'a', 'b.md': 'b', 'c.md': 'c', 'd.md': 'd', 'e.md': 'e', 'f.md': 'f' });
    // Three clusters on a line: {a,b} at 0, {c,d} at 1, {e,f} at 5; probe 1 reaches the nearest only.
    const paths = ['a.md', 'b.md', 'c.md', 'd.md', 'e.md', 'f.md'];
    const clustering: Clustering = {
      clusters: [
        { id: 0, members: ['a.md', 'b.md'] },
        { id: 1, members: ['c.md', 'd.md'] },
        { id: 2, members: ['e.md', 'f.md'] },
      ],
      assignments: new Map(paths.map((path, i) => [path, Math.floor(i / 2)])),
      points: { data: Float64Array.from([0, 0, 1, 1, 5, 5]), count: 6, dims: 1 },
      paths,
      centroids: Float64Array.from([0, 1, 5]),
      silhouette: 1,
    };
    const result = linkCandidates({ notes: vault, similarity: () => 0.9, clustering }, { ...DEFAULT_CANDIDATES, probe: 1 });
    expect(result.get('a.md')?.map((c) => c.target).sort()).toEqual(['b.md', 'c.md', 'd.md']);
    expect(result.get('e.md')?.map((c) => c.target).sort()).toEqual(['c.md', 'd.md', 'f.md']);
  });
});
