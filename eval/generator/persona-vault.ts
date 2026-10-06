import { presetCharter } from '../../src/core/charter/presets';
import { COMMON } from '../../src/core/charter/presets/types';
import { DAILY, type FixtureDestination, type NoteKind, type NoteTruth, ROOT } from '../fixture/ground-truth';
import type { Entity, Persona } from './personas/types';
import { chance, mulberry32, pick, sample } from './random';

/** A note of the clean vault: content, the links it makes (by title) and its labels. */
export interface GeneratedNote {
  /** Path in the clean vault (PARA layout); messify moves most notes elsewhere. */
  path: string;
  title: string;
  frontmatter: Record<string, unknown>;
  /** Markdown body; links appear as `[[Title]]`. */
  body: string;
  /** Titles of the notes this note links to. */
  links: string[];
  truth: NoteTruth;
}

export interface PersonaVaultOptions {
  seed: number;
  /** Repeats each entity's notes this many times (with numbered titles) for larger fixtures. */
  scale: number;
  dailyNotes: number;
}

const WORDS = {
  en: { partOf: 'Part of', seeAlso: 'See also', books: 'Books', people: 'People', daily: 'Daily', project: 'Project', booksCategory: '[[Books]]', peopleCategory: '[[People]]' },
  cs: { partOf: 'Patří k', seeAlso: 'Viz také', books: 'Knihy', people: 'Lidé', daily: 'Deník', project: 'Projekt', booksCategory: '[[Knihy]]', peopleCategory: '[[Lidé]]' },
} as const;

/**
 * Builds the clean, well-organized vault of a persona (PLAN §8.1): hub notes and notes for every
 * project, area, resource and course, meetings, daily notes, books, clippings and people, filed in
 * PARA folders, with properties, tags and links, and labelled with where each method would put
 * them. Deterministic for a seed.
 */
