import { FIXTURE_METHOD_KEYS } from '../fixture/ground-truth';
import { type EvalResult, STAGES } from './run-eval';

const pct = (value: number): string => `${(value * 100).toFixed(1)}%`;

/** A few lines per fixture for the terminal; the full numbers go to the report files. */
export function summarize(result: EvalResult): string {
  const lines = [`${result.fixture} (${result.language}, ${result.notes} notes, tier ${result.tier})`];
  for (const stage of STAGES) {
    const methods = FIXTURE_METHOD_KEYS.flatMap((method) => {
      const metrics = result.classification[method][stage];
      return metrics ? [`${method} ${pct(metrics.coverage)} decided, ${pct(metrics.precision)} right`] : [];
    });
    if (methods.length > 0) lines.push(`  classification (${stage}): ${methods.join(' · ')}`);
  }
  for (const [method, links] of Object.entries(result.links)) {
    lines.push(`  links (${method}): P@3 ${pct(links.precision)}, relevant ${pct(links.relevance)}, held-out recall ${pct(links.heldOutRecall)}`);
  }
  for (const [method, quality] of Object.entries(result.clusters)) {
    lines.push(`  clusters (${method}): ${quality.topic.clusters}, ARI ${quality.topic.ari.toFixed(3)} by topic, ${quality.project.ari.toFixed(3)} by project`);
  }
  for (const [method, duplicates] of Object.entries(result.duplicates)) {
    lines.push(`  duplicates (${method}): ${duplicates.predicted} found of ${duplicates.actual}, precision ${pct(duplicates.precision)}, recall ${pct(duplicates.recall)}`);
  }
  if (result.labels) lines.push(`  labels: ${result.labels.clusters} clusters, ${result.labels.failures} failed batches, e.g. ${result.labels.examples.slice(0, 3).map((e) => `"${e.label}"`).join(', ')}`);
  const { plan, safety } = result;
  const operations = Object.values(plan.operations).reduce((sum, count) => sum + count, 0);
  lines.push(`  plan (PARA): ${operations} operations, ${plan.errors} invalid, ${plan.applied} applied, ${plan.failed} failed, ${plan.brokenLinks} broken links, undo ${plan.undoExact ? 'exact' : 'NOT exact'}`);
  const { summary } = result;
  const judged = summary.judge ? `, judge: ${pct(summary.judge.supported)} of ${summary.judge.claims} claims backed, caught ${(summary.controls ?? []).filter((c) => c.caught).length}/${(summary.controls ?? []).length} planted errors` : '';
  lines.push(`  summary (${summary.source}): ${summary.unsupportedNumbers.length} unsupported numbers, ${summary.specific ? 'specific' : 'generic'}${judged}`);
  lines.push(`  safety: ${safety.applied}/${safety.operations} applied, ${safety.brokenLinks} broken links, undo ${safety.undoExact ? 'exact' : 'NOT exact'}`);
  for (const notice of result.notices) lines.push(`  note: ${notice}`);
  return `${lines.join('\n')}\n`;
}
