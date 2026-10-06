import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { METHOD_LABELS } from '../../src/core/model/methods';
import { FIXTURE_METHOD_KEYS, FIXTURE_METHODS } from '../fixture/ground-truth';
import { per100Notes } from '../metrics/cost';
import type { EvalResult } from './run-eval';

const pct = (value: number): string => `${(value * 100).toFixed(1)} %`;
const num = (value: number): string => value.toFixed(3);

function table(header: string[], rows: string[][]): string[] {
  return [`| ${header.join(' | ')} |`, `|${header.map((_, i) => (i === 0 ? '---' : '---:')).join('|')}|`, ...rows.map((row) => `| ${row.join(' | ')} |`)];
}

/** One fixture's results as Markdown: the tables PLAN §8.2 lists, plus what was skipped. */
export function formatReport(result: EvalResult): string {
  const lines = [
    `# Eval: ${result.fixture} (tier ${result.tier})`,
    '',
    `${result.notes} notes in ${result.language === 'cs' ? 'Czech' : 'English'}. Embedding model: ${result.embedModel ?? 'none'}.`,
    '',
    '## Classification (rules)',
    '',
    ...table(
      ['Method', 'Coverage', 'Precision', 'Accuracy', 'Macro-F1', 'ECE', 'Rules / kNN / LLM'],
      FIXTURE_METHOD_KEYS.map((method) => {
        const m = result.classification[method];
        return [METHOD_LABELS[FIXTURE_METHODS[method]], pct(m.coverage), pct(m.precision), pct(m.accuracy), num(m.macroF1), num(m.ece), `${m.decidedBy.rules} / ${m.decidedBy.knn} / ${m.decidedBy.llm}`];
      }),
    ),
    '',
    '## Similarity',
    '',
    ...table(
      ['Method', 'Link P@5', 'Held-out recall', 'Topic P@5', 'Duplicates P / R (threshold)'],
      Object.entries(result.links).map(([method, links]) => {
        const key = method as keyof EvalResult['links'];
        const duplicates = result.duplicates[key];
        return [
          method,
          pct(links.precision),
          pct(links.heldOutRecall),
          pct(result.similarity[key]?.precision ?? 0),
          duplicates ? `${pct(duplicates.precision)} / ${pct(duplicates.recall)} (${duplicates.threshold})` : 'n/a',
        ];
      }),
    ),
    '',
    '## Clusters',
    '',
    ...table(
      ['Clustering', 'ARI', 'NMI', 'Clusters'],
      Object.entries(result.clusters).map(([name, m]) => [name, num(m.ari), num(m.nmi), String(m.clusters)]),
    ),
    '',
    '## Safety',
    '',
    ...table(
      ['Operations', 'Applied', 'Failed', 'Broken links', 'Undo exact'],
      [[String(result.safety.operations), String(result.safety.applied), String(result.safety.failed), String(result.safety.brokenLinks), result.safety.undoExact ? 'yes' : '**no**']],
    ),
    '',
    '## Cost per 100 notes',
    '',
    ...table(
      ['Task', 'Calls', 'Input tokens', 'Time (ms)'],
      Object.entries(result.cost).map(([task, cost]) => {
        const scaled = per100Notes(cost, result.notes);
        return [task, String(scaled.calls), String(scaled.inputTokens), String(scaled.ms)];
      }),
    ),
  ];
  if (result.notices.length > 0) lines.push('', '## Notes', '', ...result.notices.map((notice) => `- ${notice}`));
  return `${lines.join('\n')}\n`;
}

/** File name stem: `<date>-<fixture>-t<tier>-<model>`, as PLAN §8.3 describes. */
export function reportName(result: EvalResult, date: string): string {
  const model = (result.embedModel ?? 'none').replace(/[^a-z0-9.-]+/gi, '-');
  return `${date}-${result.fixture}-t${result.tier}-${model}`;
}

/** Writes `<name>.json` (every number) and `<name>.md` (the tables) for each result. */
export async function writeReports(results: readonly EvalResult[], outDir: string, date: string): Promise<string[]> {
  await mkdir(outDir, { recursive: true });
  const written: string[] = [];
  for (const result of results) {
    const stem = path.join(outDir, reportName(result, date));
    await writeFile(`${stem}.json`, `${JSON.stringify(result, null, 2)}\n`);
    await writeFile(`${stem}.md`, formatReport(result));
    written.push(`${stem}.json`, `${stem}.md`);
  }
  return written;
}
