import { describe, expect, it } from 'vitest';
import { clock, Pace, progressText, remainingText } from './activity';

describe('activity text', () => {
  it('counts what can be counted', () => {
    expect(progressText({ detail: 'qwen3:8b is placing notes', done: 30, total: 74 })).toBe('qwen3:8b is placing notes, 30 of 74');
    expect(progressText({ detail: 'reading the vault' })).toBe('reading the vault');
  });

  it('shows a clock, with hours only when needed', () => {
    expect(clock(0)).toBe('0:00');
    expect(clock(102_400)).toBe('1:42');
    expect(clock(3_725_000)).toBe('1:02:05');
  });

  it('rounds the time left coarsely', () => {
    expect(remainingText(20_000)).toBe('less than a minute to go');
    expect(remainingText(70_000)).toBe('about a minute to go');
    expect(remainingText(200_000)).toBe('about 3 min to go');
  });
});

describe('Pace', () => {
  it('knows nothing until the step has moved, then extrapolates its pace', () => {
    const pace = new Pace();
    expect(pace.remaining('placing', 0, 40, 0)).toBeUndefined();
    // 10 notes in 60 s: the other 30 take about 180 s.
    expect(pace.remaining('placing', 10, 40, 60_000)).toBe(180_000);
    expect(pace.remaining('placing', 20, 40, 100_000)).toBe(100_000);
  });

  it('leaves cached answers out of the pace', () => {
    const pace = new Pace();
    pace.remaining('placing', 0, 40, 0);
    // Three requests answered from the cache at once would otherwise promise an end in seconds.
    expect(pace.remaining('placing', 10, 40, 100)).toBeUndefined();
    expect(pace.remaining('placing', 20, 40, 200)).toBeUndefined();
    expect(pace.remaining('placing', 30, 40, 60_200)).toBe(60_000);
  });

  it('starts over when the step changes', () => {
    const pace = new Pace();
    pace.remaining('placing', 0, 40, 0);
    pace.remaining('placing', 10, 40, 60_000);
    expect(pace.remaining('double-checking', 0, 12, 61_000)).toBeUndefined();
    expect(pace.remaining('double-checking', 6, 12, 91_000)).toBe(30_000);
  });

  it('has nothing left to guess at the end of a step', () => {
    const pace = new Pace();
    pace.remaining('placing', 0, 10, 0);
    expect(pace.remaining('placing', 10, 10, 60_000)).toBeUndefined();
  });
});
