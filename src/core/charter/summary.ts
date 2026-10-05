import { METHOD_LABELS } from '../model/methods';
import { describeRule } from './prose';
import type { Charter } from './schema';
import type { CharterIssue } from './yaml';

export interface CharterSummary {
  title: string;
  chips: string[];
  destinations: { id: string; where: string; rules: string; description: string }[];
  system: { label: string; value: string }[];
  ignore: string[];
  jd: { area: string; categories: string }[];
}

const LAYOUT_TEXT: Record<Charter['destinations'][number]['layout'], string> = {
  flat: '',
  'subfolder-per-item': ' (folder per item)',
  'subfolder-per-topic': ' (folder per topic)',
};

/** Plain data for the charter card in reading view and the dashboard; no Obsidian or DOM here. */
export function summarizeCharter(charter: Charter): CharterSummary {
  const label = charter.preset === 'custom' ? 'Custom' : METHOD_LABELS[charter.preset];
  const system: CharterSummary['system'] = [];
  if (charter.inbox) system.push({ label: 'Inbox', value: charter.inbox });
  if (charter.system.daily) system.push({ label: 'Daily notes', value: `${charter.system.daily.path} (${charter.system.daily.filename})` });
  if (charter.system.attachments) system.push({ label: 'Attachments', value: charter.system.attachments });
  if (charter.system.templates) system.push({ label: 'Templates', value: charter.system.templates });
  return {
    title: `${label} charter`,
    chips: [`Revision ${charter.revision}`, `Language ${charter.language}`, `${capitalize(charter.mode)} mode`],
    destinations: charter.destinations.map((destination) => ({
      id: destination.id,
      where: `${destination.path ?? destination.category ?? '–'}${destination.path ? LAYOUT_TEXT[destination.layout] : ''}`,
      rules: destination.match.map(describeRule).join(' or ').replaceAll('`', '') || '–',
      description: destination.description,
    })),
    system,
    ignore: charter.ignore,
    jd: (charter.jd?.areas ?? []).map((area) => ({
      area: `${area.id} ${area.name}`,
      categories: area.categories.map((category) => `${category.id} ${category.name}`).join(', '),
    })),
  };
}

/** One line per issue, for the error card and notices. */
export function formatCharterIssues(issues: readonly CharterIssue[]): string[] {
  return issues.map((issue) => `${issue.line ? `Line ${issue.line}: ` : ''}${issue.path ? `${issue.path}: ` : ''}${issue.message}`);
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
