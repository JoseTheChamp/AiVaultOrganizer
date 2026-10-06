import { prepareNote } from '../embeddings/prepare';
import type { NoteRecord } from '../model/note';
import { fileName } from '../model/paths';
import { isPrivateNote } from '../model/privacy';

export type AgeBucket = 'this week' | 'this month' | 'this year' | 'older';

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
  /** A few organizing properties (type, status, categories…), as text. */
  properties: Record<string, string>;
  headings: string[];
  /** The start of the note's prose, cut at a word boundary. */
  excerpt: string;
  /** Titles of notes it links to. */
  links: string[];
  /** How long ago the note last changed, when the caller knows the time. */
  age: AgeBucket | null;
  /** Label of the cluster the note belongs to, when clustering ran. */
  cluster: string | null;
}

export interface CardOptions {
  excerptChars: number;
  headings: number;
  links: number;
}

export const DEFAULT_CARD: CardOptions = { excerptChars: 600, headings: 10, links: 10 };

/** Properties that say where a note belongs; everything else stays out of prompts. */
const CARD_PROPERTIES = ['type', 'status', 'categories', 'source', 'author', 'project', 'area', 'topic', 'date', 'created'];

export interface CardContext {
  /** Epoch ms used for the age bucket; left out (no age) when unknown, e.g. in replayed evals. */
  now?: number;
  cluster?: string;
}

/** A card for a note, or null for a private note. */
export function buildCard(note: NoteRecord, content: string, options: CardOptions = DEFAULT_CARD, context: CardContext = {}): NoteCard | null {
  if (isPrivateNote(note.frontmatter)) return null;
  const prepared = prepareNote(content, note.basename);
  const prose = prepared.sections.flatMap((section) => section.paragraphs).join(' ').replace(/\s+/g, ' ').trim();
  return {
    path: note.path,
    title: note.basename,
    folder: note.folder,
    tags: note.tags.slice(0, 10),
    properties: selectedProperties(note.frontmatter),
    headings: note.headings.slice(0, options.headings).map((heading) => heading.text),
    excerpt: cut(prose, options.excerptChars),
    links: note.outLinks.slice(0, options.links).map((path) => fileName(path).replace(/\.md$/i, '')),
    age: context.now === undefined ? null : ageBucket(note.mtime, context.now),
    cluster: context.cluster ?? null,
  };
}

/**
 * A card as a few labelled lines for a prompt; empty fields are left out. `extended` adds the
 * fields introduced after the first prompt versions (properties, age, cluster), so prompts that
 * existed before render exactly as they did.
 */
export function renderCard(card: NoteCard, excerptChars = Number.POSITIVE_INFINITY, extended = false): string {
  const lines = [`Title: ${card.title}`];
  if (extended && card.folder) lines.push(`Folder: ${card.folder}`);
  if (card.tags.length > 0) lines.push(`Tags: ${card.tags.map((tag) => `#${tag}`).join(' ')}`);
  if (extended) {
    const properties = Object.entries(card.properties);
    if (properties.length > 0) lines.push(`Properties: ${properties.map(([key, value]) => `${key}: ${value}`).join('; ')}`);
  }
  if (card.headings.length > 0) lines.push(`Headings: ${card.headings.join(' | ')}`);
  if (card.links.length > 0) lines.push(`Links to: ${card.links.join(', ')}`);
  if (extended && card.cluster) lines.push(`Group: ${card.cluster}`);
  if (extended && card.age) lines.push(`Last changed: ${card.age}`);
  const excerpt = cut(card.excerpt, excerptChars);
  if (excerpt) lines.push(`Text: ${excerpt}`);
  return lines.join('\n');
}

function selectedProperties(frontmatter: Readonly<Record<string, unknown>>): Record<string, string> {
  const byKey = new Map(Object.entries(frontmatter).map(([key, value]) => [key.toLowerCase(), value] as const));
  const result: Record<string, string> = {};
  for (const key of CARD_PROPERTIES) {
    const value = byKey.get(key);
    if (value === undefined || value === null || value === '') continue;
    const text = Array.isArray(value) ? (value as unknown[]).map(scalarText).join(', ') : scalarText(value);
    result[key] = text.length > 120 ? `${text.slice(0, 117)}…` : text;
  }
  return result;
}

function scalarText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value) ?? '';
}

export function ageBucket(mtime: number, now: number): AgeBucket {
  const days = (now - mtime) / 86_400_000;
  if (days < 7) return 'this week';
  if (days < 31) return 'this month';
  if (days < 366) return 'this year';
  return 'older';
}

function cut(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const slice = text.slice(0, limit);
  const space = slice.lastIndexOf(' ');
  return `${(space > limit * 0.6 ? slice.slice(0, space) : slice).trimEnd()}…`;
}
