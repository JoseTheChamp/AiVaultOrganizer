import { type PlanSummaryInput, planFactLines } from '../../src/core/ai/prompts/plan-summary.v2';
import { type SummaryJudgeInput, type SummaryJudgeOutput, summaryJudgeV1 } from '../../src/core/ai/prompts/summary-judge.v1';
import { runPrompt } from '../../src/core/ai/prompts/types';
import type { ChatProvider } from '../../src/core/ai/types';
import type { PlanSummary } from '../../src/core/planner/summary';
import { ratio } from '../metrics/classification';
import { namesParticulars, numbersIn, supportedNumbers, unsupportedNumbers, withTotals } from '../metrics/summary';

export interface Verdict {
  /** Statements that say something about the plan; advice to the owner is left out. */
  claims: number;
  /** Share of them backed by a quote that is in the facts and holds the statement's numbers. */
  supported: number;
  /** Every claim supported. */
  faithful: boolean;
  unsupported: string[];
  /** Statements the model approved with a quote that is not in the facts or lacks their numbers: overruled. */
  overruled: number;
  /** Statements the model read as advice to the owner. */
  advice: number;
}

export type PlantedError = 'number' | 'claim';

export interface SummaryQuality {
  source: PlanSummary['source'];
  /** Numbers in the summary and highlights that the facts do not contain: checked by code, no model. */
  unsupportedNumbers: string[];
  /** Names a particular note or folder from the plan, not only counts: checked by code. */
  specific: boolean;
  /** The judge's verdict on the summary the review shows; Tier 2 only. */
  judge?: Verdict;
  /** Copies of the summary with one planted error each, and whether the judge flagged that statement. */
  controls?: { kind: PlantedError; caught: boolean }[];
  /** Share of planted errors the judge flagged: a judge that misses them cannot be trusted to find real ones. */
  caught?: number;
  /** Judge calls whose answer stayed invalid. */
  failures?: number;
}

/** What code can check about a summary, at every tier. */
export function checkSummary(summary: PlanSummary, facts: PlanSummaryInput): SummaryQuality {
  const texts = [summary.summary, ...summary.highlights];
  return { source: summary.source, unsupportedNumbers: unsupportedNumbers(texts, facts), specific: namesParticulars(texts, facts) };
}

/** The summary's sentences and its highlights: what the judge rules on, one at a time. */
export function statementsOf(summary: PlanSummary): string[] {
  return [...summary.summary.split(/(?<=[.!?])\s+(?=\S)/u), ...summary.highlights].map((text) => text.trim()).filter((text) => text !== '');
}

/**
 * The language model as a judge of the plan summary (an LLM-as-judge eval). Code splits the summary
 * into statements; the model quotes the facts behind each and says whether they agree; code checks the
 * quotes. A judge is itself a model that can be wrong, so it is tested on every run: copies of the
 * summary with a planted error (a wrong count, an action no plan takes) must have that statement flagged.
 */
export async function judgeSummary(provider: ChatProvider, summary: PlanSummary, facts: PlanSummaryInput): Promise<Pick<SummaryQuality, 'judge' | 'controls' | 'caught' | 'failures'>> {
  let failures = 0;
  const ask = async (shown: PlanSummary): Promise<Verdict | null> => {
    const statements = statementsOf(shown).map((text, i) => ({ id: `s${i + 1}`, text }));
    const result = await runPrompt(provider, summaryJudgeV1, { facts, statements });
    if (!result.ok) {
      failures++;
      return null;
    }
    return verdictOf(statements, result.value.value, facts);
  };
  const judge = await ask(summary);
  const controls: NonNullable<SummaryQuality['controls']> = [];
  for (const { kind, summary: planted, markers } of plantErrors(summary, facts)) {
    const verdict = await ask(planted);
    if (verdict) controls.push({ kind, caught: verdict.unsupported.some((statement) => markers.some((marker) => normalize(statement).includes(marker))) });
  }
  return {
    ...(judge ? { judge } : {}),
    controls,
    ...(controls.length > 0 ? { caught: ratio(controls.filter((control) => control.caught).length, controls.length) } : {}),
    failures,
  };
}

/**
 * The judge's answer with its quotes checked. A statement counts as supported only when the model says
 * so, its evidence is really in the facts, and the evidence holds every number the statement gives (or
 * numbers that add up to it): a model that approves "99 moves" by quoting "moves: 71" is overruled. Advice
 * is not judged, but a number in it still claims something about the plan, so code checks it against
 * the facts. A statement the model did not answer for counts as unsupported.
 */
