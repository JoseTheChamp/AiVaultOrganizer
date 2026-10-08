import { describe, expect, it } from 'vitest';
import { withFallback } from './fallback';
import { presetCharter } from './presets/index';
import type { Charter } from './schema';

const fallbackOf = (charter: Charter) => charter.destinations.filter((destination) => destination.fallback);

describe('withFallback', () => {
  it('adds an Other folder, in the language of the charter', () => {
    expect(fallbackOf(withFallback(presetCharter('para', 'en')))).toEqual([expect.objectContaining({ id: 'other', path: 'Other', description: expect.stringContaining('fit no other folder') as string })]);
    expect(fallbackOf(withFallback(presetCharter('topics', 'cs')))).toEqual([expect.objectContaining({ path: 'Ostatní' })]);
  });

  it('numbers it in Johnny.Decimal and lists it in the index', () => {
    const charter = withFallback(presetCharter('johnny-decimal', 'en'));
    expect(fallbackOf(charter)).toEqual([expect.objectContaining({ path: '90-99 Other/91 Other' })]);
    expect(charter.jd?.areas.at(-1)).toEqual({ id: '90-99', name: 'Other', categories: [{ id: '91', name: 'Other' }] });

    // An area 90-99 of the user's own keeps its name; Other takes the next free number.
    const jd = presetCharter('johnny-decimal', 'en');
    const own = withFallback({ ...jd, jd: { areas: [...(jd.jd?.areas ?? []), { id: '90-99', name: 'Archive', categories: [{ id: '91', name: 'Old' }] }] } });
    expect(fallbackOf(own)).toEqual([expect.objectContaining({ path: '90-99 Archive/92 Other' })]);
  });

  it('uses a category where notes live in the root', () => {
    const [other] = fallbackOf(withFallback(presetCharter('flat-categories', 'en')));
    expect(other).toMatchObject({ category: '[[Other]]' });
    expect(other?.path).toBeUndefined();
  });

  it('makes an Other folder the charter already has the fallback, and leaves a fallback as it is', () => {
    const para = presetCharter('para', 'en');
    const own = withFallback({ ...para, destinations: [...para.destinations, { id: 'misc', path: 'Other', description: 'Whatever.', layout: 'flat', priority: 0, match: [], examples: [] }] });
    expect(fallbackOf(own).map((destination) => destination.id)).toEqual(['misc']);
    expect(own.destinations).toHaveLength(para.destinations.length + 1);
    expect(withFallback(own)).toBe(own);
  });
});
