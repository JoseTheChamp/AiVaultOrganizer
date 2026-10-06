import { describe, expect, it } from 'vitest';
import { InMemoryVault } from '../../src/core/testing/in-memory-vault';
import { pairKey, validateGroundTruth } from '../fixture/ground-truth';
import { DEFAULT_MESSIFY, messify } from './messify';
import { generatePersonaVault } from './persona-vault';
import { csStudent } from './personas/cs-student';
import { enDeveloper } from './personas/en-developer';

describe.each([enDeveloper, csStudent])('messify ($id)', (persona) => {
  const clean = generatePersonaVault(persona, { seed: 1, scale: 1, dailyNotes: 8 });
  const run = (seed = 5) => messify(clean, { fixture: 'test', language: persona.language }, { ...DEFAULT_MESSIFY, seed });
  const fixture = run();
  const paths = Object.keys(fixture.files);

  it('is deterministic for a seed', () => {
    expect(run()).toEqual(fixture);
    expect(run(6).files).not.toEqual(fixture.files);
  });

  it('keeps a consistent ground truth for every note', () => {
    expect(validateGroundTruth(fixture.truth, new Set(paths))).toEqual([]);
  });

  it('records exactly the links that resolve in the written files, and none of the held-out ones', async () => {
    const snapshot = await InMemoryVault.from(fixture.files).snapshot();
    const actual = new Set(snapshot.notes.flatMap((note) => note.outLinks.map((target) => pairKey(note.path, target))));
    expect(new Set(fixture.truth.trueLinks.map(([a, b]) => pairKey(a, b)))).toEqual(actual);
    for (const [a, b] of fixture.truth.heldOutLinks) expect(actual.has(pairKey(a, b))).toBe(false);
    const share = fixture.truth.heldOutLinks.length / (fixture.truth.heldOutLinks.length + fixture.truth.trueLinks.length);
    expect(share).toBeGreaterThan(0.15);
    expect(share).toBeLessThan(0.4);
  });

  it('adds stubs and paraphrased duplicates', () => {
    const notes = Object.entries(fixture.truth.notes);
    const stubs = notes.filter(([, truth]) => truth.isStub);
    expect(stubs.length).toBeGreaterThanOrEqual(1);
    for (const [path] of stubs) expect(fixture.files[path]?.length).toBeLessThan(80);
    const duplicates = notes.filter(([, truth]) => truth.duplicateOf !== undefined);
    expect(duplicates.length).toBeGreaterThanOrEqual(1);
    for (const [path, truth] of duplicates) {
      const original = fixture.files[truth.duplicateOf ?? ''] ?? '';
      const firstSentence = (fixture.files[path] ?? '').split(/(?<=\.)\s/)[0] ?? '';
      expect(original).toContain(firstSentence.trim());
    }
  });

  it('scatters most notes away from where they belong, keeping a few in place', () => {
    const atRoot = paths.filter((path) => !path.includes('/')).length;
    expect(atRoot / paths.length).toBeGreaterThan(0.25);
    const cleanPaths = new Set(clean.map((note) => note.path));
    const inPlace = paths.filter((path) => cleanPaths.has(path)).length;
    expect(inPlace).toBeGreaterThan(0);
    expect(inPlace / paths.length).toBeLessThan(0.35);
  });

  it('makes properties inconsistent and adds empty folders', () => {
    const contents = Object.values(fixture.files).join('\n');
    expect(contents).toMatch(/^(Type|kind): /m);
    expect(contents).toMatch(/^type: /m);
    expect(fixture.emptyFolders.length).toBeGreaterThan(0);
    for (const folder of fixture.emptyFolders) expect(paths.some((path) => path.startsWith(`${folder}/`))).toBe(false);
  });
});
