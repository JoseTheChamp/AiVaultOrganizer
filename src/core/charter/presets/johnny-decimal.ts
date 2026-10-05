import type { CharterInput } from '../schema';
import { COMMON, defaultIgnore, type Lang, type Preset } from './types';

interface Area {
  id: string;
  name: Record<Lang, string>;
  categories: { id: string; name: Record<Lang, string> }[];
}

/** A small starter index; users rename and extend it in the charter (the JD index is theirs). */
const INDEX: Area[] = [
  {
    id: '00-09',
    name: { en: 'System', cs: 'Systém' },
    categories: [{ id: '00', name: { en: 'Index', cs: 'Rejstřík' } }],
  },
  {
    id: '10-19',
    name: { en: 'Life admin', cs: 'Osobní agenda' },
    categories: [
      { id: '11', name: { en: 'Finance', cs: 'Finance' } },
      { id: '12', name: { en: 'Health', cs: 'Zdraví' } },
      { id: '13', name: { en: 'Home', cs: 'Domov' } },
    ],
  },
  {
    id: '20-29',
    name: { en: 'Work', cs: 'Práce' },
    categories: [
      { id: '21', name: { en: 'Projects', cs: 'Projekty' } },
      { id: '22', name: { en: 'Meetings', cs: 'Schůzky' } },
      { id: '23', name: { en: 'Reference', cs: 'Reference' } },
    ],
  },
  {
    id: '30-39',
    name: { en: 'Learning', cs: 'Vzdělávání' },
    categories: [
      { id: '31', name: { en: 'Courses', cs: 'Kurzy' } },
      { id: '32', name: { en: 'Books', cs: 'Knihy' } },
    ],
  },
];

export const johnnyDecimal: Preset = {
  id: 'johnny-decimal',
  label: 'Johnny.Decimal',
  summary: {
    en: 'This vault uses **Johnny.Decimal**: every item has a permanent number. Up to ten areas (10-19, 20-29, …) hold up to ten categories each (11, 12, …), and every note gets an ID such as 11.01. The index below is the map of all numbers.',
    cs: 'Tento vault používá **Johnny.Decimal**: každá položka má trvalé číslo. Až deset oblastí (10-19, 20-29, …) obsahuje až deset kategorií (11, 12, …) a každá poznámka dostane ID, například 11.01. Rejstřík níže je mapou všech čísel.',
  },
  guidance:
    'Pick the single category whose name and description fit the note best; IDs are allocated by the plugin, never by the model. Notes that already start with an ID like "11.03" belong to that category.',
  build(lang: Lang): CharterInput {
    const c = COMMON[lang];
    const destinations = INDEX.flatMap((area) =>
      area.categories.map((category) => ({
        id: `jd-${category.id}`,
        path: `${area.id} ${area.name[lang]}/${category.id} ${category.name[lang]}`,
        description: `${area.name[lang]}: ${category.name[lang]}`,
        match: [{ filename: `^${category.id}\\.\\d{2}(?:\\s|$)` }],
      })),
    );
    return {
      version: 1,
      revision: 1,
      preset: 'johnny-decimal',
      language: lang,
      mode: 'folders',
      inbox: `00-09 ${INDEX[0]?.name[lang] ?? 'System'}/01 Inbox`,
      destinations,
      system: { attachments: c.attachments, templates: c.templates },
      ignore: defaultIgnore(c.templates),
      conventions: { filenames: { style: 'keep' }, links: { relatedHeading: c.related } },
      drift: { inboxMaxAgeDays: 14, checkOnStartup: false },
      jd: {
        areas: INDEX.map((area) => ({
          id: area.id,
          name: area.name[lang],
          categories: area.categories.map((category) => ({ id: category.id, name: category.name[lang] })),
        })),
      },
    };
  },
};
