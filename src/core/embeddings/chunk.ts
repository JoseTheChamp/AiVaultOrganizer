import { estimateTokens } from '../ai/budget';
import type { PreparedNote, Section } from './prepare';

/** A piece of a note small enough to embed, prefixed with the note title for context. */
export interface Chunk {
  text: string;
  /** Estimated tokens of `text`; also the chunk's weight in the note vector. */
  tokens: number;
  /** Heading trail of the section the chunk starts in (`A > B`), or null before the first heading. */
  heading: string | null;
}

export interface ChunkOptions {
  /** Upper bound per chunk; embedding models handle 512+ tokens, and smaller chunks stay focused. */
  maxTokens: number;
  /** Words repeated at the start of a chunk that continues the same section. */
  overlapTokens: number;
  /** Long notes are cut after this many chunks, which bounds the cost of embedding one note. */
  maxChunks: number;
}

export const DEFAULT_CHUNK_OPTIONS: ChunkOptions = { maxTokens: 400, overlapTokens: 40, maxChunks: 24 };

interface Unit {
  text: string;
  section: Section;
  /** Whether this unit is the section's heading line. */
  heading: boolean;
}

/**
 * Splits a prepared note into heading-aware chunks (PLAN §7.3). Consecutive small sections share a
 * chunk; a long section is split at paragraphs, then lines, then words, with a little overlap so a
 * thought cut in two still appears whole in one chunk. Every chunk starts with the note title (and
 * the heading trail when it starts mid-section), because a fragment alone often lacks its topic.
 */
export function chunkNote(note: PreparedNote, options: ChunkOptions = DEFAULT_CHUNK_OPTIONS): Chunk[] {
  const units = toUnits(note, options.maxTokens);
  if (units.length === 0) return [{ text: note.title, tokens: estimateTokens(note.title), heading: null }];

  const chunks: Chunk[] = [];
  let header = '';
  let entries: Unit[] = [];
  // Measured on the real text, so separators and the header count against the limit too.
  const textWith = (extra: string): string => [header, ...entries.map((entry) => entry.text), extra].filter((line) => line !== '').join('\n');

  const start = (unit: Unit): void => {
    // A chunk that starts inside a section repeats the trail; one that starts at a heading has it.
    header = unit.heading || unit.section.trail.length === 0 ? note.title : `${note.title}\n${unit.section.trail.join(' > ')}`;
  };
  const flush = (): void => {
    const first = entries[0];
    if (!first) return;
    const text = textWith('');
    const trail = first.section.trail.join(' > ');
    chunks.push({ text, tokens: estimateTokens(text), heading: trail === '' ? null : trail });
    entries = [];
  };

  for (const unit of units) {
    if (chunks.length >= options.maxChunks) break;
    if (entries.length > 0 && estimateTokens(textWith(unit.text)) > options.maxTokens) {
      // A heading never ends a chunk: it moves to the chunk where its text starts.
      const carried: Unit[] = [];
      while (entries.length > 1 && entries.at(-1)?.heading === true && entries.at(-1)?.section === unit.section) {
        const heading = entries.pop();
        if (heading) carried.unshift(heading);
      }
      const sameSection = entries.filter((entry) => entry.section === unit.section && !entry.heading).map((entry) => entry.text);
      flush();
      start(carried[0] ?? unit);
      entries.push(...carried);
      // Overlap only when the chunk continues a section that the previous chunk had already started.
      if (carried.length === 0 && !unit.heading && sameSection.length > 0) {
        const spare = options.maxTokens - estimateTokens(textWith(unit.text)) - 1;
        const overlap = tailWords(sameSection.join(' '), Math.min(options.overlapTokens, spare));
        if (overlap) entries.push({ text: overlap, section: unit.section, heading: false });
      }
    }
    if (entries.length === 0) start(unit);
    entries.push(unit);
  }
  if (chunks.length < options.maxChunks) flush();
  return chunks;
}

/**
 * Heading lines and paragraphs. Anything too big is split into pieces that fit in a chunk together
 * with the title and the section's trail, so every piece can start a chunk of its own.
 */
function toUnits(note: PreparedNote, maxTokens: number): Unit[] {
  const units: Unit[] = [];
  for (const section of note.sections) {
    // The full trail, so a chunk that starts at a sub-heading still says what it is part of.
    const trail = section.trail.join(' > ');
    if (trail) units.push({ text: trail, section, heading: true });
    const room = Math.max(16, maxTokens - estimateTokens(`${note.title}\n${trail}\n`) - 1);
    for (const paragraph of section.paragraphs) {
      for (const piece of fit(paragraph, room)) units.push({ text: piece, section, heading: false });
    }
  }
  return units;
}

/** Splits text into pieces of at most `room` tokens: by lines, then sentences, then words. */
function fit(text: string, room: number): string[] {
  if (estimateTokens(text) <= room) return [text];
  const separators = [/\n/, /(?<=[.!?…])\s+/, /\s+/];
  for (const separator of separators) {
    const parts = text.split(separator).filter((part) => part.trim() !== '');
    if (parts.length > 1) return pack(parts, room, separator.source === '\\n' ? '\n' : ' ');
  }
  return hardSplit(text, room);
}

/** Greedily joins parts into pieces that fit, recursing into parts that are too big on their own. */
function pack(parts: string[], room: number, joiner: string): string[] {
  const pieces: string[] = [];
  let current = '';
  for (const part of parts) {
    if (estimateTokens(part) > room) {
      if (current) pieces.push(current);
      current = '';
      pieces.push(...fit(part, room));
      continue;
    }
    const joined = current ? `${current}${joiner}${part}` : part;
    if (estimateTokens(joined) > room && current) {
      pieces.push(current);
      current = part;
    } else {
      current = joined;
    }
  }
  if (current) pieces.push(current);
  return pieces;
}

/** Last resort for a single enormous "word" (a long hash, base64): cut by characters. */
function hardSplit(text: string, room: number): string[] {
  const size = Math.max(1, room * 2);
  const pieces: string[] = [];
  for (let i = 0; i < text.length; i += size) pieces.push(text.slice(i, i + size));
  return pieces;
}

function tailWords(text: string, tokens: number): string {
  if (tokens <= 0) return '';
  const words = text.split(/\s+/).filter((word) => word !== '');
  const tail: string[] = [];
  let used = 0;
  for (let i = words.length - 1; i >= 0; i--) {
    const word = words[i] ?? '';
    used += estimateTokens(`${word} `);
    if (used > tokens) break;
    tail.unshift(word);
  }
  return tail.join(' ');
}
