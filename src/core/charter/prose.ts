import type { Lang } from './presets/index';
import { PRESETS, toLang } from './presets/index';
import type { Charter, Destination, Rule } from './schema';

/** Ids of the generated sections, in note order. */
export const SECTION_IDS = ['overview', 'where-does-it-go', 'conventions'] as const;
export type SectionId = (typeof SECTION_IDS)[number];

const T = {
  en: {
    title: '# Vault Charter',
    customOverview: 'This vault follows its own system, described by the rules below. The plugin keeps notes aligned with it and proposes changes for review.',
    propertiesMode: 'Notes are classified mainly by properties; folders are kept to a minimum.',
    whereHeading: '## Where does a new note go?',
    inbox: (path: string) => `Unprocessed capture → \`${path}\``,
    daily: (path: string, format: string) => `Daily notes (\`${format}\`) → \`${path}\``,
    rootNotes: 'Your own notes → the vault root, classified by properties',
    automatic: 'automatically when',
    or: 'or',
    item: 'item',
    topic: 'topic',
    conventionsHeading: '## Conventions',
    required: (keys: string) => `Every note has these properties: ${keys}.`,
    tags: (style: string) => (style === 'lowercase-kebab' ? 'Tags are lowercase with dashes, e.g. `#project-management`.' : 'Tags are kept as written.'),
    maxTags: (n: number) => `At most ${n} tags per note.`,
    related: (heading: string) => `Related notes are linked under the heading \`${heading}\`.`,
    minLinks: (n: number) => `Every note links to at least ${n} other ${n === 1 ? 'note' : 'notes'}.`,
    ignored: (globs: string) => `Never touched by the plugin: ${globs}.`,
    attachments: (path: string) => `Attachments live in \`${path}\`; the plugin never moves them.`,
    inboxAge: (days: number) => `Notes should not stay in the inbox longer than ${days} days.`,
    userHeading: '## My notes on this system',
    userText: 'Anything you write outside the generated sections is yours; the plugin never changes it.',
    rulesHeading: '## Rules',
    rulesText: 'The block below is what the plugin reads. Edit it in source mode; reading mode shows it as a summary card.',
  },
  cs: {
    title: '# Charta vaultu',
    customOverview: 'Tento vault má vlastní systém popsaný pravidly níže. Plugin podle něj udržuje poznámky v pořádku a navrhuje změny ke kontrole.',
    propertiesMode: 'Poznámky třídíme hlavně podle vlastností; složek je co nejméně.',
    whereHeading: '## Kam patří nová poznámka?',
    inbox: (path: string) => `Nezpracovaný záznam → \`${path}\``,
    daily: (path: string, format: string) => `Denní poznámky (\`${format}\`) → \`${path}\``,
    rootNotes: 'Vlastní poznámky → kořen vaultu, zařazené podle vlastností',
    automatic: 'automaticky, když',
    or: 'nebo',
    item: 'položka',
    topic: 'téma',
    conventionsHeading: '## Konvence',
    required: (keys: string) => `Každá poznámka má tyto vlastnosti: ${keys}.`,
    tags: (style: string) => (style === 'lowercase-kebab' ? 'Štítky píšeme malými písmeny s pomlčkami, např. `#rizeni-projektu`.' : 'Štítky ponecháváme tak, jak jsou napsané.'),
    maxTags: (n: number) => `Nejvýše ${n} štítků na poznámku.`,
    related: (heading: string) => `Související poznámky odkazujeme pod nadpisem \`${heading}\`.`,
    minLinks: (n: number) => `Každá poznámka odkazuje alespoň na ${n} ${n === 1 ? 'jinou poznámku' : 'jiné poznámky'}.`,
    ignored: (globs: string) => `Plugin nikdy nemění: ${globs}.`,
    attachments: (path: string) => `Přílohy jsou ve složce \`${path}\`; plugin je nikdy nepřesouvá.`,
    inboxAge: (days: number) => `Poznámky by neměly zůstat ve schránce déle než ${days} dní.`,
    userHeading: '## Moje poznámky k systému',
    userText: 'Cokoli napíšeš mimo generované sekce, patří tobě; plugin to nikdy nemění.',
    rulesHeading: '## Pravidla',
    rulesText: 'Plugin čte blok níže. Uprav ho v režimu zdroje; v režimu čtení se zobrazí jako přehledová karta.',
  },
} satisfies Record<Lang, unknown>;

export function charterText(charter: Charter): (typeof T)[Lang] {
  return T[toLang(charter.language)];
}

/** Markdown of one generated section, rendered deterministically from the charter. */
export function renderSection(charter: Charter, id: SectionId): string {
  const t = charterText(charter);
  switch (id) {
    case 'overview': {
      const summary = charter.preset === 'custom' ? t.customOverview : PRESETS[charter.preset].summary[toLang(charter.language)];
      return charter.mode === 'properties' ? `${summary}\n\n${t.propertiesMode}` : summary;
    }
    case 'where-does-it-go': {
      const items: string[] = [];
      if (charter.inbox) items.push(t.inbox(charter.inbox));
      if (charter.mode === 'properties') items.push(t.rootNotes);
      for (const destination of charter.destinations) items.push(destinationLine(charter, destination));
      if (charter.system.daily) items.push(t.daily(charter.system.daily.path, charter.system.daily.filename));
      return [t.whereHeading, ...items.map((item, index) => `${index + 1}. ${item}`)].join('\n');
    }
    case 'conventions': {
      const lines: string[] = [];
      const { properties, tags, links } = charter.conventions;
      if (properties && properties.required.length > 0) lines.push(t.required(properties.required.map((key) => `\`${key}\``).join(', ')));
      if (tags) lines.push(t.tags(tags.style));
      if (tags?.maxPerNote) lines.push(t.maxTags(tags.maxPerNote));
      if (links?.relatedHeading) lines.push(t.related(links.relatedHeading));
      if (links?.minOutgoing) lines.push(t.minLinks(links.minOutgoing));
      if (charter.drift.inboxMaxAgeDays && charter.inbox) lines.push(t.inboxAge(charter.drift.inboxMaxAgeDays));
      if (charter.system.attachments) lines.push(t.attachments(charter.system.attachments));
      if (charter.ignore.length > 0) lines.push(t.ignored(charter.ignore.map((glob) => `\`${glob}\``).join(', ')));
      return [t.conventionsHeading, ...lines.map((line) => `- ${line}`)].join('\n');
    }
  }
}

function destinationLine(charter: Charter, destination: Destination): string {
  const t = charterText(charter);
  const where = destination.path
    ? `\`${destination.path}${destination.layout === 'subfolder-per-item' ? `/<${t.item}>` : destination.layout === 'subfolder-per-topic' ? `/<${t.topic}>` : ''}\``
    : `\`categories: ${destination.category ?? destination.id}\``;
  const description = destination.description.trim().replace(/\.$/, '') || destination.id;
  const rules = destination.match.map(describeRule).join(` ${t.or} `);
  return `${description} → ${where}${rules ? ` (${t.automatic} ${rules})` : ''}`;
}

export function describeRule(rule: Rule): string {
  if ('equals' in rule) {
    const values = Array.isArray(rule.equals) ? rule.equals : [rule.equals];
    return `\`${rule.property}: ${values.map(String).join(' | ')}\``;
  }
  if ('exists' in rule) return rule.exists ? `\`${rule.property}\` is set` : `\`${rule.property}\` is empty`;
  if ('tag' in rule) return `\`#${rule.tag.replace(/^#/, '')}\``;
  if ('filename' in rule) return `name matches \`${rule.filename}\``;
  return `path matches \`${rule.pathGlob}\``;
}
