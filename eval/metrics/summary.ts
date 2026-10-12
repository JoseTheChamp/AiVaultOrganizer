import { type PlanSummaryInput, planFactLines } from '../../src/core/ai/prompts/plan-summary.v2';

const NUMBER = /\d+(?:[.,]\d+)?/g;
/** Totals are tried over at most this many numbers (2^n subsets). */
const MAX_SUMMED = 12;

export function numbersIn(text: string): number[] {
  return (text.match(NUMBER) ?? []).map((number) => Number(number.replace(',', '.')));
}

/** The numbers and every total of some of them: "47 other changes" may sum several counts. */
export function withTotals(numbers: readonly number[]): Set<number> {
  const result = new Set(numbers);
  const summed = numbers.slice(0, MAX_SUMMED);
  for (let mask = 1; mask < 1 << summed.length; mask++) {
    result.add(summed.reduce((sum, number, i) => (mask & (1 << i) ? sum + number : sum), 0));
  }
  return result;
}

/** Every number written in the facts the model saw, plus totals of any of the operation counts. */
export function supportedNumbers(facts: PlanSummaryInput): Set<number> {
  const counts = facts.counts.map((count) => Number(/(\d+)\s*$/.exec(count)?.[1])).filter(Number.isFinite);
  const written = numbersIn(planFactLines(facts).join('\n'));
  return new Set([...withTotals(counts), ...written]);
}

/**
 * Numbers in the summary and highlights that the facts do not contain: the one kind of unfaithfulness
 * code can catch without a model. Words ("two notes") are not checked.
 */
export function unsupportedNumbers(texts: readonly string[], facts: PlanSummaryInput): string[] {
  const supported = supportedNumbers(facts);
  return texts.flatMap((text) => text.match(NUMBER) ?? []).filter((number) => !supported.has(Number(number.replace(',', '.'))));
}

/**
 * Whether the summary points the reader somewhere: names a note or folder from the plan's examples
 * (the least certain changes come first there), not only counts. The charter's top-level folders do
 * not count, since every plan fills them.
 */
export function namesParticulars(texts: readonly string[], facts: PlanSummaryInput): boolean {
  const tops = new Set(facts.destinations.map((destination) => destination.slice(0, destination.lastIndexOf(':')).toLowerCase()));
  const names = new Set<string>();
  for (const example of facts.examples) {
    for (const [, quoted] of example.matchAll(/"([^"]+)"/g)) {
      for (const segment of (quoted ?? '').split('/')) {
        const name = segment.replace(/\.md$/i, '').toLowerCase();
        if (name.length >= 3 && !tops.has(name)) names.add(name);
      }
    }
  }
  const text = texts.join('\n').toLowerCase();
  return [...names].some((name) => text.includes(name));
}
