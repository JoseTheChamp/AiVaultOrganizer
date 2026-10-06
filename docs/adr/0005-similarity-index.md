# 0005. Similarity index

- Status: Accepted
- Date: 2026-10-06

## Context

Similarity underpins link suggestions, placing notes by example, duplicate detection and
clustering (PLAN §7.3–7.5). It has to:

- work with no AI at all and get better with an embedding model;
- stay cheap on vaults of thousands of notes;
- survive restarts without re-embedding everything;
- never send private notes anywhere;
- never block Obsidian's UI.

Users' vaults often mix languages (English and Czech is the plugin's first target), which word
matching cannot bridge.

## Decision

**Two tiers behind one engine.** `SimilarityEngine` answers from embeddings when an embedding model
is configured and usable. Word statistics answer in every other case:

- no model is configured;
- the note is private;
- the user declines sending notes to a cloud provider;
- indexing is stopped;
- the provider fails.

The result says which method answered and why. The UI shows that, so users always get an answer and
know what kind it is.

**Text preparation** (`prepare.ts`):

- The prepared text drops frontmatter, code, comments, embeds and URLs, keeps the visible text of
  links, and splits the body into sections by heading trail.
- Chunks are packed to at most 400 estimated tokens. Each chunk starts with the note title and its
  heading trail, a heading never ends a chunk, and there is a small overlap inside a section only.
  Notes are capped at 24 chunks.
- `TEXT_VERSION` versions all of this. Changing it rebuilds every index rather than mixing old and new
  entries.

**Word statistics** (`tfidf.ts`, `word-index.ts`):

- Weighting is TF-IDF with sublinear term frequency and smoothed IDF, searched by cosine through an
  inverted index.
- Terms fold diacritics, drop English and Czech stopwords, and are truncated to six letters. That is a
  crude stemmer, but it suits heavily inflected Czech without a language-specific one.
- Titles count three times and tags twice.
- Per-note term counts (up to 300 terms) are cached as gzipped JSON. The model is rebuilt from them in
  milliseconds.

**Embeddings** (`embedding-index.ts`, `vector-store.ts`):

- A note vector is the length-weighted mean of its chunk vectors, normalized to unit length, so cosine
  similarity is a dot product.
- Each model's vectors live in their own folder, `cache/index/embeddings/<model>-<hash>/`, keyed by
  endpoint and model name, so models never mix. A folder holds two files:
  - `vectors.f32`: little-endian float32 rows;
  - `meta.json`: each row's note path and content hash, the text version, and a SHA-256 of the
    vectors file.
- A pair that doesn't check out loads as "no index". That costs a re-index but can never return wrong
  neighbours. The two most recently used models are kept.
- **Incremental:** only notes whose content hash changed are embedded, in batches of whole notes.
  Progress is saved every 50 notes and when a run ends for any reason, so a stopped or failed run
  resumes where it left off.

**Search** (`search.ts`, `src/obsidian/workers/`):

- Search is exact top-k: a dot product per note with a min-heap. 5,000 notes of 1,024 dimensions take
  a few milliseconds.
- It runs in a Web Worker, bundled by an esbuild plugin into a string and started from a Blob URL, so
  the plugin stays one `main.js`.
- If the worker cannot start or fails, search continues on the main thread from the client's copy of
  the index.

**Privacy** (PLAN §7.11):

- **Private notes:** notes with `ai-vault-organizer: private`, and notes the charter ignores, are
  never embedded.
- **Consent:** before note text goes to a provider that is not on this computer, the user is asked
  once, with the number of notes and a token estimate. Later runs ask only when there is something new
  to send.
- **Word statistics include private notes,** because nothing leaves the device for them.

**Settings.** Embeddings are presented as **Better similarity**, an optional part of the AI settings.
They follow the language model's provider and key when it offers embeddings, and otherwise suggest a
local Ollama model. Most users configure one model, not two.

### Deviations from PLAN §7.3 and §11 (M5)

- **Chunk vectors are not stored.** Note vectors are all search needs. Storing chunks would roughly
  triple a cache that users may sync. "Why are these similar?" can re-embed the two notes on demand.
- **No cluster-restricted search (IVF) for large vaults yet.** Exact search is measured at
  milliseconds for 5,000 notes. IVF arrives with clustering, which provides the clusters.
- **Commits added beyond the plan:**
  - the settings restructure, which the user asked for;
  - a seeded topic vault with known topics, which turns "results look sane" into precision@k;
  - a live smoke test against Ollama.

## Consequences

- **Quality.** On the 600-note topic vault, word statistics reach precision@5 of 1.0 within a
  language but 0.51 from Czech notes into English ones. bge-m3 reaches 0.999 and 1.0.
- **Speed.** Indexing 600 notes takes about 11 s with a warm local model. An unchanged re-index costs
  one snapshot (tens of milliseconds).
- **Cache size.** About 4 KB per note for a 1,024-dimension model. A 5,000-note vault means about
  20 MB in `.ai-vault-organizer/cache/`, which the README suggests excluding from sync.
- **Future features share this index.** Link suggestions, placing by example and clustering reuse
  `SimilarityEngine` and the worker.
- **Changing preparation is visible.** Any change to preparation or chunking must bump
  `TEXT_VERSION`, which costs every user a re-index.

## Alternatives considered

- **A vector database or ANN library** (hnswlib, Orama, sqlite-vss). These add WASM or native code
  and weight, and solve a scale problem personal vaults don't have. Approximate results also make
  explanations harder.
- **A language-specific stemmer** (Snowball for English and Czech). Better on paper, but it adds a
  dependency per language. Truncation does nearly as well for inflected languages, and evals in M6 can
  justify a change.
- **Storing vectors as JSON.** About 2.5 times larger, slower to parse, and with no integrity check.
- **Embedding whole notes without chunking.** Long notes exceed model context windows or get
  truncated silently, and their mean meaning drifts. Heading-aware chunks keep long notes
  representable.
