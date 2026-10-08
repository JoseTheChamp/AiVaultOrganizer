import { type Prices, estimateCost } from '../../core/ai/budget';
import { hostOf, isLoopbackUrl } from '../../core/ai/endpoint-url';
import type { StageEstimate } from '../../core/planner/llm-stage';

/** What a run would send to a model, from its estimate and the AI settings. */
export interface ConsentInput {
  /** What the run is for, completing "The language model would …". */
  purpose: string;
  estimate: StageEstimate;
  model: string;
  baseUrl: string;
  localOnly: boolean;
  prices: Prices;
  budgetTokens: number;
  /** Why the model cannot be used right now (offline, not installed), from its status check. */
  unavailable?: string | null;
}

/** The answer: send with the model, go on without it, or stop. */
export type ConsentChoice = 'model' | 'without' | 'cancel';

export interface ConsentState {
  purpose: string;
  model: string;
  /** "this computer", or the host notes go to. */
  where: string;
  local: boolean;
  /** Why the model cannot be used now (local-only mode, offline, not installed), or null. */
  unavailable: string | null;
  notes: number;
  withheld: number;
  calls: { min: number; max: number };
  /** Input and output together. */
  tokens: { min: number; max: number };
  /** In the user's currency, when prices are set. */
  cost: { min: number; max: number } | null;
  /** The upper estimate exceeds the token budget of one run: it may stop early. */
  overBudget: boolean;
}

/** The note card, in words: everything a model ever sees of a note (PLAN §7.2, §7.11). */
export const CARD_CONTENTS =
  'For each note: its title, folder, tags, a few properties (such as type and status), headings, outgoing links, how recently it changed, and the first few hundred characters of its text.';

export function consentState(input: ConsentInput): ConsentState {
  const local = isLoopbackUrl(input.baseUrl);
  const { estimate } = input;
  const tokens = { min: estimate.inputTokens.min + estimate.outputTokens.min, max: estimate.inputTokens.max + estimate.outputTokens.max };
  const low = estimateCost({ input: estimate.inputTokens.min, output: estimate.outputTokens.min }, input.prices);
  const high = estimateCost({ input: estimate.inputTokens.max, output: estimate.outputTokens.max }, input.prices);
  return {
    purpose: input.purpose,
    model: input.model,
    where: local ? 'this computer' : hostOf(input.baseUrl),
    local,
    unavailable: !local && input.localOnly ? `Local-only mode is on, so ${hostOf(input.baseUrl)} cannot be reached. Turn it off in Set up AI.` : (input.unavailable ?? null),
    notes: estimate.notes,
    withheld: estimate.withheld,
    calls: estimate.calls,
    tokens,
    cost: low !== null && high !== null ? { min: low, max: high } : null,
    overBudget: tokens.max > input.budgetTokens,
  };
}

/** "about 12,000" or "12,000–24,000": ranges collapse when both ends agree. */
export function range(values: { min: number; max: number }, format: (value: number) => string = (value) => value.toLocaleString('en-US')): string {
  return values.min === values.max ? format(values.min) : `${format(values.min)}–${format(values.max)}`;
}
