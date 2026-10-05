import { COMMON, defaultIgnore, type Lang, type Preset } from './types';

/**
 * Topic folders: a shallow tree of subjects. The preset itself only knows a placeholder topic;
 * real topics come from the vault's existing folders (codify current structure) or, with an index,
 * from clustering.
 */
export const topics: Preset = {
  id: 'topics',
  label: 'Topic folders',
  summary: {
    en: 'This vault is organized in **topic folders**: each top-level folder is a subject, and notes live in the folder of their main topic. The tree stays shallow; maps of content connect notes across topics.',
    cs: 'Tento vault je uspořádaný do **tematických složek**: každá složka nejvyšší úrovně je jedno téma a poznámka leží ve složce svého hlavního tématu. Strom zůstává mělký; mapy obsahu propojují poznámky napříč tématy.',
  },
  guidance:
    'Choose the one topic folder that matches the main subject of the note. When none fits, abstain rather than forcing a weak match; new topics are proposed separately.',
  build(lang: Lang) {
    const c = COMMON[lang];
    return {
      version: 1,
      revision: 1,
      preset: 'topics',
      language: lang,
      mode: 'folders',
      inbox: c.inbox,
      destinations: [
        {
          id: 'notes',
          path: lang === 'cs' ? 'Poznámky' : 'Notes',
          description: lang === 'cs' ? 'Poznámky bez konkrétního tématu.' : 'Notes without a specific topic.',
          layout: 'subfolder-per-topic',
        },
      ],
      system: { attachments: c.attachments, templates: c.templates, daily: { path: c.daily, filename: 'YYYY-MM-DD' } },
      ignore: defaultIgnore(c.templates),
      conventions: { links: { relatedHeading: c.related } },
      mocs: { enabled: true, perDestination: true },
      drift: { inboxMaxAgeDays: 14, checkOnStartup: false },
    };
  },
};
