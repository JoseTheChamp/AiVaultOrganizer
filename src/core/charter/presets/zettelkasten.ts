import { COMMON, defaultIgnore, type Lang, type Preset } from './types';

const TEXT: Record<Lang, Record<string, string>> = {
  en: {
    fleeting: 'Fleeting',
    literature: 'Literature',
    permanent: 'Zettelkasten',
    hubs: 'Hubs',
    fleetingDescription: 'Quick, unprocessed thoughts to turn into permanent notes or discard.',
    literatureDescription: 'Notes about a source, in your own words, with a reference to it.',
    permanentDescription: 'Atomic notes: one idea each, written to stand alone, densely linked.',
    hubsDescription: 'Structure notes that organize permanent notes into lines of thought.',
  },
  cs: {
    fleeting: 'Pomíjivé',
    literature: 'Literární',
    permanent: 'Zettelkasten',
    hubs: 'Rozcestníky',
    fleetingDescription: 'Rychlé nezpracované myšlenky, které se stanou trvalými poznámkami, nebo zmizí.',
    literatureDescription: 'Poznámky ke zdroji vlastními slovy, s odkazem na zdroj.',
    permanentDescription: 'Atomické poznámky: každá jedna myšlenka, srozumitelná samostatně, hustě propojená.',
    hubsDescription: 'Strukturní poznámky, které řadí trvalé poznámky do myšlenkových linií.',
  },
};

export const zettelkasten: Preset = {
  id: 'zettelkasten',
  label: 'Zettelkasten',
  summary: {
    en: 'This vault uses a **Zettelkasten**: knowledge grows as atomic, densely linked notes. Fleeting notes are captured quickly, literature notes summarize sources in your own words, permanent notes hold one idea each, and hub notes give structure. Links matter more than folders.',
    cs: 'Tento vault používá **Zettelkasten**: znalosti rostou jako atomické, hustě propojené poznámky. Pomíjivé poznámky zachytávají nápady, literární poznámky shrnují zdroje vlastními slovy, trvalé poznámky nesou každá jednu myšlenku a rozcestníky dávají strukturu. Odkazy jsou důležitější než složky.',
  },
  guidance:
    'Classify by note kind: unprocessed jottings are fleeting, notes about a specific source are literature notes, self-contained single ideas are permanent notes, and notes that mostly organize links to other notes are hubs.',
  build(lang: Lang) {
    const t = TEXT[lang];
    const c = COMMON[lang];
    return {
      version: 1,
      revision: 1,
      preset: 'zettelkasten',
      language: lang,
      mode: 'hybrid',
      destinations: [
        { id: 'fleeting', path: t.fleeting, description: t.fleetingDescription, match: [{ property: 'type', equals: 'fleeting' }] },
        {
          id: 'literature',
          path: t.literature,
          description: t.literatureDescription,
          match: [{ property: 'type', equals: 'literature' }],
        },
        {
          id: 'permanent',
          path: t.permanent,
          description: t.permanentDescription,
          match: [{ property: 'type', equals: 'permanent' }, { filename: '^\\d{12,14}(?:\\s|$)' }],
        },
        { id: 'hubs', path: t.hubs, description: t.hubsDescription, match: [{ property: 'type', equals: ['hub', 'structure'] }] },
      ],
      system: { attachments: c.attachments, templates: c.templates },
      ignore: defaultIgnore(c.templates),
      conventions: { links: { relatedHeading: c.related, minOutgoing: 1 } },
      drift: { inboxMaxAgeDays: 14, checkOnStartup: false },
    };
  },
};
