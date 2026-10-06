import { prepareNote } from '../embeddings/prepare';
import type { NoteRecord } from '../model/note';
import { fileName } from '../model/paths';
import { isPrivateNote } from '../model/privacy';

/**
 * What a language model sees of a note (PLAN §7.2): a compact, deterministic summary, never the
 * whole note. Built only for notes that may go to a model: private notes get no card.
 */
export interface NoteCard {
  path: string;
  title: string;
  /** Folder the note is in now ('' for the root). */
  folder: string;
  tags: string[];
  headings: string[];
  /** The start of the note's prose, cut at a word boundary. */
  excerpt: string;
  /** Titles of notes it links to. */
  links: string[];
}

export interface CardOptions {
  excerptChars: number;
  headings: number;
  links: number;
}

export const DEFAULT_CARD: CardOptions = { excerptChars: 600, headings: 10, links: 10 };

/** A card for a note, or null for a private note. */
export function buildCard(note: NoteRecord, content: string, options: CardOptions = DEFAULT_CARD): NoteCard | null {
  if (isPrivateNote(note.frontmatter)) return null;
  const prepared = prepareNote(content, note.basename);
  const prose = prepared.sections.flatMap((section) => section.paragraphs).join(' ').replace(/\s+/g, ' ').trim();
  return {
    path: note.path,
    title: note.basename,
    folder: note.folder,
    tags: note.tags.slice(0, 10),
    headings: note.headings.slice(0, options.headings).map((heading) => heading.text),
    excerpt: cut(prose, options.excerptChars),
    links: note.outLinks.slice(0, options.links).map((path) => fileName(path).replace(/\.md$/i, '')),
  };
}

/** A card as a few labelled lines for a prompt; empty fields are left out. */
export function renderCard(card: NoteCard, excerptChars = Number.POSITIVE_INFINITY): string {
  const lines = [`Title: ${card.title}`];
  if (card.tags.length > 0) lines.push(`Tags: ${card.tags.map((tag) => `#${tag}`).join(' ')}`);
  if (card.headings.length > 0) lines.push(`Headings: ${card.headings.join(' | ')}`);
  if (card.links.length > 0) lines.push(`Links to: ${card.links.join(', ')}`);
  const excerpt = cut(card.excerpt, excerptChars);
  if (excerpt) lines.push(`Text: ${excerpt}`);
  return lines.join('\n');
}

function cut(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const slice = text.slice(0, limit);
  const space = slice.lastIndexOf(' ');
  return `${(space > limit * 0.6 ? slice.slice(0, space) : slice).trimEnd()}…`;
}
