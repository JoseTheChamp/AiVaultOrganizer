import { METHOD_LABELS } from '../model/methods';
import type { VaultAnalysis } from './analyze';
import { describeDetection } from './method-detect';

const percent = (value: number): string => `${Math.round(value * 100)} %`;

/**
 * Plain Markdown rendering of an analysis, for "Copy as Markdown" in the diagnostics modal and for
 * eval reports. Contains structure and counts only: no note contents, no full paths beyond
 * folder names and a few examples, so it is safe to paste into an issue.
 */
export function formatAnalysisMarkdown(analysis: VaultAnalysis): string {
  const { stats, methods, health } = analysis;
  const lines: string[] = [
    '# Vault diagnostics',
    '',
    `**Health score:** ${health.score} / 100 (${health.grade})`,
    `**Method:** ${describeDetection(methods)}`,
    '',
    '## Overview',
    '',
    '| Metric | Value |',
    '|---|---|',
    `| Notes | ${stats.noteCount} |`,
    `| Folders | ${stats.folderCount} (${stats.emptyFolders.length} empty) |`,
    `| Attachments | ${stats.attachmentCount} |`,
    `| Links between notes | ${stats.graph.edgeCount} |`,
    `| Orphans | ${stats.graph.orphans.length} |`,
    `| Notes in root | ${stats.rootNoteCount} (${percent(stats.rootShare)}) |`,
    `| Maximum depth | ${stats.maxDepth} |`,
    `| Unique tags | ${stats.tags.uniqueTags} (${stats.tags.variantGroups.length} with variants) |`,
    `| Notes with properties | ${percent(stats.frontmatterShare)} |`,
    `| Language | ${stats.language.language} (confidence ${percent(stats.language.confidence)}) |`,
    '',
    '## Organization methods',
    '',
    '| Method | Score | Evidence |',
    '|---|---|---|',
    ...methods.scores.map(
      (score) => `| ${METHOD_LABELS[score.method]} | ${percent(score.score)} | ${score.reasons.join(' ') || '–'} |`,
    ),
    '',
    '## Health',
    '',
    '| Component | Value | Detail |',
    '|---|---|---|',
    ...health.components
      .filter((component) => component.weight > 0)
      .map((component) => `| ${component.label} | ${percent(component.value)} | ${component.detail} |`),
    '',
  ];
  return lines.join('\n');
}