export function verdictOf(statements: SummaryJudgeInput['statements'], answer: SummaryJudgeOutput, facts: PlanSummaryInput): Verdict {
  const text = compact(normalize(planFactLines(facts).join('\n')));
  const anywhere = supportedNumbers(facts);
  const inFacts = (evidence: string): boolean => {
    // A quote may join several places in the facts ("moves: 12, flags: 3" out of a longer line), and may
    // repeat a line's label ("Operations: moves: 12") or not; each part must be found as written.
    const parts = evidence
      .split(/\s*(?:\.\.\.|…|;|\n|,\s)\s*/)
      .map((part) => compact(normalize(part).replace(LABEL, '')))
      .filter((part) => part !== '');
    return parts.length > 0 && parts.every((part) => text.includes(part));
  };
  const rulings = statements.map((statement) => {
    const answered = answer.statements.find((entry) => entry.id === statement.id);
    const numbers = numbersIn(statement.text);
    if (answered?.verdict === 'advice') return { text: statement.text, advice: numbers.every((n) => anywhere.has(n)), supported: false, overruled: false };
    const approved = answered?.verdict === 'supported';
    const quoted = answered ? withTotals(numbersIn(answered.evidence)) : new Set<number>();
    const backed = answered !== undefined && inFacts(answered.evidence) && numbers.every((n) => quoted.has(n));
    return { text: statement.text, advice: false, supported: approved && backed, overruled: approved && !backed };
  });
  const claims = rulings.filter((ruling) => !ruling.advice);
  const unsupported = claims.filter((ruling) => !ruling.supported).map((ruling) => ruling.text);
  return {
    claims: claims.length,
    supported: claims.length === 0 ? 1 : ratio(claims.length - unsupported.length, claims.length),
    faithful: unsupported.length === 0,
    unsupported,
    overruled: rulings.filter((ruling) => ruling.overruled).length,
    advice: rulings.length - claims.length,
  };
}

/** The labels and bullets of the fact lines, which a quote may repeat, leave out, or blend. */
const LABEL = /^(?:(?:method|operations|notes per destination|le(?:ss|ast) certain changes(?: \(below 80 %\)| first)?|warnings):\s*|-\s+)+/;

/** Case and quote marks do not make a quote wrong. */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[“”„"'‘’]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Nor does spacing: a model copying text sometimes splits a word ("Měs íční"). */
function compact(text: string): string {
  return text.replace(/\s+/g, '');
}

/** An action no plan takes (merging is not an operation), so no facts can back it. */
const INVENTED: Record<PlanSummaryInput['language'], string> = {
  en: 'It also merges 4 pairs of duplicate notes.',
  cs: 'Navíc sloučí 4 dvojice duplicitních poznámek.',
};
/** How the invented claim is recognized among the flagged ones, in the vault's language or translated. */
const INVENTED_MARKERS = ['merge', 'slouč', 'duplic'];

export interface PlantedSummary {
  kind: PlantedError;
  summary: PlanSummary;
  /** Text by which the flagged claim is recognized as the planted one. */
  markers: string[];
}

/**
 * Copies of the summary, each with one error its reader should not get: the first count the facts back
 * changed to one they do not (left out when the summary has no such number), and an invented action.
 */
export function plantErrors(summary: PlanSummary, facts: PlanSummaryInput): PlantedSummary[] {
  const planted: PlantedSummary[] = [];
  const supported = supportedNumbers(facts);
  const counts = new Set(facts.counts.map((count) => Number(/(\d+)\s*$/.exec(count)?.[1])));
  const texts = [summary.summary, ...summary.highlights];
  // A count is the likeliest number to get wrong; any other backed number (a folder's) will do.
  const target = findNumber(texts, (n) => counts.has(n)) ?? findNumber(texts, (n) => supported.has(n));
  if (target) {
    const { text, index, length, value } = target;
    let wrong = value + Math.max(3, Math.round(value * 0.4));
    while (supported.has(wrong)) wrong++;
    const changed = texts.map((t, i) => (i === text ? `${t.slice(0, index)}${wrong}${t.slice(index + length)}` : t));
    planted.push({ kind: 'number', summary: { ...summary, summary: changed[0] as string, highlights: changed.slice(1) }, markers: [String(wrong)] });
  }
  planted.push({ kind: 'claim', summary: { ...summary, summary: `${summary.summary} ${INVENTED[facts.language]}` }, markers: INVENTED_MARKERS });
  return planted;
}

function findNumber(texts: readonly string[], accept: (n: number) => boolean): { text: number; index: number; length: number; value: number } | undefined {
  for (const [text, content] of texts.entries()) {
    for (const match of content.matchAll(/\d+/g)) {
      const value = Number(match[0]);
      if (accept(value)) return { text, index: match.index, length: match[0].length, value };
    }
  }
  return undefined;
}
