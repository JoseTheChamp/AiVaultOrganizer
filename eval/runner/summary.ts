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
    const similarity = result.similarity[method as keyof EvalResult['similarity']];
    lines.push(`  ${method}: links P@5 ${pct(links.precision)}, held-out recall ${pct(links.heldOutRecall)}, topic P@5 ${pct(similarity?.precision ?? 0)}`);
  }
  const folders = result.clusters.folders;
  if (folders) lines.push(`  folders as clusters: ARI ${folders.ari.toFixed(3)}, NMI ${folders.nmi.toFixed(3)}`);
  const { safety } = result;
  lines.push(`  safety: ${safety.applied}/${safety.operations} applied, ${safety.brokenLinks} broken links, undo ${safety.undoExact ? 'exact' : 'NOT exact'}`);
  for (const notice of result.notices) lines.push(`  note: ${notice}`);
  return `${lines.join('\n')}\n`;
}
