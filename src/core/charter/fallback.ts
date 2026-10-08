import type { VaultSnapshot } from '../model/note';
import { isInFolder } from '../model/paths';
import { toLang } from './presets/index';
import { type Charter, charterSchema, type DestinationInput } from './schema';

const OTHER = {
  en: { name: 'Other', description: 'Notes that fit no other folder. Each time you organize, the plugin tries to place them again.' },
  cs: { name: 'Ostatní', description: 'Poznámky, které nepatří do žádné jiné složky. Při každém uspořádání je plugin zkusí zařadit znovu.' },
} as const;

/**
 * The charter with a fallback destination for notes nothing else fits (ADR 0010), unless it has one:
 * a folder "Other" (in Johnny.Decimal a category of area 90-99, "90-99 Other/91 Other"), or a
 * category `[[Other]]` where notes live in the root. A destination already using that folder becomes
 * the fallback instead.
 */
export function withFallback(charter: Charter): Charter {
  if (charter.destinations.some((destination) => destination.fallback)) return charter;
  const { name, description } = OTHER[toLang(charter.language)];
  const { path, jd } = place(charter, name);

  const existing = charter.destinations.findIndex((destination) => destination.path?.toLowerCase() === path.toLowerCase());
  if (existing >= 0) {
    return { ...charter, destinations: charter.destinations.map((destination, index) => (index === existing ? { ...destination, fallback: true } : destination)) };
  }

  const ids = new Set(charter.destinations.map((destination) => destination.id));
  let id = 'other';
  for (let n = 2; ids.has(id); n++) id = `other-${n}`;
  const where = charter.mode === 'properties' ? { category: `[[${name}]]` } : { path };
  const fallback: DestinationInput = { id, ...where, fallback: true, description };
  return charterSchema.parse({ ...charter, destinations: [...charter.destinations, fallback], ...(jd ? { jd } : {}) });
}

/** The notes waiting in the charter's fallback (in its folder, or with its category), and where that is. */
export function waitingInFallback(snapshot: VaultSnapshot, charter: Charter): { notes: number; where: string } | null {
  const fallback = charter.destinations.find((destination) => destination.fallback);
  if (!fallback) return null;
  const category = fallback.category?.toLowerCase();
  const notes = snapshot.notes.filter((note) => {
    if (fallback.path) return isInFolder(note.path, fallback.path);
    const categories = note.frontmatter.categories;
    const list: unknown[] = Array.isArray(categories) ? categories : [categories];
    return list.some((value) => typeof value === 'string' && value.toLowerCase() === category);
  }).length;
  return { notes, where: fallback.path ?? fallback.category ?? fallback.id };
}

/** Where the fallback goes, and the Johnny.Decimal index that lists it. */
function place(charter: Charter, name: string): { path: string; jd: Charter['jd'] } {
  if (!charter.jd) return { path: name, jd: undefined };
  const area = charter.jd.areas.find((candidate) => candidate.id === '90-99');
  if (!area) return { path: `90-99 ${name}/91 ${name}`, jd: { areas: [...charter.jd.areas, { id: '90-99', name, categories: [{ id: '91', name }] }] } };
  // An area 90-99 of the user's own keeps its name; Other takes its next free number.
  const used = new Set(area.categories.map((category) => category.id));
  const free = ['91', '92', '93', '94', '95', '96', '97', '98', '99'].find((id) => !used.has(id));
  if (!free) return { path: name, jd: charter.jd };
  const areas = charter.jd.areas.map((candidate) => (candidate === area ? { ...candidate, categories: [...candidate.categories, { id: free, name }] } : candidate));
  return { path: `90-99 ${area.name}/${free} ${name}`, jd: { areas } };
}
