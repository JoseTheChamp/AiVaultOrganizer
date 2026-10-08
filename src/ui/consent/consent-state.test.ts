import { describe, expect, it } from 'vitest';
import type { StageEstimate } from '../../core/planner/llm-stage';
import { type ConsentInput, consentState, minutes, range } from './consent-state';

const estimate: StageEstimate = {
  notes: 40,
  withheld: 2,
  calls: { min: 5, max: 12 },
  inputTokens: { min: 20_000, max: 45_000 },
  outputTokens: { min: 4_000, max: 9_000 },
};

const input = (overrides: Partial<ConsentInput> = {}): ConsentInput => ({
  purpose: 'place the notes that rules and similar notes could not',
  estimate,
  model: 'qwen3:8b',
  baseUrl: 'http://localhost:11434/v1',
  localOnly: true,
  prices: {},
  budgetTokens: 300_000,
  ...overrides,
});

describe('consentState', () => {
  it('describes a local run: nothing leaves the computer, no cost without prices', () => {
    expect(consentState(input())).toEqual({
      purpose: 'place the notes that rules and similar notes could not',
      model: 'qwen3:8b',
      where: 'this computer',
      local: true,
      unavailable: null,
      notes: 40,
      withheld: 2,
      calls: { min: 5, max: 12 },
      tokens: { min: 24_000, max: 54_000 },
      cost: null,
      overBudget: false,
      duration: null,
    });
  });

  it("says how long the run may take at the last run's pace, a second opinion included", () => {
    // 40 notes at 3 s each, up to twice that with second opinions.
    expect(consentState(input({ msPerNote: 3000 })).duration).toEqual({ min: 120_000, max: 240_000 });
    expect(minutes({ min: 120_000, max: 240_000 })).toBe('2–4 min');
    expect(minutes({ min: 10_000, max: 50_000 })).toBe('about a minute');
    expect(minutes({ min: 290_000, max: 310_000 })).toBe('about 5 min');
  });

  it('names the host of a cloud model, prices the run and blocks it in local-only mode', () => {
    const cloud = consentState(input({ baseUrl: 'https://api.openai.com/v1', prices: { inputPerMillion: 0.5, outputPerMillion: 1.5 } }));
    expect(cloud).toMatchObject({ where: 'api.openai.com', local: false, unavailable: 'Local-only mode is on, so api.openai.com cannot be reached. Turn it off in Set up AI.' });
    expect(cloud.cost?.min).toBeCloseTo(0.016, 6);
    expect(cloud.cost?.max).toBeCloseTo(0.036, 6);
    expect(consentState(input({ baseUrl: 'https://api.openai.com/v1', localOnly: false })).unavailable).toBeNull();
  });

  it('passes on why a model that does not answer cannot be used', () => {
    expect(consentState(input({ unavailable: 'The model does not answer.' })).unavailable).toBe('The model does not answer.');
  });

  it('warns when the run may exceed the token budget', () => {
    expect(consentState(input({ budgetTokens: 50_000 })).overBudget).toBe(true);
  });

  it('formats ranges, collapsing equal ends', () => {
    expect(range({ min: 1200, max: 3400 })).toBe('1,200–3,400');
    expect(range({ min: 2, max: 2 })).toBe('2');
  });
});
