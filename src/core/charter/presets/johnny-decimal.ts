import type { CharterInput } from '../schema';
import { COMMON, defaultIgnore, type Lang, type Preset } from './types';

interface Area {
  id: string;
  name: Record<Lang, string>;
  /** What belongs in each category: the classifier sees only these words, so they must be specific. */
  categories: { id: string; name: Record<Lang, string>; about: Record<Lang, string> }[];
}

/** A small starter index; users rename and extend it in the charter (the JD index is theirs). */
const INDEX: Area[] = [
  {
    id: '00-09',
    name: { en: 'System', cs: 'Systém' },
    categories: [{ id: '00', name: { en: 'Index', cs: 'Rejstřík' }, about: { en: 'The index of all numbers, and notes about how the vault itself works.', cs: 'Rejstřík všech čísel a poznámky o tom, jak funguje samotný vault.' } }],
  },
  {
    id: '10-19',
    name: { en: 'Life admin', cs: 'Osobní agenda' },
    categories: [
      { id: '11', name: { en: 'Finance', cs: 'Finance' }, about: { en: 'Money: budgets, accounts, investments, taxes and insurance.', cs: 'Peníze: rozpočty, účty, investice, daně a pojištění.' } },
      { id: '12', name: { en: 'Health', cs: 'Zdraví' }, about: { en: 'Health and fitness: training, sport events, exercise, medical records and sleep.', cs: 'Zdraví a kondice: trénink, sportovní akce, cvičení, zdravotní záznamy a spánek.' } },
      { id: '13', name: { en: 'Home', cs: 'Domov' }, about: { en: 'The home: maintenance, repairs, appliances, furnishing and projects around the house.', cs: 'Domácnost: údržba, opravy, spotřebiče, zařizování a projekty kolem bydlení.' } },
    ],
  },
  {
    id: '20-29',
    name: { en: 'Work', cs: 'Práce' },
    categories: [
      { id: '21', name: { en: 'Projects', cs: 'Projekty' }, about: { en: 'Work and study projects with a goal and an end, with all their notes.', cs: 'Pracovní a studijní projekty s cílem a koncem, se všemi jejich poznámkami.' } },
      { id: '22', name: { en: 'Meetings', cs: 'Schůzky' }, about: { en: 'Meetings about work projects: agendas, minutes and follow-ups.', cs: 'Schůzky k pracovním projektům: program, zápisy a úkoly z nich.' } },
      { id: '23', name: { en: 'Reference', cs: 'Reference' }, about: { en: 'Reference material on any subject, at work or at home: topics you keep notes on (such as cooking, photography or programming), saved articles and people.', cs: 'Referenční materiál na jakékoli téma, pracovní i osobní: témata, o kterých si vedeš poznámky (například vaření, fotografie nebo programování), uložené články a lidé.' } },
    ],
  },
  {
    id: '30-39',
    name: { en: 'Learning', cs: 'Vzdělávání' },
    categories: [
      { id: '31', name: { en: 'Courses', cs: 'Kurzy' }, about: { en: 'Courses and classes, with their lecture notes.', cs: 'Kurzy a předměty s poznámkami z výuky.' } },
      { id: '32', name: { en: 'Books', cs: 'Knihy' }, about: { en: 'One note per book you have read.', cs: 'Jedna poznámka na každou přečtenou knihu.' } },
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
        description: `${area.name[lang]}: ${category.name[lang]}. ${category.about[lang]}`,
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
      // Daily notes live in the system area, next to the inbox, outside the numbered categories.
      system: { attachments: c.attachments, templates: c.templates, daily: { path: `00-09 ${INDEX[0]?.name[lang] ?? 'System'}/02 ${c.daily}`, filename: 'YYYY-MM-DD' } },
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