export function generatePersonaVault(persona: Persona, options: PersonaVaultOptions): GeneratedNote[] {
  const random = mulberry32(options.seed);
  const words = WORDS[persona.language];
  const para = presetCharter('para', persona.language);
  const folder = (id: string): string => para.destinations.find((d) => d.id === id)?.path ?? id;
  const entityFolder = (entity: Entity): string => {
    const root = entity.kind === 'project' ? (entity.done ? folder('archive') : folder('projects')) : entity.kind === 'area' ? folder('areas') : folder('resources');
    return `${root}/${entity.name}`;
  };
  const byKey = new Map(persona.entities.map((entity) => [entity.key, entity]));
  const notes: GeneratedNote[] = [];
  const titles = new Set<string>();
  const unique = (title: string): string => {
    let candidate = title;
    for (let n = 2; titles.has(candidate.toLowerCase()); n++) candidate = `${title} ${n}`;
    titles.add(candidate.toLowerCase());
    return candidate;
  };
  const add = (note: Omit<GeneratedNote, 'title' | 'path'> & { title: string; folder: string }): GeneratedNote => {
    const title = unique(note.title);
    const generated: GeneratedNote = { ...note, title, path: `${note.folder}/${title}.md` };
    notes.push(generated);
    return generated;
  };

  // Hub notes first so other notes can link to them; their note lists are filled in at the end.
  const hubs = new Map<string, GeneratedNote>();
  const members = new Map<string, string[]>();
  for (const entity of persona.entities) {
    const hub = add({
      title: entity.name,
      folder: entityFolder(entity),
      frontmatter: hubProperties(entity, topicTag(entity.topic)),
      body: '',
      links: [],
      truth: truth(persona, entity.key, 'hub', entity.topic, entityDestinations(entity, 'hub')),
    });
    hubs.set(entity.key, hub);
    members.set(entity.key, []);
  }

  let day = 0;
  for (let round = 0; round < options.scale; round++) {
    for (const entity of persona.entities) {
      const hub = hubs.get(entity.key) as GeneratedNote;
      for (const base of entity.titles) {
        const title = round === 0 ? base : `${base} ${round + 1}`;
        const sentences = sample(random, entity.sentences, 3 + Math.floor(random() * 3));
        const links: string[] = [];
        const lines: string[] = [];
        if (chance(random, 0.4) && sentences.length > 3) {
          lines.push(sentences.slice(0, 2).join(' '), '', pick(random, persona.headings), sentences.slice(2).join(' '));
        } else {
          lines.push(sentences.join(' '));
        }
        if (chance(random, 0.6)) {
          lines.push('', `${words.partOf} [[${hub.title}]].`);
          links.push(hub.title);
        }
        const related = entity.related?.map((key) => hubs.get(key)).filter((n): n is GeneratedNote => n !== undefined) ?? [];
        if (related.length > 0 && chance(random, 0.3)) {
          const other = pick(random, related);
          lines.push('', `${words.seeAlso} [[${other.title}]].`);
          links.push(other.title);
        }
        const note = add({
          title,
          folder: entityFolder(entity),
          frontmatter: { type: 'note', ...(chance(random, 0.5) ? { tags: [topicTag(entity.topic)] } : {}) },
          body: lines.join('\n'),
          links,
          truth: truth(persona, entity.key, 'note', entity.topic, entityDestinations(entity, 'note')),
        });
        members.get(entity.key)?.push(note.title);
      }
      for (const meeting of entity.meetings ?? []) {
        const date = isoDate(20 + day++ * 3 + round * 40);
        const title = round === 0 ? `${date} ${meeting}` : `${date} ${meeting} ${round + 1}`;
        const note = add({
          title,
          folder: entityFolder(entity),
          frontmatter: { type: 'meeting', date },
          body: [sample(random, entity.sentences, 2).join(' '), '', `${words.project}: [[${hub.title}]]`].join('\n'),
          links: [hub.title],
          truth: truth(persona, entity.key, 'meeting', entity.topic, entityDestinations(entity, 'meeting')),
        });
        members.get(entity.key)?.push(note.title);
      }
    }
  }

  for (const book of persona.books) {
    add({
      title: book.title,
      folder: `${folder('resources')}/${words.books}`,
      frontmatter: { type: 'source', categories: [words.booksCategory] },
      body: book.sentences.join(' '),
      links: [],
      truth: truth(persona, 'books', 'source', book.topic, {
        para: { id: 'resources', subfolder: words.books },
        ace: { id: 'atlas-sources' },
        jd: { id: 'jd-32' },
        flat: { id: 'references' },
        topics: { id: 'notes', subfolder: book.topic },
      }),
    });
  }
  for (const clipping of persona.clippings) {
    const entity = byKey.get(clipping.entity);
    if (!entity) throw new Error(`Unknown entity ${clipping.entity}`);
    const hub = hubs.get(entity.key) as GeneratedNote;
    const linked = chance(random, 0.5);
    add({
      title: clipping.title,
      folder: entityFolder(entity),
      frontmatter: { type: 'source', source: clipping.url },
      body: [clipping.sentences.join(' '), ...(linked ? ['', `${words.seeAlso} [[${hub.title}]].`] : [])].join('\n'),
      links: linked ? [hub.title] : [],
      truth: truth(persona, entity.key, 'clipping', entity.topic, {
        ...entityDestinations(entity, 'note'),
        ace: { id: 'atlas-sources' },
        jd: { id: 'jd-23' },
        flat: { id: 'clippings' },
      }),
    });
  }
  for (const person of persona.people) {
    const entity = byKey.get(person.entity);
    if (!entity) throw new Error(`Unknown entity ${person.entity}`);
    const hub = hubs.get(entity.key) as GeneratedNote;
    add({
      title: person.name,
      folder: `${folder('resources')}/${words.people}`,
      frontmatter: { type: 'person', categories: [words.peopleCategory] },
      body: [person.sentences.join(' '), '', `${words.seeAlso} [[${hub.title}]].`].join('\n'),
      links: [hub.title],
      truth: truth(persona, 'people', 'person', words.people, {
        para: { id: 'resources', subfolder: words.people },
        ace: { id: 'atlas-people' },
        jd: { id: 'jd-23' },
        flat: { id: 'references' },
        topics: { id: 'notes', subfolder: words.people },
      }),
    });
  }

  const linkable = notes.filter((note) => note.truth.kind === 'note');
  const dailyFolder = COMMON[persona.language].daily;
  for (let i = 0; i < options.dailyNotes * options.scale; i++) {
    const links: string[] = [];
    const lines = sample(random, persona.daily, 2 + Math.floor(random() * 2)).map((line) => {
      if (!line.includes('{link}')) return `- ${line}`;
      const target = pick(random, linkable);
      links.push(target.title);
      return `- ${line.replace('{link}', `[[${target.title}]]`)}`;
    });
    add({
      title: isoDate(i * 2),
      folder: dailyFolder,
      frontmatter: {},
      body: lines.join('\n'),
      links,
      truth: truth(persona, 'daily', 'daily', words.daily, { para: { id: DAILY }, ace: { id: DAILY }, jd: { id: DAILY }, flat: { id: DAILY }, topics: { id: DAILY } }),
    });
  }

  for (const entity of persona.entities) {
    const hub = hubs.get(entity.key) as GeneratedNote;
    const list = members.get(entity.key) ?? [];
    hub.body = [entity.description, '', persona.hubHeading, ...list.map((title) => `- [[${title}]]`)].join('\n');
    hub.links = [...list];
  }
  return notes;
}

