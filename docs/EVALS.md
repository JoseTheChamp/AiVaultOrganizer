# Evals

AI features ship only with measurements (PLAN §8). This document explains how the plugin is
evaluated, and records the latest numbers that changes are compared against.

## Running

```bash
npm run eval
```

This runs every eval task over the committed fixtures at Tier 1. Embeddings are replayed from stored
vectors, so the run is offline, free and deterministic. A one-line summary per fixture goes to the
terminal; JSON and Markdown reports go to `eval/reports/` (gitignored).

Options:

- `--fixture=en-small,cs-small,en-medium`: which fixtures to run. `en-medium` is generated on demand
  into `eval/out/`.
- `--tier=0|1|2`: 0 is rules, word statistics, MinHash and LSA clustering; 1 adds embeddings; 2 adds a
  language model that labels clusters, verifies link suggestions, classifies the notes that rules and
  kNN leave open, names subfolders and summarizes the plan.
- `--record`: call live local Ollama models for whatever has not been recorded, and store the result.
  Embeddings are stored as the fixture's vector index (`eval/cassettes/index/`). Language-model answers
  are stored as cassettes (`eval/cassettes/llm-<fixture>-<model>.json`). Re-record after changing a
  fixture, the text preparation (`TEXT_VERSION`), a prompt or the note cards.
- `--embed-model=bge-m3` and `--chat-model=qwen3:8b`: which models to use or replay.
- `--check`: compare against `eval/thresholds.json` and exit with an error on a regression.
- `--update-thresholds`: write today's numbers as the new bounds. Only do this deliberately, and
  explain the change in the commit.

CI runs `npm run eval:ci`, which is the replayed Tier 2 run with `--check`. It needs no network: the
embedding vectors and model answers are replayed from the repository. A metric that falls more than
0.02 below its bound, or a task that silently stops running, fails the build.

## Fixtures

Real vaults are private, so fixtures are synthetic (invariant 7). They are built in three steps,
each deterministic for its seed.

1. **Personas** (`eval/generator/personas/`) are hand-written material:
   - Alex, a software developer writing in English;
   - Tereza, an architecture student writing in Czech.

   Each has active and finished projects, areas, resource topics, a course, books, web clippings,
   people and daily notes. Every project, area and topic has a description, note titles and a pool of
   sentences.
2. **Generation** (`persona-vault.ts`) turns a persona into a clean vault filed in PARA folders. It has
   properties, tags, hub notes listing their notes, links to hubs and related hubs, date-prefixed
   meetings and daily notes. Every note is labelled with where PARA, ACE, Johnny.Decimal,
   Flat + categories and Topic folders would put it.
3. **Messify** (`messify.ts`) makes the vault realistic:
   - 5% of notes become stubs;
   - 5% get a paraphrased duplicate;
   - 30% of linked note pairs lose every link between them, kept as held-out links;
   - properties drift: `type` is dropped or renamed to `Type` or `kind`, `Status` and `created`
     appear, tags change casing and move inline;
   - notes scatter into the root, an inbox, odd folders and top-level project folders, with about 10%
     left in place;
   - a few empty folders are added.

The labels never change: they say where each note belongs, however messy its current place is.

| Fixture | Persona | Notes | Held-out links | Where |
|---|---|---:|---:|---|
| `en-small` | developer, English | 82 | 22 | committed, CI |
| `cs-small` | student, Czech | 82 | 22 | committed, CI |
| `en-medium` | developer, English, 8× material | 511 | 174 | generated, local |

Each fixture folder holds its notes and a hidden `.ground-truth.json` (format in
`eval/fixture/ground-truth.ts`). It is hidden, so Obsidian and the plugin never see it. A test checks
that the committed fixtures are exactly what the generator produces. After changing personas, the
generator or messify, run `tsx eval/cli.ts build-fixtures`, then `npm run eval -- --record`, and
re-baseline.

## Tasks and metrics

**Classification** (PLAN §7.6, ADR 0007). Each method's preset charter classifies every note
through the planner's cascade, measured stage by stage:

| Stages | What decides |
|---|---|
| rules | Charter rules, daily-note patterns and notes already in place. Everything else abstains. |
| words | Rules, then kNN over TF-IDF neighbours (Tier 0). |
| embeddings | Rules, then kNN over bge-m3 neighbours (Tier 1). |
| llm | Rules, kNN over embeddings, then the language model with a second sample for borderline answers (Tier 2). |

