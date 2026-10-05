import { formatCharterIssues, summarizeCharter } from '../../core/charter/summary';
import { parseCharterYaml } from '../../core/charter/yaml';

/**
 * Renders a ```charter block in reading view: a summary card when the YAML is valid, or the list of
 * problems with line numbers when it is not. The raw YAML stays editable in source mode.
 */
export function renderCharterBlock(source: string, el: HTMLElement): void {
  const card = el.createDiv({ cls: 'avo-charter-card' });
  const parsed = parseCharterYaml(source);
  if (!parsed.ok) {
    card.addClass('avo-charter-invalid');
    card.createDiv({ cls: 'avo-charter-title', text: 'The charter rules have problems' });
    const list = card.createEl('ul');
    for (const line of formatCharterIssues(parsed.error)) list.createEl('li', { text: line });
    card.createEl('p', {
      cls: 'avo-muted',
      text: 'Nothing is planned or checked against this charter until the rules are valid. Switch to source mode to fix them.',
    });
    return;
  }

  const summary = summarizeCharter(parsed.value);
  const header = card.createDiv({ cls: 'avo-charter-header' });
  header.createDiv({ cls: 'avo-charter-title', text: summary.title });
  const chips = header.createDiv({ cls: 'avo-charter-chips' });
  for (const chip of summary.chips) chips.createSpan({ cls: 'avo-chip', text: chip });

  const table = card.createEl('table', { cls: 'avo-charter-table' });
  const head = table.createEl('thead').createEl('tr');
  for (const label of ['Destination', 'Where', 'Rules', 'What belongs here']) head.createEl('th', { text: label });
  const body = table.createEl('tbody');
  for (const destination of summary.destinations) {
    const row = body.createEl('tr');
    row.createEl('td', { text: destination.id });
    row.createEl('td', { text: destination.where });
    row.createEl('td', { text: destination.rules });
    row.createEl('td', { text: destination.description });
  }

  if (summary.system.length > 0) {
    const list = card.createEl('dl', { cls: 'avo-charter-system' });
    for (const item of summary.system) {
      list.createEl('dt', { text: item.label });
      list.createEl('dd', { text: item.value });
    }
  }
  if (summary.jd.length > 0) {
    const index = card.createEl('ul', { cls: 'avo-charter-jd' });
    for (const area of summary.jd) index.createEl('li', { text: `${area.area}: ${area.categories}` });
  }
  if (summary.ignore.length > 0) {
    card.createEl('p', { cls: 'avo-muted', text: `Never touched: ${summary.ignore.join(', ')}` });
  }
}
