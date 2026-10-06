import { FIXTURE_METHOD_KEYS } from '../fixture/ground-truth';
import type { EvalResult } from './run-eval';

const pct = (value: number): string => `${(value * 100).toFixed(1)}%`;

/** A few lines per fixture for the terminal; the full numbers go to the report files. */
export function summarize(result: EvalResult): string {
  const lines = [`${result.fixture} (${result.language}, ${result.notes} notes, tier ${result.tier})`];
  const rules = FIXTURE_METHOD_KEYS.map((method) => {
    const metrics = result.classification[method];
    return `${method} ${pct(metrics.coverage)} decided, ${pct(metrics.precision)} right`;
  });
  lines.push(`  rules: ${rules.join(' · ')}`);
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
  const { safety } = result;
  lines.push(`  safety: ${safety.applied}/${safety.operations} applied, ${safety.brokenLinks} broken links, undo ${safety.undoExact ? 'exact' : 'NOT exact'}`);
  for (const notice of result.notices) lines.push(`  note: ${notice}`);
  return `${lines.join('\n')}\n`;
}