Confidences are calibrated as the planner calibrates them, so ECE measures what the review will
show. Subfolders are reconciled with existing folders as in the planner, without the naming prompt.

| Metric | Meaning |
|---|---|
| Coverage | Share of notes that got a destination. |
| Precision | Correct among decided notes: how far a decision can be trusted. |
| Accuracy | Correct among all notes; an abstention counts as not correct. |
| Macro-F1 | Mean F1 over the true destinations. |
| ECE | Calibration gap over 10 confidence bins (rules claim 1.0). |
| Confident | Share of notes decided with confidence ≥ 0.8, and how many of those are right. This is what "accept everything above 0.8" in the review would accept. |
| Subfolders | Of the notes in the right destination that belong in a subfolder, the share in the right one. |

**Full plan.** `buildPlan` runs on the fixture with the PARA charter and the best similarity of the
tier (and the language model at Tier 2): placement, normalization, MOCs, query checks and the
summary. Every operation is accepted, validated and applied through the executor. Then every link
must still resolve, and undo must restore the vault byte for byte.

**Link suggestions** (PLAN §7.5, ADR 0006). For each note, the pipeline produces candidates that are
similar, not yet linked, and ranked with shared tags and shared link neighbours. The search is
restricted to the note's cluster and the two nearest ones. At Tier 2, the top three per note are
verified by the language model. Each tier is measured on its top three suggestions per note, which
is what Tier 2 verifies, so tiers compare. Daily notes are left out by design, both as sources and
in recall.

| Metric | Meaning |
|---|---|
| P@3 | Share of the 3 slots filled with a relevant note; empty slots count as misses. A note is relevant if the pair is linked, held out, or in the same project, area or topic. |
| Relevance | Share of the suggestions actually made that are relevant. Verification makes fewer suggestions, so this shows whether they got better. |
| Held-out recall | Share of removed links that appear among the suggestions, in either direction. |

**Topic neighbours.** Topic P@5 is the share of a note's 5 nearest neighbours that share its topic:
plain similarity, without exclusions.

**Duplicates** (ADR 0006). MinHash candidates (Tier 0), plus embedding neighbours (Tier 1), confirmed
by title similarity or near-identical content. Measured with precision and recall against the
`duplicateOf` labels.

**Stubs.** Notes under 10 words with no outgoing links, against the `isStub` labels.

**Clusters.** PCA to 64 dimensions, then k-means++ with k chosen by silhouette. Tier 0 clusters TF-IDF
vectors (LSA) and Tier 1 clusters embeddings. The vault's current folders are the baseline. Measured
with ARI and NMI against two labelings: topics (coarse; several projects share one) and projects
(the entity each note belongs to).

**Cluster labels** (Tier 2). Calls, failed and repaired batches, and for reading the report, each
label with its cluster's most common topic.

**Safety.** Every note is filed where PARA says it belongs, through the real apply path. Then:

- every link must still resolve;
- the run is undone, and the vault must be byte-identical with the same folders.

**Cost.** Model calls, tokens and wall time per task, normalized per 100 notes.

## Baseline

Measured on 2026-10-06 with bge-m3 for embeddings and qwen3:8b with thinking off for the language
model, both on Ollama. en-medium runs to Tier 1 only (see Limitations).

### Classification without a language model

Coverage / precision per stage. kNN never overrules a rule; it decides notes the rules left open.

