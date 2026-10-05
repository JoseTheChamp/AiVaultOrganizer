import { defaultIgnore, type Lang, type Preset } from './types';

/**
 * ACE keeps its English folder names in every language (Atlas, Calendar, Efforts are the method's
 * vocabulary, as in Linking Your Thinking); descriptions are localized. `+` is LYT's inbox and `x`
 * holds extras such as templates and attachments.
 */
const DESCRIPTIONS: Record<Lang, Record<string, string>> = {
  en: {
    maps: 'Maps of content: notes that gather and explain links to other notes.',
    notes: 'Ideas and knowledge in your own words.',
    sources: 'Notes about books, articles, videos and other sources.',
    people: 'One note per person.',
    logs: 'Time-based logs and journals other than daily notes.',
    meetings: 'Meeting notes, named with their date.',
    on: 'Efforts you are actively working on now.',
    ongoing: 'Recurring efforts that never really end.',
    simmering: 'Efforts on the back burner, picked up now and then.',
    sleeping: 'Efforts that are paused or done.',
  },
  cs: {
    maps: 'Mapy obsahu: poznámky, které shromažďují a vysvětlují odkazy na jiné poznámky.',
    notes: 'Myšlenky a znalosti vlastními slovy.',
    sources: 'Poznámky ke knihám, článkům, videím a dalším zdrojům.',
    people: 'Jedna poznámka na každého člověka.',
    logs: 'Časové záznamy a deníky kromě denních poznámek.',
    meetings: 'Zápisy ze schůzek, pojmenované datem.',
    on: 'Úsilí, na kterém právě aktivně pracuješ.',
    ongoing: 'Opakující se úsilí, které vlastně nikdy nekončí.',
    simmering: 'Úsilí na mírném ohni, ke kterému se občas vracíš.',
    sleeping: 'Úsilí, které je pozastavené nebo hotové.',
  },
};

export const ace: Preset = {
  id: 'ace',
  label: 'ACE',
  summary: {
    en: 'This vault uses **ACE** (Nick Milo, Linking Your Thinking): notes are organized by intention. **Atlas** holds knowledge (to understand), **Calendar** holds time-based notes (to reflect), and **Efforts** holds projects and actions (to act), sorted by how much attention they get right now.',
    cs: 'Tento vault používá **ACE** (Nick Milo, Linking Your Thinking): poznámky třídíme podle záměru. **Atlas** obsahuje znalosti (k porozumění), **Calendar** časové poznámky (k reflexi) a **Efforts** projekty a činnosti (k jednání), seřazené podle toho, kolik pozornosti teď dostávají.',
  },
  guidance:
    'Decide by intention, not topic: knowledge to understand goes to Atlas (maps, notes, sources, people), time-bound notes to Calendar, and anything you act on to Efforts, choosing On, Ongoing, Simmering or Sleeping by how much attention it gets now.',
  build(lang: Lang) {
    const d = DESCRIPTIONS[lang];
    return {
      version: 1,
      revision: 1,
      preset: 'ace',
      language: lang,
      mode: 'folders',
      inbox: '+',
      destinations: [
        { id: 'atlas-maps', path: 'Atlas/Maps', description: d.maps, match: [{ property: 'type', equals: ['map', 'moc'] }] },
        { id: 'atlas-notes', path: 'Atlas/Notes', description: d.notes, layout: 'subfolder-per-topic' },
        { id: 'atlas-sources', path: 'Atlas/Sources', description: d.sources, match: [{ property: 'type', equals: 'source' }] },
        { id: 'atlas-people', path: 'Atlas/People', description: d.people, match: [{ property: 'type', equals: 'person' }] },
        { id: 'calendar-logs', path: 'Calendar/Logs', description: d.logs, match: [{ property: 'type', equals: 'log' }] },
        {
          id: 'calendar-meetings',
          path: 'Calendar/Meetings',
          description: d.meetings,
          match: [{ property: 'type', equals: 'meeting' }, { filename: '^\\d{4}-\\d{2}-\\d{2} .+' }],
        },
        { id: 'efforts-on', path: 'Efforts/On', description: d.on, layout: 'subfolder-per-item', match: [{ property: 'status', equals: ['on', 'active'] }] },
        { id: 'efforts-ongoing', path: 'Efforts/Ongoing', description: d.ongoing, layout: 'subfolder-per-item', match: [{ property: 'status', equals: 'ongoing' }] },
        { id: 'efforts-simmering', path: 'Efforts/Simmering', description: d.simmering, layout: 'subfolder-per-item', match: [{ property: 'status', equals: ['simmering', 'paused'] }] },
        { id: 'efforts-sleeping', path: 'Efforts/Sleeping', description: d.sleeping, layout: 'subfolder-per-item', match: [{ property: 'status', equals: ['sleeping', 'done'] }] },
      ],
      system: { attachments: 'x/Attachments', templates: 'x/Templates', daily: { path: 'Calendar/Daily', filename: 'YYYY-MM-DD' } },
      ignore: defaultIgnore('x/Templates'),
      conventions: { links: { relatedHeading: lang === 'cs' ? '## Související' : '## Related' } },
      mocs: { enabled: true, perDestination: false, folder: 'Atlas/Maps' },
      drift: { inboxMaxAgeDays: 14, checkOnStartup: false },
    };
  },
};
