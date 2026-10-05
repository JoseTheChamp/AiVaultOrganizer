import { describe, expect, it } from 'vitest';
import type { MethodId } from '../model/methods';
import {
  tinyAceVault,
  tinyCzechParaVault,
  tinyFlatVault,
  tinyJohnnyDecimalVault,
  tinyParaVault,
  tinyTopicVault,
  tinyZettelkastenVault,
} from '../testing/fixtures';
import { InMemoryVault } from '../testing/in-memory-vault';
import { describeDetection, detectMethods } from './method-detect';
import { computeStats } from './stats';
import { folderRole, normalizeFolderLabel } from './vocabulary';

async function detect(fixture: { files: Record<string, string>; folders: string[] }) {
  const snapshot = await InMemoryVault.from(fixture.files, { folders: fixture.folders }).snapshot();
  return detectMethods(snapshot, computeStats(snapshot));
}

describe('detectMethods', () => {
  it.each<[string, () => { files: Record<string, string>; folders: string[] }, MethodId]>([
    ['PARA', tinyParaVault, 'para'],
    ['Czech PARA', tinyCzechParaVault, 'para'],
    ['Johnny.Decimal', tinyJohnnyDecimalVault, 'johnny-decimal'],
    ['ACE', tinyAceVault, 'ace'],
    ['Zettelkasten', tinyZettelkastenVault, 'zettelkasten'],
    ['Flat + categories', tinyFlatVault, 'flat-categories'],
    ['Topic folders', tinyTopicVault, 'topics'],
  ])('recognizes %s', async (_name, fixture, expected) => {
    const detection = await detect(fixture());
    expect(detection.dominant).toBe(expected);
    expect(detection.scores[0]?.method).toBe(expected);
    expect(detection.scores[0]?.reasons.length).toBeGreaterThan(0);
  });

  it('returns every method sorted by score', async () => {
    const detection = await detect(tinyParaVault());
    expect(detection.scores).toHaveLength(6);
    const values = detection.scores.map((s) => s.score);
    expect([...values].sort((a, b) => b - a)).toEqual(values);
  });

  it('reports none for an unstructured vault', async () => {
    const detection = await detect({ files: { 'a.md': 'x', 'b.md': 'y' }, folders: [] });
    expect(detection.dominant).toBe('none');
    expect(describeDetection(detection)).toBe('No clear organization method detected yet.');
  });

  it('reports a mix when two methods compete', async () => {
    const para = tinyParaVault();
    const ace = tinyAceVault();
    const detection = await detect({ files: { ...para.files, ...ace.files }, folders: [] });
    expect(detection.dominant).toBe('mixed');
    expect(describeDetection(detection)).toMatch(/A mix of (PARA|ACE) and (PARA|ACE)\./);
  });
});

describe('folder vocabulary', () => {
  it.each([
    ['1 Projects', 'projects'],
    ['01 - Projects', 'projects'],
    ['2. Oblasti', 'oblasti'],
    ['📥 Inbox', 'inbox'],
    ['Šablony', 'sablony'],
    ['Daily_notes', 'daily notes'],
  ])('normalizes %s to %s', (input, expected) => {
    expect(normalizeFolderLabel(input)).toBe(expected);
  });

  it('maps names to roles in English and Czech', () => {
    expect(folderRole('3 Zdroje')).toBe('resources');
    expect(folderRole('Přílohy')).toBe('attachments');
    expect(folderRole('Deník')).toBe('daily');
    expect(folderRole('Cooking')).toBeNull();
  });
});
