/**
 * Persona material for eval fixtures (PLAN §8.1): who the vault belongs to and what they write
 * about. Written by hand, synthetic only (invariant 7). The generator turns it into notes with
 * known labels; nothing here is a real person's notes.
 */
export interface Persona {
  id: string;
  language: 'en' | 'cs';
  entities: Entity[];
  books: Source[];
  clippings: Clipping[];
  people: Person[];
  /** Short lines for daily notes; `{link}` is replaced by a link to a note from that day's work. */
  daily: string[];
  /** Heading for the list of notes in a hub note. */
  hubHeading: string;
  /** Headings sprinkled into longer notes. */
  headings: string[];
}

export type EntityKind = 'project' | 'area' | 'resource' | 'course';

/** A project, area, resource topic or course: what a group of notes is about. */
export interface Entity {
  key: string;
  kind: EntityKind;
  /** Hub note title, and the subfolder name in item layouts. */
  name: string;
  /** Finished projects belong in the archive. */
  done?: boolean;
  /** Subject label: Topic-folders subfolder and the clustering ground truth. */
  topic: string;
  /** Johnny.Decimal destination id in the starter index (jd-11 …). */
  jd: string;
  /** One sentence for the hub note. */
  description: string;
  /** Titles of the entity's notes besides the hub. */
  titles: string[];
  /** Sentences the notes are composed from. */
  sentences: string[];
  /** Meeting titles (without the date prefix). */
  meetings?: string[];
  /** Entities whose hub notes this one's notes sometimes link to. */
  related?: string[];
}

/** A book note. */
export interface Source {
  title: string;
  topic: string;
  sentences: string[];
}

/** A saved web article. */
export interface Clipping {
  title: string;
  url: string;
  /** Entity whose topic the article is about. */
  entity: string;
  sentences: string[];
}

export interface Person {
  name: string;
  sentences: string[];
  /** Entity the person is involved in. */
  entity: string;
}
