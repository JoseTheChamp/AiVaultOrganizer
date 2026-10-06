import { COMMON, defaultIgnore, type Lang, type Preset } from './types';

const ENGLISH_CATEGORIES = ['[[Books]]', '[[Movies]]', '[[People]]', '[[Places]]'];

/**
 * Category notes that mark a reference. Czech vaults often keep the English names of Steph Ango's
 * templates, so both spellings count there.
 */
const REFERENCE_CATEGORIES: Record<Lang, string[]> = {
  en: ENGLISH_CATEGORIES,
  cs: ['[[Knihy]]', '[[Filmy]]', '[[Lidé]]', '[[Místa]]', ...ENGLISH_CATEGORIES],
};

const TEXT: Record<Lang, Record<string, string>> = {
  en: {
    references: 'References',
    clippings: 'Clippings',
    categories: 'Categories',
    referencesDescription: 'Notes about things outside your own world: books, films, people and places.',
    clippingsDescription: 'Writing by others, saved from the web.',
    categoriesDescription: 'One note per category, each showing its members in a Bases view.',
  },
  cs: {
    references: 'Reference',
    clippings: 'Výstřižky',
    categories: 'Kategorie',
    referencesDescription: 'Poznámky o věcech mimo tvůj svět: knihy, filmy, lidé a místa.',
    clippingsDescription: 'Texty jiných autorů uložené z webu.',
    categoriesDescription: 'Jedna poznámka na kategorii, každá ukazuje své členy v pohledu Bases.',
  },
};

/**
 * Flat + categories (Steph Ango): very few folders, personal notes live in the vault root, and a
 * `categories` property (links to category notes) carries the classification. In this mode the root
 * is a valid home for notes; moving is limited to references, clippings and category notes.
 */
export const flatCategories: Preset = {
  id: 'flat-categories',
  label: 'Flat + categories',
  summary: {
    en: 'This vault is **flat with categories** (Steph Ango\'s approach): your own notes live in the root, and a `categories` property linking to category notes says what each note is. Folders are only for things outside your world (references), writing by others (clippings), daily notes and attachments.',
    cs: 'Tento vault je **plochý s kategoriemi** (přístup Stepha Anga): vlastní poznámky leží v kořeni a vlastnost `categories` s odkazy na poznámky kategorií říká, čím každá poznámka je. Složky slouží jen pro věci mimo tvůj svět (reference), texty jiných (výstřižky), denní poznámky a přílohy.',
  },
  guidance:
    'Prefer properties over folders: decide which category links a note should list in its categories property. Only notes about external things (books, people, places, films) go to References, and saved web articles to Clippings.',
  build(lang: Lang) {
    const t = TEXT[lang];
    const c = COMMON[lang];
    return {
      version: 1,
      revision: 1,
      preset: 'flat-categories',
      language: lang,
      mode: 'properties',
      destinations: [
        {
          id: 'references',
          path: t.references,
          description: t.referencesDescription,
          match: [{ property: 'categories', equals: REFERENCE_CATEGORIES[lang] }],
        },
        { id: 'clippings', path: t.clippings, description: t.clippingsDescription, match: [{ property: 'source', exists: true }] },
        { id: 'categories', path: t.categories, description: t.categoriesDescription, match: [{ property: 'type', equals: 'category' }] },
      ],
      system: { attachments: c.attachments, templates: c.templates, daily: { path: c.daily, filename: 'YYYY-MM-DD' } },
      ignore: defaultIgnore(c.templates),
      conventions: {
        properties: { required: ['categories'] },
        tags: { style: 'lowercase-kebab', nested: true },
        links: { relatedHeading: c.related },
      },
      mocs: { enabled: true, perDestination: false, folder: t.categories },
      drift: { inboxMaxAgeDays: 14, checkOnStartup: false },
    };
  },
};
