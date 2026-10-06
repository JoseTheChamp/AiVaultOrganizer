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
- `--tier=0|1|2`: 0 is rules and word statistics, 1 adds embeddings, 2 adds language-model tasks (none
  yet; they arrive in M7 and M8).
- `--record`: embed whatever has no stored vectors with a local Ollama model (`--embed-model=bge-m3` by
  default) and store them. Use it after changing a fixture or the text preparation (`TEXT_VERSION`).
- `--check`: compare against `eval/thresholds.json` and exit with an error on a regression.
- `--update-thresholds`: write today's numbers as the new bounds. Only do this deliberately, and
  explain the change in the commit.

CI runs `npm run eval:ci`, which is the replayed Tier 1 run with `--check`. A metric that falls more
than 0.02 below its bound, or a task that silently stops running, fails the build.

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

**Classification.** At Tier 0, each method's preset charter rules place notes (`RuleEngine`); notes
that no rule decides are abstentions. The cascade's kNN and LLM stages arrive in M8.

| Metric | Meaning |
|---|---|
| Coverage | Share of notes that got a destination. |
| Precision | Correct among decided notes: how far a decision can be trusted. |
| Accuracy | Correct among all notes; an abstention counts as not correct. |
| Macro-F1 | Mean F1 over the true destinations. |
| ECE | Calibration gap over 10 confidence bins (rules claim 1.0). |

**Links.** Suggestions are a note's 5 nearest neighbours that it is not already linked with (the
first step of PLAN §7.5).

| Metric | Meaning |
|---|---|
| Link P@5 | Share of the 5 slots filled with a relevant note. A note is relevant if the pair is linked, held out, or in the same project, area or topic. Daily notes, books and people are not related merely by kind. |
| Held-out recall | Share of removed links that appear among the suggestions, in either direction. |
| Topic P@5 | Share of the 5 nearest neighbours (without exclusions) that share the note's topic. |

**Duplicates.** A threshold baseline until M7: a note and its nearest neighbour are called duplicates
when their similarity is at least 0.8 (words) or 0.92 (embeddings, the PLAN §7.4 value). Measured with
precision and recall against the `duplicateOf` labels.

**Clusters.** ARI and NMI against topic labels. Until clustering exists (M7), the baseline is the
vault's current folders. That measures how messy a fixture is, and it is what clustering has to beat.

**Safety.** Every note is filed where PARA says it belongs, through the real apply path (validation,
journal, link updates). Then:

- every link must still resolve;
- the run is undone, and the vault must be byte-identical with the same folders.

**Cost.** Model calls, tokens and wall time per task, normalized per 100 notes.

## Baseline

Measured on 2026-10-06 with bge-m3 (Ollama, 1,024 dimensions). Tier 2 has no tasks yet.

### Classification by rules (Tier 0)

Coverage / precision. Every rule decision was correct, so accuracy equals coverage.

| Method | en-small | cs-small | en-medium |
|---|---:|---:|---:|
| PARA | 15.9 % / 100 % | 19.5 % / 100 % | 13.7 % / 100 % |
| ACE | 28.0 % / 100 % | 25.6 % / 100 % | 20.4 % / 100 % |
| Johnny.Decimal | 0 % | 0 % | 0 % |
| Flat + categories | 22.0 % / 100 % | 14.6 % / 100 % | 14.5 % / 100 % |
| Topic folders | 9.8 % / 100 % | 9.8 % / 100 % | 12.5 % / 100 % |

### Similarity (Tier 0 words, Tier 1 embeddings)

| Fixture | Method | Link P@5 | Held-out recall | Topic P@5 | Duplicates P / R |
|---|---|---:|---:|---:|---:|
| en-small | words | 62.0 % | 95.5 % | 81.0 % | 100 % / 100 % |
| en-small | embeddings | 62.9 % | 86.4 % | 87.1 % | 25 % / 50 % |
| cs-small | words | 61.2 % | 100 % | 83.4 % | 0 % / 0 % |
| cs-small | embeddings | 59.8 % | 90.9 % | 89.3 % | 0 % / 0 % |
| en-medium | words | 85.5 % | 28.7 % | 96.8 % | 6.0 % / 55.6 % |
| en-medium | embeddings | 86.2 % | 31.0 % | 98.9 % | 13.3 % / 55.6 % |

### Clusters, safety and cost

| Fixture | Folders as clusters (ARI / NMI) | Safety | Embedding cost per 100 notes |
|---|---:|---|---:|
| en-small | 0.023 / 0.382 | 82 operations, 0 broken links, undo exact | 6.3 calls, 6,100 tokens, 2.5 s |
| cs-small | 0.030 / 0.389 | 77 operations, 0 broken links, undo exact | (replayed) |
| en-medium | 0.053 / 0.329 | 434 operations, 0 broken links, undo exact | (same rate) |

Tier 0 tasks take under 20 ms per 100 notes. Embedding time was measured live on the development
machine; replayed runs cost nothing.

## Findings

1. **Rules alone decide 10–28% of notes, and they are never wrong.** They place hub notes by `type`,
   finished projects by `status`, meetings by date prefix, clippings by `source`, and daily notes.
   Everything else is for the kNN and LLM stages of the cascade (M8).
2. **Johnny.Decimal rules decide nothing in a vault that doesn't use JD numbers yet.** This is
   expected: JD placement is a classification problem from day one.
3. **The Flat + categories preset only recognizes English category names.** Czech book and person
   notes link `[[Knihy]]` and `[[Lidé]]`, so coverage drops from 22.0% (English) to 14.6% (Czech).
   Follow-up: localize the preset's reference categories (M8, with the planner).
4. **Embeddings find topics better; words find removed links better.**
   - Embeddings raise topic precision by 6 points on the small fixtures.
   - Words recover more held-out links. These notes reuse their project's sentences and mention its
     hub by name, which favours exact word overlap. Real vaults vary their wording more.
   - M7's link verification should be measured on both.
5. **Held-out recall falls to about 30% on en-medium.** More same-project notes compete for 5 slots.
   Precision stays high, because the competitors are relevant too. Link suggestions need ranking
   beyond raw similarity (shared neighbours, PLAN §7.5).
6. **A similarity threshold cannot separate paraphrased duplicates from same-topic notes.** With
   bge-m3, duplicates score 0.84–0.93 and some unrelated same-topic pairs score 0.94. This is why M7
   combines MinHash, embeddings and title similarity.
7. **Moving every note never broke a link, and undo was always exact.** That held for up to 434
   operations.
8. **Thinking models need their reasoning switched off for structured tasks.** qwen3:8b spent about a
   hundred tokens thinking before answering and produced empty answers under small output limits. The
   Ollama preset now turns thinking off. M8 should compare quality with and without it.

## Limitations

- **Templated material.** Fixture notes are composed from a few hundred hand-written sentences, so
  notes of one project share exact sentences. That flatters word statistics and makes absolute numbers
  optimistic. Compare methods with each other and over time, not against real-world expectations.
- **Small fixtures.** The CI fixtures have 82 notes each, so one note moves a percentage by about
  1.2 points. That is why the regression tolerance is 0.02.
- **Choices baked into the labels.** For example, a meeting of a work project is filed under JD
  "Meetings", but a meeting of a home project stays with "Home". These are the generator's decisions,
  documented in `persona-vault.ts`.