/** Where each method would file a note of an entity. */
function entityDestinations(entity: Entity, kind: 'hub' | 'note' | 'meeting'): NoteTruth['destinations'] {
  const item = (id: string): FixtureDestination => ({ id, subfolder: entity.name });
  let para: FixtureDestination;
  let ace: FixtureDestination;
  if (entity.kind === 'project') {
    para = item(entity.done ? 'archive' : 'projects');
    ace = item(entity.done ? 'efforts-sleeping' : 'efforts-on');
  } else if (entity.kind === 'area') {
    para = item('areas');
    ace = item('efforts-ongoing');
  } else {
    para = item('resources');
    ace = item('atlas-notes');
  }
  let jd: FixtureDestination = { id: entity.jd };
  if (kind === 'meeting') {
    ace = { id: 'calendar-meetings' };
    // Work meetings have their own category; a visit from the electrician stays with the home.
    if (entity.jd === 'jd-21') jd = { id: 'jd-22' };
  }
  return { para, ace, jd, flat: { id: ROOT }, topics: { id: 'notes', subfolder: entity.topic } };
}

function hubProperties(entity: Entity, tag: string): Record<string, unknown> {
  if (entity.kind === 'project') return { type: 'project', status: entity.done ? 'done' : 'active', tags: [tag] };
  if (entity.kind === 'area') return { type: 'area', tags: [tag] };
  return { type: 'resource', tags: [tag] };
}

function truth(persona: Persona, entity: string, kind: NoteKind, topic: string, destinations: NoteTruth['destinations']): NoteTruth {
  return { persona: persona.id, entity, kind, topic, destinations, isStub: false };
}

export function topicTag(topic: string): string {
  return topic
    .normalize('NFD')
    .replace(/\p{Mn}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/** ISO date `days` after 2026-01-05 (UTC, so time zones never shift it). */
function isoDate(days: number): string {
  return new Date(Date.UTC(2026, 0, 5 + days)).toISOString().slice(0, 10);
}

/** Renders a note as Markdown with YAML frontmatter (keys in insertion order). */
export function renderNote(frontmatter: Record<string, unknown>, body: string): string {
  const entries = Object.entries(frontmatter);
  if (entries.length === 0) return `${body}\n`;
  const yaml = entries.map(([key, value]) => `${key}: ${Array.isArray(value) ? `[${value.map(yamlScalar).join(', ')}]` : yamlScalar(value)}`);
  return `---\n${yaml.join('\n')}\n---\n${body}\n`;
}

function yamlScalar(value: unknown): string {
  const text = String(value);
  return /^[\p{L}\p{N}][\p{L}\p{N} ._-]*$/u.test(text) && !/^\d{4}-\d{2}-\d{2}$/.test(text) ? text : JSON.stringify(text);
}