| Method | Fixture | Rules | + kNN (words) | + kNN (embeddings) |
|---|---|---:|---:|---:|
| PARA | en-small | 23.2 % / 100 % | 31.7 % / 96.2 % | 45.1 % / 89.2 % |
| | cs-small | 28.0 % / 100 % | 43.9 % / 97.2 % | 42.7 % / 100 % |
| | en-medium | 21.9 % / 100 % | 68.5 % / 100 % | 68.7 % / 99.4 % |
| ACE | en-small | 28.0 % / 100 % | 29.3 % / 95.8 % | 28.0 % / 100 % |
| | cs-small | 25.6 % / 100 % | 26.8 % / 100 % | 28.0 % / 100 % |
| | en-medium | 20.4 % / 100 % | 20.4 % / 100 % | 20.4 % / 100 % |
| Johnny.Decimal | en-small | 9.8 % / 100 % | 9.8 % / 100 % | 9.8 % / 100 % |
| | cs-small | 9.8 % / 100 % | 9.8 % / 100 % | 9.8 % / 100 % |
| | en-medium | 12.5 % / 100 % | 12.5 % / 100 % | 12.5 % / 100 % |
| Flat + categories | en-small | 51.2 % / 100 % | 91.5 % / 100 % | 79.3 % / 100 % |
| | cs-small | 54.9 % / 100 % | 98.8 % / 100 % | 84.1 % / 100 % |
| | en-medium | 47.0 % / 100 % | 100 % / 100 % | 100 % / 100 % |
| Topic folders | en-small | 9.8 % / 100 % | 9.8 % / 100 % | 9.8 % / 100 % |
| | cs-small | 9.8 % / 100 % | 9.8 % / 100 % | 9.8 % / 100 % |
| | en-medium | 12.5 % / 100 % | 12.5 % / 100 % | 12.5 % / 100 % |

Rules include notes already where the charter puts them, so coverage is higher than in M7, which
counted rule matches only.

### Classification with a language model (Tier 2)

Rules, kNN over embeddings, then qwen3:8b with `classify-notes` v2 and a second sample. The model
decided every remaining note; it never abstained.

| Method | Fixture | Accuracy | Macro-F1 | ECE | Confidence ≥ 0.8: share / accuracy | Subfolders | Rules / kNN / model |
|---|---|---:|---:|---:|---:|---:|---:|
| PARA | en-small | 89.0 % | 0.880 | 0.090 | 52.4 % / 95.3 % | 75.4 % | 19 / 18 / 45 |
| | cs-small | 86.6 % | 0.796 | 0.132 | 75.6 % / 85.5 % | 63.5 % | 23 / 12 / 47 |
| ACE | en-small | 74.4 % | 0.843 | 0.114 | 59.8 % / 93.9 % | 81.0 % | 23 / 0 / 59 |
| | cs-small | 91.5 % | 0.957 | 0.111 | 64.6 % / 98.1 % | 79.2 % | 21 / 2 / 59 |
| Johnny.Decimal | en-small | 91.5 % | 0.922 | 0.124 | 78.0 % / 95.3 % | n/a | 8 / 0 / 74 |
| | cs-small | 82.9 % | 0.785 | 0.090 | 68.3 % / 94.6 % | n/a | 8 / 0 / 74 |
| Flat + categories | en-small | 100 % | 1.000 | 0.043 | 98.8 % / 100 % | n/a | 42 / 23 / 17 |
| | cs-small | 97.6 % | 0.996 | 0.048 | 92.7 % / 100 % | n/a | 45 / 24 / 13 |
| Topic folders | en-small | 100 % | 1.000 | 0.103 | 100 % / 100 % | 45.9 % | 8 / 0 / 74 |
| | cs-small | 100 % | 1.000 | 0.107 | 98.8 % / 100 % | 24.3 % | 8 / 0 / 74 |

How the first run of the model stage compares (en-small, accuracy): PARA 85.4 %, ACE 64.6 %,
Johnny.Decimal 43.9 %, Flat 79.3 %, Topic folders 100 %. ECE was up to 0.33 and subfolder accuracy
13–19 %. Findings 9–12 explain what changed.

### Full plan

`buildPlan` with the PARA charter, every operation accepted and applied, then undone.

| Fixture | Tier | Operations | Validation errors | Failed | Broken links | Undo exact |
|---|---:|---|---:|---:|---:|---|
| en-small | 2 | 12 folders, 71 moves, 16 property renames, 5 tag fixes | 0 | 0 | 0 | yes |
| cs-small | 2 | 7 folders, 69 moves, 9 property renames, 7 tag fixes | 0 | 0 | 0 | yes |
| en-medium | 1 | 274 moves, 56 property renames, 37 tag fixes, 160 notes flagged as ambiguous | 0 | 0 | 0 | yes |

At Tier 1 the notes kNN cannot decide are flagged for the user; at Tier 2 the model decides them.
The plan summary was written by the model at Tier 2 and composed from the numbers at Tier 1.

### Link suggestions

