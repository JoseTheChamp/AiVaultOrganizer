import { describe, expect, it } from 'vitest';
import { charterSchema } from '../schema';
import { parseCharterYaml, stringifyCharter } from '../yaml';
import { ace } from './ace';
import { johnnyDecimal } from './johnny-decimal';
import { para } from './para';
import type { Lang, Preset } from './types';

const presets: Preset[] = [para, johnnyDecimal, ace];

describe.each(presets)('preset $id', (preset) => {
  it.each<Lang>(['en', 'cs'])('builds a valid %s charter that survives YAML', (lang) => {
    const charter = charterSchema.parse(preset.build(lang));
    expect(charter.preset).toBe(preset.id);
    expect(charter.language).toBe(lang);
    const reparsed = parseCharterYaml(stringifyCharter(charter));
    expect(reparsed).toEqual({ ok: true, value: charter });
  });

  it('has prose in both languages and classifier guidance', () => {
    expect(preset.summary.en).toContain(`**${preset.label}**`);
    expect(preset.summary.cs.length).toBeGreaterThan(50);
    expect(preset.guidance.length).toBeGreaterThan(50);
  });
});

describe('PARA', () => {
  it('matches the Czech folder names of the plan example and lets archive win', () => {
    const charter = charterSchema.parse(para.build('cs'));
    expect(charter.inbox).toBe('0 Inbox');
    expect(charter.destinations.map((d) => d.path)).toEqual(['1 Projekty', '2 Oblasti', '3 Zdroje', '4 Archiv']);
    expect(charter.system).toEqual({ attachments: 'Přílohy', templates: 'Šablony', daily: { path: 'Deník', filename: 'YYYY-MM-DD' } });
    expect(charter.destinations.find((d) => d.id === 'archive')?.priority).toBeGreaterThan(0);
  });
});

describe('Johnny.Decimal', () => {
  it('derives one destination per category from the index', () => {
    const charter = charterSchema.parse(johnnyDecimal.build('en'));
    expect(charter.destinations.find((d) => d.id === 'jd-11')).toMatchObject({
      path: '10-19 Life admin/11 Finance',
      match: [{ filename: '^11\\.\\d{2}(?:\\s|$)' }],
    });
    expect(charter.jd?.areas.map((a) => a.id)).toEqual(['00-09', '10-19', '20-29', '30-39']);
    expect(new RegExp('^11\\.\\d{2}(?:\\s|$)').test('11.02 Accounts')).toBe(true);
  });
});
