import { describe, expect, it } from 'vitest';
import { parseNote } from '../../src/core/markdown/parse-note';
import { type GroundTruth, validateGroundTruth } from '../fixture/ground-truth';
import { generatePersonaVault, renderNote } from './persona-vault';
import { csStudent } from './personas/cs-student';
import { enDeveloper } from './personas/en-developer';

const options = { seed: 1, scale: 1, dailyNotes: 8 };

describe.each([enDeveloper, csStudent])('generatePersonaVault ($id)', (persona) => {
  const notes = generatePersonaVault(persona, options);

  it('is deterministic for a seed', () => {
    expect(generatePersonaVault(persona, options)).toEqual(notes);
    expect(generatePersonaVault(persona, { ...options, seed: 2 })).not.toEqual(notes);
  });

  it('produces a small vault of every kind of note with unique titles', () => {
    expect(notes.length).toBeGreaterThanOrEqual(70);
    expect(notes.length).toBeLessThanOrEqual(90);
    expect(new Set(notes.map((n) => n.title.toLowerCase())).size).toBe(notes.length);
    expect(new Set(notes.map((n) => n.truth.kind))).toEqual(new Set(['hub', 'note', 'meeting', 'daily', 'source', 'clipping', 'person']));
  });

  it('links only to notes that exist, and hubs list their notes', () => {
    const titles = new Set(notes.map((n) => n.title));
    for (const note of notes) {
      for (const link of note.links) expect(titles.has(link), `${note.title} → ${link}`).toBe(true);
      const written = parseNote(renderNote(note.frontmatter, note.body)).links.filter((l) => l.source !== 'frontmatter').map((l) => l.target);
      expect(written.sort()).toEqual([...note.links].sort());
    }
    const hub = notes.find((n) => n.truth.kind === 'hub' && n.truth.entity === persona.entities[0]?.key);
    expect(hub?.links.length).toBeGreaterThan(3);
  });

  it('labels every note with valid destinations for every method', () => {
    const truth: GroundTruth = {
      version: 1,
      fixture: 'clean',
      language: persona.language,
      seed: 1,
      notes: Object.fromEntries(notes.map((n) => [n.path, n.truth])),
      trueLinks: [],
      heldOutLinks: [],
    };
    expect(validateGroundTruth(truth, new Set(notes.map((n) => n.path)))).toEqual([]);
  });

  it('files the clean vault in PARA folders that match the labels', () => {
    for (const note of notes.filter((n) => n.truth.kind === 'note')) {
      const { para } = note.truth.destinations;
      expect(note.path.split('/')[1]).toBe(para.subfolder);
    }
    const daily = notes.filter((n) => n.truth.kind === 'daily');
    expect(daily.length).toBe(8);
    for (const note of daily) expect(note.title).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    for (const note of notes.filter((n) => n.truth.kind === 'meeting')) expect(note.title).toMatch(/^\d{4}-\d{2}-\d{2} /);
  });

  it('scales up by repeating notes with numbered titles', () => {
    const large = generatePersonaVault(persona, { ...options, scale: 3 });
    // Books, clippings and people are not repeated.
    expect(large.length).toBeGreaterThan(notes.length * 2.2);
    expect(new Set(large.map((n) => n.title.toLowerCase())).size).toBe(large.length);
  });
});

describe('renderNote', () => {
  it('writes YAML frontmatter that parses back, quoting dates and links', () => {
    const content = renderNote({ type: 'meeting', date: '2026-01-25', categories: ['[[Books]]'], tags: ['web-development'] }, 'Body');
    expect(content).toBe('---\ntype: meeting\ndate: "2026-01-25"\ncategories: ["[[Books]]"]\ntags: [web-development]\n---\nBody\n');
    expect(parseNote(content).frontmatter).toEqual({ type: 'meeting', date: '2026-01-25', categories: ['[[Books]]'], tags: ['web-development'] });
    expect(renderNote({}, 'Plain')).toBe('Plain\n');
  });
});
