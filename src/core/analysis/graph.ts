import type { NoteRecord } from '../model/note';

export interface GraphMetrics {
  /** Directed note → note links (each pair counted once). */
  edgeCount: number;
  /** Average number of distinct notes a note links to. */
  avgOutDegree: number;
  /** Notes nothing links to. */
  orphans: string[];
  /** Notes that link to nothing. */
  deadEnds: string[];
  /** Notes with neither incoming nor outgoing links. */
  isolated: string[];
  /** Weakly connected components; every isolated note is its own component. */
  componentCount: number;
  largestComponentSize: number;
  /** Best-connected notes by in + out degree. */
  hubs: { path: string; inDegree: number; outDegree: number }[];
}

export function computeGraphMetrics(notes: readonly NoteRecord[]): GraphMetrics {
  const orphans: string[] = [];
  const deadEnds: string[] = [];
  const isolated: string[] = [];
  let edgeCount = 0;
  for (const note of notes) {
    edgeCount += note.outLinks.length;
    if (note.inLinks.length === 0) orphans.push(note.path);
    if (note.outLinks.length === 0) deadEnds.push(note.path);
    if (note.inLinks.length === 0 && note.outLinks.length === 0) isolated.push(note.path);
  }

  const components = connectedComponents(notes);
  const hubs = notes
    .map((note) => ({ path: note.path, inDegree: note.inLinks.length, outDegree: note.outLinks.length }))
    .filter((hub) => hub.inDegree + hub.outDegree > 0)
    .sort((a, b) => b.inDegree + b.outDegree - (a.inDegree + a.outDegree) || a.path.localeCompare(b.path))
    .slice(0, 10);

  return {
    edgeCount,
    avgOutDegree: notes.length === 0 ? 0 : edgeCount / notes.length,
    orphans,
    deadEnds,
    isolated,
    componentCount: components.length,
    largestComponentSize: Math.max(0, ...components.map((component) => component.length)),
    hubs,
  };
}

/** Weakly connected components via union-find over the undirected link graph. */
export function connectedComponents(notes: readonly NoteRecord[]): string[][] {
  const parent = new Map<string, string>();
  for (const note of notes) parent.set(note.path, note.path);
  const find = (path: string): string => {
    let root = path;
    while (parent.get(root) !== root) root = parent.get(root) ?? root;
    let current = path;
    while (current !== root) {
      const next = parent.get(current) ?? root;
      parent.set(current, root);
      current = next;
    }
    return root;
  };
  for (const note of notes) {
    for (const target of note.outLinks) {
      if (!parent.has(target)) continue;
      const a = find(note.path);
      const b = find(target);
      if (a !== b) parent.set(a, b);
    }
  }
  const groups = new Map<string, string[]>();
  for (const note of notes) {
    const root = find(note.path);
    const group = groups.get(root) ?? [];
    group.push(note.path);
    groups.set(root, group);
  }
  return [...groups.values()];
}
