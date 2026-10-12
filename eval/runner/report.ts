import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { METHOD_LABELS } from '../../src/core/model/methods';
import { FIXTURE_METHOD_KEYS, FIXTURE_METHODS } from '../fixture/ground-truth';
import { per100Notes } from '../metrics/cost';
import type { ReliabilityBand } from '../metrics/classification';
import { type EvalResult, STAGES, type StageMetrics } from './run-eval';

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
    '## Classification',
    '',
    'Stages: rules alone; rules and kNN over word statistics; rules and kNN over embeddings; all of these and the language model. Subfolders: of the notes in the right destination that belong in a subfolder, the share in the right one.',
    '',
    ...table(
      ['Method', 'Stages', 'Coverage', 'Precision', 'Accuracy', 'Macro-F1', 'ECE', 'Confident (share / accuracy)', 'Subfolders', 'Rules / kNN / LLM'],
      FIXTURE_METHOD_KEYS.flatMap((method) =>
        STAGES.flatMap((stage) => {
          const m = result.classification[method][stage];
          if (!m) return [];
          return [[METHOD_LABELS[FIXTURE_METHODS[method]], stage, pct(m.coverage), pct(m.precision), pct(m.accuracy), num(m.macroF1), num(m.ece), `${pct(m.confident.share)} / ${pct(m.confident.accuracy)}`, m.subfolderAccuracy === null ? 'n/a' : pct(m.subfolderAccuracy), `${m.decidedBy.rules} / ${m.decidedBy.knn} / ${m.decidedBy.llm}`]];
        }),
      ),
    ),
    '',
    '### Calibration and mistakes',
    '',
    'The last stage per method. Calibration counts only the decisions that can be uncertain (similar notes and the model), since rules claim 100 % and are always right. Reliability: per confidence band, notes, the confidence they claim and how often they are right. Model calls: requests, of which repaired after an invalid answer, and batches that failed.',
    '',
    ...table(
      ['Method', 'Model ECE', 'Brier', 'Reliability (claimed → right)', 'Most frequent mistakes', 'Model calls (repaired / failed)'],
      FIXTURE_METHOD_KEYS.flatMap((method) => {
        const stage = [...STAGES].reverse().find((s) => result.classification[method][s]);
        const m = stage ? result.classification[method][stage] : undefined;
        if (!m) return [];
        return [[`${METHOD_LABELS[FIXTURE_METHODS[method]]} (${stage})`, num(m.modelEce), num(m.modelBrier), reliability(m.reliability), mistakes(m), m.model ? `${m.model.calls} (${m.model.repaired} / ${m.model.failures})` : 'n/a']];
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
  const { plan, summary } = result;
  lines.push(
    '',
    '## Full plan (PARA)',
    '',
    `The planner end to end: every operation accepted, applied through the executor, then undone. Summary written by ${plan.summarySource === 'model' ? 'the language model' : 'rules'}.`,
    '',
    ...table(
      ['Operations', 'Validation errors', 'Applied', 'Failed', 'Broken links', 'Undo exact'],
      [[Object.entries(plan.operations).map(([kind, count]) => `${kind} ${count}`).join(', ') || 'none', String(plan.errors), String(plan.applied), String(plan.failed), String(plan.brokenLinks), plan.undoExact ? 'yes' : '**no**']],
    ),
    '',
    '## Plan summary',
    '',
    `Written by ${summary.source === 'model' ? 'the language model' : 'rules'}. Checked by code: numbers the plan facts do not contain: ${summary.unsupportedNumbers.length === 0 ? 'none' : summary.unsupportedNumbers.join(', ')}; ${summary.specific ? 'names particular notes or folders to look at' : 'generic: names no particular note or folder'}.`,
    ...(summary.judge
      ? [
          '',
          `Judge (${result.chatModel ?? 'model'}, summary-judge v1): ${summary.judge.claims} claims, ${pct(summary.judge.supported)} backed by a quote from the facts${summary.judge.overruled > 0 ? ` (${summary.judge.overruled} approved by the model with a quote that does not back them, overruled)` : ''}. Planted errors flagged: ${(summary.controls ?? []).map((c) => `${c.kind} ${c.caught ? 'yes' : '**no**'}`).join(', ') || 'none planted'}.`,
          ...(summary.judge.unsupported.length > 0 ? ['', 'Unsupported claims:', '', ...summary.judge.unsupported.map((claim) => `- ${claim}`)] : []),
        ]
      : []),
    '',
    '## Safety',
    '',
    'Every note filed where the ground truth puts it under PARA, applied and undone.',
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

function reliability(bands: readonly ReliabilityBand[]): string {
  return bands.map((band) => `${band.from}–${band.to}: ${band.notes} (${Math.round(band.confidence * 100)} → ${Math.round(band.accuracy * 100)} %)`).join('; ') || 'n/a';
}

function mistakes(metrics: StageMetrics): string {
  return metrics.confusions.map((c) => `${c.expected} → ${c.predicted} ×${c.count}`).join(', ') || 'none';
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
