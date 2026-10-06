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
  const models = [`embeddings: ${result.embedModel ?? 'none'}`, `language model: ${result.chatModel ?? 'none'}`].join(', ');
  const lines = [
    `# Eval: ${result.fixture} (tier ${result.tier})`,
    '',
    `${result.notes} notes in ${result.language === 'cs' ? 'Czech' : 'English'}. Models: ${models}.`,
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
    '## Link suggestions',
    '',
    ...table(
      ['Method', 'P@3', 'Relevance', 'Held-out recall', 'Suggestions'],
      Object.entries(result.links).map(([method, m]) => [method, pct(m.precision), pct(m.relevance), pct(m.heldOutRecall), String(m.suggestions)]),
    ),
    '',
    '## Similarity, duplicates and stubs',
    '',
    ...table(
      ['Method', 'Topic P@5', 'Duplicates P / R'],
      Object.entries(result.similarity).map(([method, quality]) => {
        const duplicates = result.duplicates[method as keyof EvalResult['duplicates']];
        return [method, pct(quality.precision), duplicates ? `${pct(duplicates.precision)} / ${pct(duplicates.recall)} (${duplicates.predicted} found, ${duplicates.actual} real)` : 'n/a'];
      }),
    ),
    '',
    `Stubs: ${result.stubs.found} found, ${result.stubs.actual} real; precision ${pct(result.stubs.precision)}, recall ${pct(result.stubs.recall)}.`,
    '',
    '## Clusters',
    '',
    ...table(
      ['Clustering', 'Clusters', 'ARI (topic)', 'NMI (topic)', 'ARI (project)', 'NMI (project)'],
      Object.entries(result.clusters).map(([name, q]) => [name, String(q.topic.clusters), num(q.topic.ari), num(q.topic.nmi), num(q.project.ari), num(q.project.nmi)]),
    ),
  ];
  if (result.labels) {
    const { labels } = result;
    lines.push(
      '',
      '## Cluster labels',
      '',
      `${labels.clusters} clusters named in ${labels.calls} calls; ${labels.failures} failed batches, ${labels.repaired} repaired.`,
      '',
      ...table(
        ['Label', 'Most common topic', 'Share'],
        labels.examples.map((example) => [example.label, example.topic, pct(example.share)]),
      ),
    );
  }
  lines.push(
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
      ['Task', 'Calls', 'Input tokens', 'Output tokens', 'Time (ms)'],
      Object.entries(result.cost).map(([task, cost]) => {
        const scaled = per100Notes(cost, result.notes);
        return [task, String(scaled.calls), String(scaled.inputTokens), String(scaled.outputTokens), String(scaled.ms)];
      }),
    ),
  );
  if (result.notices.length > 0) lines.push('', '## Notes', '', ...result.notices.map((notice) => `- ${notice}`));
  return `${lines.join('\n')}\n`;
}

/** File name stem: `<date>-<fixture>-t<tier>-<model>`, as PLAN §8.3 describes. */
export function reportName(result: EvalResult, date: string): string {
  const model = [result.embedModel, result.chatModel].filter((m): m is string => m !== null).join('+') || 'none';
  return `${date}-${result.fixture}-t${result.tier}-${model.replace(/[^a-z0-9.+-]+/gi, '-')}`;
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
