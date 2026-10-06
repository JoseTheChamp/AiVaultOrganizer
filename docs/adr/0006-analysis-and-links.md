# 0006. Analysis and link suggestions

- Status: Accepted
- Date: 2026-10-06

## Context

M7 adds the analyses the planner and the wizard build on (PLAN §7.4–7.5):

- triage of stubs and orphans;
- near-duplicate detection;
- clustering, with keywords and model-written labels;
- link suggestions, optionally verified by a language model.

Each has to work at Tier 0, without any model, and get better with embeddings and a language model.
Each has to be explainable in the review, deterministic for evals, and fast on vaults of thousands of
notes. The M6 baseline showed where naive approaches fail: no similarity threshold separates
duplicates from notes on the same topic, and raw nearest neighbours mix in daily notes.

## Decision

**Triage.**

- A *stub* has fewer than 10 words and no outgoing links. At 20 words, short clippings and book
  notes counted as stubs.
- *Orphans* and *isolated* notes are read from the link graph.
- Daily notes are never stubs or orphans: they are reached by date.
- A stub gets a suggestion: merge into its nearest neighbour when that is similar enough, otherwise
  the inbox.

**Duplicates.**

- Candidates come from MinHash over 5-word shingles, with 128 hashes and LSH in 64 bands of 2 (Tier
  0), and from embedding neighbours with cosine ≥ 0.85 (Tier 1).
- A candidate counts only when the titles agree (Dice coefficient ≥ 0.5 over title words), or when
  the content is nearly identical (Jaccard ≥ 0.8 or cosine ≥ 0.97).
- Banding favours recall, because short paraphrases overlap little. Exact Jaccard and the title then
  remove the false candidates.
- Daily notes are excluded: they share a template by design.
- Results are proposed as `flag: duplicate` operations. Nothing is merged in v1.

**Clustering.**

- One randomized PCA (Halko et al., with power iteration) works against a matrix-product interface.
  It reduces embeddings (Tier 1) and sparse TF-IDF vectors (Tier 0, i.e. latent semantic analysis)
  to 64 unit-length dimensions.
- k-means++ clusters them; k is chosen by silhouette over √n/2 … 2√n, capped at 40.
- The silhouette is exact up to 1,500 notes, computing pairwise distances once per search, and
  simplified (distances to centres) above that. The simplified form favoured over-splitting on small
  vaults.
- Everything is seeded and deterministic.

**Keywords and labels.**

- Keywords come from class-based TF-IDF (BERTopic), shown as the most common surface form of each
  stem, diacritics included.
- Labels come from the `cluster-label` prompt: several clusters per call, keywords plus five
  representative note cards each. The schema accepts only the group ids shown, each exactly once. A
  failed batch falls back to keywords, and the failure is counted.

**Link suggestions.**

- *Candidates*: per note, the most similar notes it is not linked with, above a similarity floor
  (0.1 for words, 0.5 for bge-m3). They are ranked by similarity plus shared tags plus Adamic–Adar
  over shared link neighbours.
- *Search*: with a clustering, a note is compared only with its own and the two nearest clusters.
  This is the IVF idea of PLAN §7.3. It costs at most about 2 points of precision on the fixtures.
- *Daily notes* neither get nor become suggestions.
- *Verification*: the `verify-links` prompt checks each note's top three candidates, asking once
  per unordered pair. The answer is relevance, strength (1–3) and a short reason in the vault
  language. The reason becomes the operation's rationale in the review.
- *Failures*: a batch that fails keeps its candidates as unverified (`knn`) rather than dropping
  them.
- *Applying*: accepted suggestions become one idempotent `addRelatedLinks` operation per note, with
  one direction per pair, no existing links, and a content-hash precondition.

**Prompts and cards.**

- Prompts are versioned modules (`src/core/ai/prompts/<id>.v<N>.ts`) with `build`, an
  input-dependent `schema` and `maxTokens`.
- They run at temperature 0, with zod validation and one repair round. Rendered prompts are pinned
  by snapshot tests.
- Note cards are the only form in which note content reaches a model: title, folder, tags,
  headings, outgoing links and a word-bounded excerpt. Private notes get no card, so they cannot be
  sent.

### Deviations from PLAN §7.4–7.5

- **Duplicates:** the Tier 1 candidate floor is 0.85 rather than the plan's 0.92. Title
  confirmation does the separating, and short Czech paraphrases scored 0.84–0.93.
- **No agglomerative clustering for small vaults.** k-means with the exact silhouette was good
  enough, and one algorithm is simpler to explain and test.
- **Cards built early.** Note cards were built in M7, not M8, because the label and verification
  prompts need them. M8 extends them, for example with cluster labels and age.

## Consequences

- Every analysis has a Tier 0 path, and the evals measure each tier separately (`docs/EVALS.md`).
- Tier 2 evals replay recorded model answers from cassettes, so CI checks language-model behaviour
  offline. Re-recording is needed whenever a prompt, a card or a fixture changes.
- Changing a prompt means a new version file, a re-recorded cassette and an eval run, as CLAUDE.md
  requires.
- Clustering above about 5,000 notes will need the worker (PLAN §6.6) to keep the UI responsive. The
  algorithms are already written for it: pure functions over typed arrays.

## Alternatives considered

- **HDBSCAN or other density clustering.** It needs no k, but it is sensitive to parameters, leaves
  noise points unassigned, and has no small dependency-free implementation.
- **Duplicates by similarity threshold only.** This was measured in M6: 0–100% precision and recall
  depending on fixture and threshold.
- **Verifying every candidate.** That costs about three times as many calls for little gain: pairs
  ranked below third are mostly relevant or redundant.
- **A model writing links directly.** Rejected by invariant 3. The model only judges pairs it is
  shown, and the result is an operation the user reviews.
