import { describe, expect, it } from 'vitest';
import { analyzeVault } from '../analysis/analyze';
import {
  tinyAceVault,
  tinyCzechParaVault,
  tinyFlatVault,
  tinyJohnnyDecimalVault,
  tinyParaVault,
  tinyTopicVault,
} from '../testing/fixtures';
import { InMemoryVault } from '../testing/in-memory-vault';
import { adaptPresetToVault, inferCharter, slug } from './infer';
import { presetCharter } from './presets/index';

async function load(fixture: { files: Record<string, string>; folders: string[] }) {
  const snapshot = await InMemoryVault.from(fixture.files, { folders: fixture.folders }).snapshot();
  return { snapshot, analysis: analyzeVault(snapshot, { now: 0 }) };
}

describe('adaptPresetToVault', () => {
  it('reuses the vault\'s own folders for the same roles', async () => {
    const { snapshot } = await load({
      files: { 'Projects/a.md': '', 'Areas/b.md': '', 'Resources/c.md': '', 'Templates/t.md': '', 'Journal/2026-10-01.md': '' },
      folders: [],
    });
    const charter = adaptPresetToVault(presetCharter('para', 'en'), snapshot);
    // The vault's PARA folders are unnumbered, so the missing archive is too.
    expect(charter.destinations.map((d) => d.path)).toEqual(['Projects', 'Areas', 'Resources', 'Archive']);
    expect(charter.inbox).toBe('Inbox');
    expect(charter.system).toMatchObject({ templates: 'Templates', daily: { path: 'Journal' } });
    expect(charter.ignore).toContain('Templates/**');
  });

  it('keeps the preset numbering when the vault numbers its folders', async () => {
    const { snapshot } = await load({ files: { '1 Projects/a.md': '', '2 Areas/b.md': '' }, folders: [] });
    const charter = adaptPresetToVault(presetCharter('para', 'en'), snapshot);
    expect(charter.destinations.map((d) => d.path)).toEqual(['1 Projects', '2 Areas', '3 Resources', '4 Archive']);
  });

  it('maps nested preset folders under their mapped parent', async () => {
    const { snapshot } = await load({ files: { 'Atlas/Maps/m.md': '', 'Efforts/Sleeping/x.md': '' }, folders: [] });
    const charter = adaptPresetToVault(presetCharter('ace', 'en'), snapshot);
    expect(charter.destinations.find((d) => d.id === 'atlas-maps')?.path).toBe('Atlas/Maps');
  });
});

describe('inferCharter', () => {
  it('codifies a PARA vault with its own folder names and system folders', async () => {
    const { snapshot, analysis } = await load(tinyParaVault());
    const charter = inferCharter(snapshot, analysis);
    expect(charter.preset).toBe('para');
    expect(charter.inbox).toBe('0 Inbox');
    expect(charter.destinations.map((d) => [d.id, d.path])).toEqual([
      ['projects', '1 Projects'],
      ['areas', '2 Areas'],
      ['resources', '3 Resources'],
      ['archive', '4 Archive'],
    ]);
    expect(charter.system).toEqual({ attachments: 'Attachments', templates: 'Templates', daily: { path: 'Daily', filename: 'YYYY-MM-DD' } });
    expect(charter.ignore).toEqual(['Templates/**', '**/*.excalidraw.md']);
  });

  it('codifies a Czech PARA vault in Czech', async () => {
    const { snapshot, analysis } = await load(tinyCzechParaVault());
    const charter = inferCharter(snapshot, analysis);
    expect(charter.language).toBe('cs');
    expect(charter.destinations.map((d) => d.path)).toEqual(['1 Projekty', '2 Oblasti', '3 Zdroje', '4 Archiv']);
    expect(charter.system.templates).toBe('Šablony');
  });

  it('turns topic folders into destinations with examples and layouts', async () => {
    const { snapshot, analysis } = await load(tinyTopicVault());
    const charter = inferCharter(snapshot, analysis);
    expect(charter.preset).toBe('topics');
    expect(charter.destinations.map((d) => [d.id, d.path, d.layout])).toEqual([
      ['programming', 'Programming', 'subfolder-per-topic'],
      ['cooking', 'Cooking', 'subfolder-per-topic'],
      ['notes', 'Notes', 'flat'],
      ['travel', 'Travel', 'flat'],
      ['health', 'Health', 'flat'],
    ]);
    expect(charter.destinations[0]?.description).toBe('Notes about Programming (for example Rust, TypeScript).');
    expect(charter.destinations[0]?.examples.length).toBeGreaterThan(0);
  });

  it('derives the Johnny.Decimal index from the vault', async () => {
    const { snapshot, analysis } = await load(tinyJohnnyDecimalVault());
    const charter = inferCharter(snapshot, analysis);
    expect(charter.preset).toBe('johnny-decimal');
    expect(charter.jd?.areas.map((a) => [a.id, a.name, a.categories.map((c) => c.id)])).toEqual([
      ['00-09', 'System', ['00']],
      ['10-19', 'Finance', ['11', '12']],
      ['20-29', 'Home', ['21', '22']],
    ]);
    expect(charter.destinations.find((d) => d.id === 'jd-12')?.path).toBe('10-19 Finance/12 Taxes');
  });

  it('keeps ACE folders and falls back to the flat preset when nothing is foldered', async () => {
    const ace = await load(tinyAceVault());
    expect(inferCharter(ace.snapshot, ace.analysis).destinations.map((d) => d.path)).toContain('Atlas/Notes');
    const flat = await load({ files: { 'a.md': '', 'b.md': '' }, folders: [] });
    expect(inferCharter(flat.snapshot, flat.analysis).preset).toBe('flat-categories');
  });

  it('describes a flat vault with categories', async () => {
    const { snapshot, analysis } = await load(tinyFlatVault());
    const charter = inferCharter(snapshot, analysis);
    expect(charter.preset).toBe('flat-categories');
    expect(charter.mode).toBe('properties');
  });
});

describe('slug', () => {
  it('makes ids from folder names', () => {
    expect(slug('1 Projekty')).toBe('1-projekty');
    expect(slug('Zdraví & spánek')).toBe('zdravi-spanek');
    expect(slug('📥')).toBe('d-folder');
  });
});
