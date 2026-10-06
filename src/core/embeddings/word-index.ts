import { gunzipSync, gzipSync, strFromU8, strToU8 } from 'fflate';
import * as z from 'zod';
import type { NoteRecord } from '../model/note';
import type { StoragePort } from '../ports';
import { type IndexOptions, type IndexReport, planIndexUpdate } from './indexing';
import { prepareNote, TEXT_VERSION } from './prepare';
import { countTerms, type TermCounts, TfidfModel } from './tfidf';

const KEY = 'cache/index/words.json.gz';
/** Longer notes keep their most frequent terms only; the tail adds size, not similarity. */
const MAX_TERMS_PER_NOTE = 300;

const storedSchema = z.object({
  version: z.literal(1),
  textVersion: z.number().int(),
  entries: z.record(z.string(), z.object({ hash: z.string(), terms: z.record(z.string(), z.number()) })),
});

type Stored = z.infer<typeof storedSchema>;

/**
 * Term counts per note for Tier 0 similarity, kept in the plugin cache (gzipped JSON) and updated
 * incrementally: only notes whose content hash changed are read again. Building the TF-IDF model
 * from the counts is fast, so it is not stored.
 */
export class WordIndex {
  private stored: Stored | null = null;

  constructor(private readonly storage: StoragePort) {}

  async update(notes: readonly NoteRecord[], read: (path: string) => Promise<string>, options: IndexOptions = {}): Promise<IndexReport> {
    const stored = await this.load();
    const plan = planIndexUpdate(notes, new Map(Object.entries(stored.entries).map(([path, entry]) => [path, entry.hash])));
    for (const path of plan.removed) delete stored.entries[path];

    let indexed = 0;
    let cancelled = false;
    for (const note of plan.stale) {
      if (options.isCancelled?.()) {
        cancelled = true;
        break;
      }
      const content = await read(note.path);
      stored.entries[note.path] = { hash: note.contentHash, terms: topTerms(countTerms(prepareNote(content, note.basename), note.tags)) };
      indexed++;
      if (indexed % 50 === 0 || indexed === plan.stale.length) options.onProgress?.({ done: indexed, total: plan.stale.length });
    }
    if (indexed > 0 || plan.removed.length > 0) await this.save(stored);
    return { indexed, unchanged: plan.unchanged, removed: plan.removed.length, remaining: plan.stale.length - indexed, cancelled, tokens: 0 };
  }

  /** TF-IDF over the indexed notes, optionally limited to `paths`. */
  async model(paths?: ReadonlySet<string>): Promise<TfidfModel> {
    const stored = await this.load();
    const documents = new Map<string, TermCounts>();
    for (const [path, entry] of Object.entries(stored.entries)) if (!paths || paths.has(path)) documents.set(path, entry.terms);
    return TfidfModel.build(documents);
  }

  async clear(): Promise<void> {
    this.stored = null;
    await this.storage.remove(KEY);
  }

  private async load(): Promise<Stored> {
    if (this.stored) return this.stored;
    const empty: Stored = { version: 1, textVersion: TEXT_VERSION, entries: {} };
    const bytes = await this.storage.read(KEY);
    let parsed: Stored = empty;
    if (bytes) {
      try {
        const result = storedSchema.safeParse(JSON.parse(strFromU8(gunzipSync(bytes))));
        if (result.success && result.data.textVersion === TEXT_VERSION) parsed = result.data;
      } catch {
        // A damaged cache is rebuilt from the notes.
      }
    }
    this.stored = parsed;
    return parsed;
  }

  private async save(stored: Stored): Promise<void> {
    await this.storage.write(KEY, gzipSync(strToU8(JSON.stringify(stored)), { level: 6 }));
  }
}

function topTerms(counts: TermCounts): TermCounts {
  const entries = Object.entries(counts);
  if (entries.length <= MAX_TERMS_PER_NOTE) return counts;
  entries.sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  return Object.fromEntries(entries.slice(0, MAX_TERMS_PER_NOTE));
}