| Fixture | Tier | Method | P@3 | Relevance | Held-out recall |
|---|---|---|---:|---:|---:|
| en-small | 0 | words | 75.2 % | 83.2 % | 86.7 % |
| en-small | 1 | embeddings | 80.5 % | 84.5 % | 100 % |
| en-small | 2 | verified by qwen3:8b | 82.1 % | 90.7 % | 93.3 % |
| cs-small | 0 | words | 80.0 % | 86.6 % | 94.4 % |
| cs-small | 1 | embeddings | 81.0 % | 85.4 % | 83.3 % |
| cs-small | 2 | verified by qwen3:8b | 82.4 % | 92.8 % | 83.3 % |
| en-medium | 0 | words | 98.1 % | 98.4 % | 23.0 % |
| en-medium | 1 | embeddings | 98.1 % | 98.3 % | 20.9 % |

### Duplicates, stubs and topic neighbours

| Fixture | Duplicates P / R, Tier 0 | Duplicates P / R, Tier 1 | Stubs P / R | Topic P@5, words / embeddings |
|---|---:|---:|---:|---:|
| en-small | 100 % / 100 % | 100 % / 100 % | 100 % / 100 % | 81.0 % / 87.1 % |
| cs-small | 100 % / 100 % | 100 % / 100 % | 100 % / 100 % | 83.4 % / 89.3 % |
| en-medium | not meaningful (see Limitations) | | | 96.8 % / 98.9 % |

The M6 threshold baseline for duplicates scored 0–100 % on these fixtures.

### Clusters

ARI against topics / ARI against projects (clusters found).

| Fixture | Folders (baseline) | Tier 0: words (LSA) | Tier 1: embeddings |
|---|---:|---:|---:|
| en-small (10 topics) | 0.023 / 0.030 (18) | 0.464 / 0.659 (19) | 0.523 / 0.671 (15) |
| cs-small (8 topics) | 0.030 / 0.041 (22) | 0.198 / 0.606 (18) | 0.279 / 0.762 (17) |
| en-medium (10 topics) | 0.053 / 0.060 (31) | 0.635 / 0.798 (11) | 0.683 / 0.856 (12) |

Cluster labels (Tier 2):

- en-small: 15 clusters labelled in 3 calls, with no failed or repaired batches. 12 of the 15
  clusters are at least 75 % one topic.
- cs-small: 17 clusters labelled in 3 calls. 15 of 17 are at least 75 % one topic.
- Example labels: "Running training", "Home maintenance", "Stěhování do bytu", "Diplomová práce".

### Safety and cost

| Fixture | Safety | Language model (Tier 2) per fixture | of which classification (5 presets) |
|---|---|---:|---:|
| en-small | 82 operations, 0 broken links, undo exact | 92 calls, 109k input / 43k output tokens | 58 calls, 71k / 31k |
| cs-small | 77 operations, 0 broken links, undo exact | 91 calls, 166k input / 56k output tokens | 58 calls, 106k / 40k |
| en-medium | 434 operations, 0 broken links, undo exact | not run | |

- **Classification** takes about 12 model calls per preset for the 45–75 notes that reach the model
  on a small fixture. About half of them are second samples.
- **The full plan** adds about 14 calls: the classification calls of one preset, subfolder naming
  and the summary.
- **Embedding** the vault costs 6.3 calls and 6,100 tokens per 100 notes, about 2.5 s per 100 notes
  live.
- **Recording time.** A small fixture took about 16 minutes at Tier 2 with qwen3:8b on the
  development machine's GPU, most of it classification. On the CPU, the same model needed 1–2.5
  minutes per call.
- Tier 0 tasks and clustering take milliseconds to about a second. Replayed runs cost nothing.

## Findings

1. **Rules decide 10–55 % of notes and are never wrong.** That counts notes already where the
   charter puts them.
2. **The Flat + categories preset only recognized English category names** (M7). Czech `[[Knihy]]`
   and `[[Lidé]]` were missed. Fixed in M8: the Czech charter accepts both.
3. **Link suggestions improve tier by tier in relevance**: 83–87 % from words, 84–85 % from
   embeddings, 91–93 % after verification.
   - The model rejects mostly irrelevant pairs. In a live probe, only 12–22 % of the pairs it rejected
     were relevant.
   - Verification can cost a held-out link: on en-small, 15 of 15 found by embeddings became 14 of 15.
   - On cs-small, embeddings found fewer removed links than words (83 % against 94 %). The Czech
     fixture's links mostly join notes that share exact sentences, which favours word overlap.
