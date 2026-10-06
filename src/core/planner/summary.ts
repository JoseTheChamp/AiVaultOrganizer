import { type PlanSummaryInput, planSummaryV1 } from '../ai/prompts/plan-summary.v1';
import { runPrompt } from '../ai/prompts/types';
import type { ChatProvider } from '../ai/types';
import { toLang } from '../charter/presets';
import type { Charter } from '../charter/schema';
import { METHOD_LABELS } from '../model/methods';
import type { Operation } from '../model/operation';
import { describeOperation, KIND_LABELS } from '../model/operation-text';
import { isInFolder } from '../model/paths';
import type { Plan } from '../model/plan';
import { plural } from '../model/text';

export interface PlanSummary {
  summary: string;
  highlights: string[];
  /** Written by a model, or composed from the plan's numbers when no model is used or it failed. */
  source: 'model' | 'rules';
}

/** The plan in numbers and examples, the same for the rule-based and the model summary. */
export function planFacts(plan: Plan, charter: Charter): PlanSummaryInput {
  const byKind = new Map<string, number>();
  for (const op of plan.operations) byKind.set(op.kind, (byKind.get(op.kind) ?? 0) + 1);
  const counts = [...byKind].map(([kind, count]) => `${KIND_LABELS[kind as Operation['kind']].toLowerCase()}: ${count}`);
  const destinations = charter.destinations
    .filter((d) => d.path)
    .map((d) => ({ label: d.path as string, count: plan.operations.filter((op) => op.kind === 'move' && isInFolder(op.to, d.path as string)).length }))
    .filter((d) => d.count > 0)
    .map((d) => `${d.label}: ${d.count}`);
  // Low-confidence decisions and flags matter most to a reviewer, so they come first.
  const examples = [...plan.operations]
    .sort((a, b) => Number(b.kind === 'flag') - Number(a.kind === 'flag') || a.confidence - b.confidence)
    .slice(0, 8)
    .map(describeOperation);
  return {
    language: toLang(charter.language),
    method: charter.preset === 'custom' ? 'a custom system' : METHOD_LABELS[charter.preset],
    counts,
    destinations,
    examples,
    warnings: plan.warnings.map((w) => w.message),
  };
}

/** A summary from the numbers alone: always available, no model needed. */
export function describePlan(plan: Plan, charter: Charter): PlanSummary {
  const moves = plan.operations.filter((op) => op.kind === 'move').length;
  const flags = plan.operations.filter((op) => op.kind === 'flag');
  const unsure = plan.operations.filter((op) => op.kind !== 'flag' && op.confidence < 0.8).length;
  const facts = planFacts(plan, charter);
  const sentences = [
    moves > 0 ? `This plan moves ${plural(moves, 'note')} into the structure of your charter (${facts.method}).` : 'This plan moves no notes.',
    plan.operations.length > moves + flags.length ? `It also makes ${plural(plan.operations.length - moves - flags.length, 'other change')}.` : '',
    flags.length > 0 ? `${plural(flags.length, 'note')} ${flags.length === 1 ? 'needs' : 'need'} your decision.` : '',
  ];
  const highlights = [
    unsure > 0 ? `${plural(unsure, 'change')} ${unsure === 1 ? 'is' : 'are'} less certain; check ${unsure === 1 ? 'it' : 'them'} first.` : '',
    ...['ambiguous', 'duplicate', 'query-breakage'].map((issue) => {
      const count = flags.filter((op) => op.kind === 'flag' && op.issue === issue).length;
      if (count === 0) return '';
      return issue === 'ambiguous' ? `${plural(count, 'note')} could not be placed.` : issue === 'duplicate' ? `${plural(count, 'possible duplicate')}.` : `${plural(count, 'query', 'queries')} will show different notes.`;
    }),
  ].filter((line) => line !== '');
  return { summary: sentences.filter((s) => s !== '').join(' '), highlights, source: 'rules' };
}

/**
 * The review header's summary (PLAN §7.8 `plan-summary`): written by a model in the vault's
 * language when one is configured, from the plan's numbers otherwise or when the model fails.
 */
export async function summarizePlan(plan: Plan, charter: Charter, provider?: ChatProvider): Promise<PlanSummary> {
  if (!provider || plan.operations.length === 0) return describePlan(plan, charter);
  const result = await runPrompt(provider, planSummaryV1, planFacts(plan, charter));
  if (!result.ok) return describePlan(plan, charter);
  return { ...result.value.value, source: 'model' };
}