4. **Duplicate detection is solved on the small fixtures** by MinHash plus title confirmation, at both
   tiers, after the threshold baseline failed.
5. **Clustering recovers projects better than topics.** On the small fixtures, notes split by project
   (ARI 0.61–0.76 against projects) more than by topic (0.20–0.52), because several projects share a
   topic. Embeddings beat LSA on every fixture, by 0.04–0.08 ARI.
6. **The model names clusters reliably.** Labels came back in the vault's language with no failures or
   repairs. Sentence case was followed only sometimes, and one Slovak word slipped into Czech.
7. **Moving every note never broke a link, and undo was always exact.** That held for up to 434
   operations.
8. **Thinking models need their reasoning switched off for structured tasks.** qwen3:8b ran out of
   tokens while thinking until the Ollama preset turned it off (M6).
9. **kNN decides only where anchors exist.**
   - It lifts PARA from 22 % to 69 % and Flat from 47 % to 100 % on en-medium, at 99–100 %
     precision.
   - It adds next to nothing for ACE, Johnny.Decimal and Topic folders. Their destinations are
     empty in a vault that does not use them yet, and kind destinations such as Calendar do not
     vote.
   - On the small fixtures, kNN over embeddings is less precise for PARA (89 %) than words; the
     thresholds favour precision, and the model stage checks what kNN leaves.
10. **The language model is only as good as the destination descriptions.**
    - Bare names ("Life admin: Home") and abstract ones ("Recurring efforts that never really end")
      sent notes to the wrong place.
    - The Flat guidance ("decide which category links a note should list") sent every personal note
      to Categories.
    - Concrete descriptions raised Johnny.Decimal from 44 % to 92 % and Flat from 79 % to 100 %
      (en-small).
11. **Optional fields are never written under schema-constrained decoding.** `classify-notes` v1
    left `subfolder` out of every answer. v2 requires every field, puts the rationale first and
    offers subfolders in use, which took subfolder accuracy from 13–19 % to 64–81 % for project
    layouts.
    - The model names the project a note belongs to more reliably than the method's destination.
      Filing a note with the project its subfolder names raised ACE from 58 % to 74 % (en-small).
    - Topic subfolders match the labels less often (24–46 %). Topic names are a matter of taste,
      and the review lets the user rename them.
12. **Self-reported confidence is useless; a second sample is not.**
    - qwen3:8b said 0.9 for nearly every answer, right or wrong.
    - Answers a second sample confirmed were right 92 % of the time, and those it contradicted 34 %.
    - With that as the main signal, ECE is 0.04–0.13, and placements at 0.8 or above are right
      94–100 % of the time for nine of the ten preset–fixture pairs. The exception is PARA on
      cs-small, at 85.5 %.
    - The model never abstains, so ambiguity shows only as low confidence.

## Limitations

- **Templated material.** Fixture notes are composed from a few hundred hand-written sentences, so
  notes of one project share exact sentences. That flatters word statistics and makes absolute numbers
  optimistic. Compare methods with each other and over time, not against real-world expectations.
- **Small fixtures.** The CI fixtures have 82 notes each, so one note moves a percentage by about
  1.2 points. That is why the regression tolerance is 0.02.
- **Choices baked into the labels.** For example, a meeting of a work project is filed under JD
  "Meetings", but a meeting of a home project stays with "Home". These are the generator's decisions,
  documented in `persona-vault.ts`.
- **en-medium repeats its material.** It is the small material repeated eight times, so
  differently titled notes sometimes have identical bodies. That makes its duplicate numbers
  meaningless (590 "duplicates" found for 18 labelled) and its link precision near-perfect. It is for
  scale, speed and clustering, not for judging quality. Its Tier 2 run (over 1,000 pairs to verify
  and about 300 notes to classify per preset) is not recorded.
- **Tuned on en-small, checked on cs-small.** The M8 prompt, description and calibration changes were
  made after reading en-small's mistakes. cs-small, whose answers were not inspected, scores in the
  same range (83–100 % per method). But both fixtures come from the same generator, whose labels
  the descriptions now match more closely. Real vaults will score lower.
