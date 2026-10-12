# AI in AI Vault Organizer: current state and evaluations

Where language models and embeddings are used today, what is ordinary code, how the evaluations work,
whether anything is judged by an LLM, and experiments you can run yourself to tune the AI and measure
the result. For the full architecture, see [How it works](HOW_IT_WORKS.md); for the numbers and their
history, see [EVALS.md](EVALS.md).

---

## 1. Where AI is used today

### In the app

| Feature | Model | What the model does | What it sees |
|---|---|---|---|
| **Organize**: placing notes | Chat model (`classify-notes` v2) | Picks a destination (or abstains) for notes rules and similar notes could not place, with a reason, a subfolder and a confidence | Note cards: title, folder, tags, a few properties, headings, links, age, first 400 characters |
| **Organize**: second opinion | Same chat model | Asked again, in a different batch order, about answers it was unsure of; agreement raises confidence, disagreement lowers it | The same cards |
| **Organize**: new folder names | Chat model (`subfolder-naming` v1) | Cleans up names for new project and topic folders, reusing existing folders | Proposed names and existing folders |
| **Organize**: plan summary | Chat model (`plan-summary` v2) | Two or three sentences on what the plan does, naming the least certain changes to look at | Counts and a few one-line changes with their confidence, never note contents |
| **Suggest a system** (wizard) | Chat model as an agent (`charter-agent` v1) | Explores the vault through read-only tools and proposes a charter | Only what its tools return: overview, method scores, clusters, samples |
| **Organize** and **Find similar notes** | Embedding model (for example bge-m3) | Turns notes into vectors so similar notes can be found by meaning | Note text, in chunks |

Developed and measured with **qwen3:8b** (chat) and **bge-m3** (embeddings), both running locally in
Ollama. Any OpenAI-compatible endpoint or Anthropic works too.

### Built and measured, not yet in the app

| Prompt | What it does | Measured in the evals as |
|---|---|---|
| `cluster-label` v1 | Names groups of similar notes | Calls, failed and repaired batches, sample labels for reading |
| `verify-links` v1 | Decides which suggested related links a careful author would add | Precision of the top three links, relevance, recall of removed links |

### What is not AI

Everything else is ordinary code: the charter and its rules, analysis and the health score, similarity
by word statistics (TF-IDF), the nearest-neighbour vote (kNN), calibration, the Other fallback, folder
creation and removal, normalizing tags and properties, the review, validation, backup, apply, the journal
and undo. On the test vaults, rules alone place 10–55 % of notes, and the vote among similar notes places
many more before the model is asked.

### How a model answer becomes something the app acts on

1. **A closed set of answers.** The answer schema only allows the destinations shown, or "abstain". The
   model cannot invent a folder.
2. **Constrained decoding** where the provider supports it (Ollama, OpenAI): the model can only produce
   JSON that fits the schema. Otherwise JSON mode with the schema in the prompt.
3. **Validation in code** (zod), always. If the answer does not fit, the errors go back for one repair
   round; if it still does not fit, those notes stay undecided.
4. **Calibration**: one confidence per note from all evidence. The model's own confidence is shrunk
   toward 50 % (models are overconfident), then moved by agreement with similar notes and with the second
   opinion.
5. **The fallback**: below 50 % a note goes to Other with the model's guess in the reason, instead of a
   guess being applied.
6. **Review**: nothing changes until you accept it; everything can be undone.

---

## 2. The evaluations

Yes, the project has an evaluation suite, and it runs in CI on every change.

### What it runs on

Real vaults are private, so the test vaults are **synthetic** (`eval/generator/`):

1. **Personas**: Alex (a developer, English) and Tereza (an architecture student, Czech), with projects,
   areas, topics, courses, books, people and daily notes.
2. **Generation** builds a clean vault and records the **ground truth**: where every note belongs in
   PARA, ACE, Johnny.Decimal, Flat + categories and Topic folders.
3. **Messify** makes it realistic: stubs, paraphrased duplicates, links removed (kept as held-out links),
   drifting property names and tag spellings, notes scattered into the root and odd folders, empty folders.

The two committed fixtures, `en-small` and `cs-small`, have 82 notes each.

### Tiers and recordings

| Tier | Uses | Needs a model to run? |
|---|---|---|
| 0 | Rules and word statistics | No |
| 1 | + embeddings (bge-m3) | No: vectors are stored |
| 2 | + the chat model (qwen3:8b) | No: answers are recorded |

Model answers are **recorded once** against the local models into *cassettes*
(`eval/cassettes/llm-<fixture>-<model>.json`) and **replayed** afterwards. Replays are free, offline and
deterministic, so CI runs Tier 2 without any model. A request that is not in the cassette fails the
replay, so any change to a prompt or its input shows up and has to be re-recorded on purpose.

### What is measured

| Task | Metrics |
|---|---|
| Classification, per method and per stage (rules, words, embeddings, LLM) | Coverage (share decided), precision, accuracy, macro-F1, **ECE** (calibration error), share and accuracy of placements at 80 % or more, subfolder accuracy, who decided |
| Calibration and mistakes, per method | ECE and **Brier score** of the uncertain decisions only (rules left out), a **reliability table** (per confidence band: notes, claimed confidence, how often right), the three **most frequent mistakes**, and model calls with repaired and failed batches |
| Plan summary | Numbers not in the plan's facts and whether it names particular notes (code); claims backed by the facts, and planted errors caught (**an LLM judge**, section 3) |
| Related links | Precision of the top three, relevance, recall of removed links; with and without LLM verification |
| Clusters | ARI against the true projects and topics |
| Duplicates | Precision and recall |
| Full plan (PARA) | Operations, validation errors, applied, failed, broken links, undo exact |
| Safety | Every note moved and undone: applied, broken links, undo exact |

Pinned metrics live in `eval/thresholds.json` with a tolerance of 0.02. `npm run eval:ci` replays Tier 2
and fails if any pinned metric drops below its minimum.

### Current results (qwen3:8b + bge-m3, recorded October 2026)

| Method | Fixture | Accuracy | ECE | At ≥ 80 %: share / accuracy |
|---|---|---:|---:|---:|
| PARA | en-small | 89.0 % | 0.090 | 52.4 % / 95.3 % |
| PARA | cs-small | 86.6 % | 0.132 | 75.6 % / 85.5 % |
| ACE | en-small | 74.4 % | 0.114 | 59.8 % / 93.9 % |
| ACE | cs-small | 91.5 % | 0.111 | 64.6 % / 98.1 % |
| Johnny.Decimal | en-small | 91.5 % | 0.124 | 78.0 % / 95.3 % |
| Johnny.Decimal | cs-small | 82.9 % | 0.090 | 68.3 % / 94.6 % |
| Flat + categories | en / cs | 100 % / 97.6 % | 0.04–0.05 | 93–99 % / 100 % |
| Topic folders | en / cs | 100 % | 0.10–0.11 | 99–100 % / 100 % |

Full plans apply without a broken link and undo byte for byte. The vaults are small (one note is about
1.2 percentage points) and built from templated sentences, so compare versions with each other, not
with real-world expectations.

---

## 3. Do we validate with an LLM?

**Once: the plan summary.** Everything else is computed in code against the generator's ground truth,
which is exact: the generator knows where each note belongs. A judge model would be slower, cost money
and need its own checking, so it is used only where there is no single right answer to compare with.

**The summary judge** (`summary-judge` v1, [ADR 0011](adr/0011-summary-judge.md)) checks the summary the
review shows against the facts it was written from:

1. Code splits the summary into its sentences and highlights.
2. For each one, the model quotes the shortest words of the facts that back it and says "supported",
   "unsupported" or "advice".
3. Code checks every quote: it must really be in the facts and hold the statement's numbers. An approval
   with a quote that fails is overruled.
4. **The judge is tested on every run.** Two copies of the summary carry a planted error: a wrong count,
   and an action no plan takes ("It also merges 4 pairs of duplicate notes"). The judge must flag exactly
   those statements. The share it catches is pinned in CI, like any metric.

The test mattered. A first draft that gave a 1–5 score approved everything: 5 / 5 for both summaries, and
1 of 4 planted errors caught. It explained a wrong count away as "a total" and called the invented action
"part of the plan facts". With the steps above it catches 4 of 4, and it showed that `plan-summary` v1
wrote faithful but generic summaries ("verify all 71 moves"), which led to v2. Two things the judge does
not do: it is the same model that wrote the summary, so it may favour its own wording, and two summaries
per run are a regression check, not a measure of writing quality.

Where a model checks something in the product, outside the measurement:

- **The second opinion** (self-consistency): the same model asked again about uncertain answers. Its
  value was measured: answers it confirmed were right 92 % of the time, those it contradicted 34 %.
- **`verify-links`**: a model filters link suggestions. The eval measures that filter against the
  held-out links, so the filter is evaluated, not trusted.
- **The charter agent**: its drafts are checked by the charter's schema in code, not by another model.

**Where another judge would make sense:** cluster labels (do they name the group?) and link reasons. Today
these are checked only for producing valid output, and read by a person in the report (E7 below).

---

## 4. Experiments you can run yourself

Each experiment changes one setting, measures the effect with the eval suite, and ends in one commit with
the change, updated thresholds, and a short finding in `docs/EVALS.md`. Running them yourself is what
makes the commit yours, and it is what lets you answer questions about it: why you tried it, what the
numbers did, and why you kept or rejected the change.

**The basic loop:**

```bash
npm run eval -- --tier=2                     # replay: prints the metrics, writes eval/reports/
npm run eval -- --tier=2 --update-thresholds # after an improvement you decide to keep
npm run eval:ci                              # what CI runs; must pass
npm run check                                # before every commit
```

Experiments E1 and E2 need **no model calls**: they replay the recordings. The others need Ollama and
re-recording (`--record`), about 15–30 minutes per fixture on a GPU.

### E1. Tune the calibration weights (no model calls, about an hour)

- **Question:** can the confidences be more honest, so "80 % or more" is right more often, or covers more
  notes at the same accuracy?
- **Setting:** `DEFAULT_CALIBRATION` in `src/core/planner/calibrate.ts`: `llmTrust` 0.6, `sampleBonus`
  0.15, `samplePenalty` 0.35, `agreementBonus` 0.1, `disagreementPenalty` 0.2, `ceiling` 0.95.
- **Measure:** model ECE, Brier and "at ≥ 80 %: share / accuracy" per method and fixture, and the
  reliability table in the report. Change one weight at a time and keep a small table of runs.
- **Where to start:** the reliability table shows low confidence is too low. Below 0.5, placements were
  right 78 % of the time for PARA and Johnny.Decimal on en-small and 85 % for ACE on cs-small, at a claimed
  31–39 % (EVALS finding 13). Those notes go to Other. `samplePenalty` is the likely cause; watch the
  0.9-and-above band of PARA on cs-small, which is already too confident.
- **Watch out:** with 82 notes you can overfit the fixtures. Prefer changes that help both languages, and
  explain why in the finding.
- **Commit:** `feat(planner): retune calibration weights from the evals`

### E2. Tune the similar-notes vote (no model calls at Tier 1)

- **Question:** how far can kNN go before it starts making mistakes? Every note it decides is one the
  model does not need.
- **Setting:** `DEFAULT_KNN` (embeddings) and `WORD_KNN` (words) in `src/core/planner/classify.ts`: `k` 7,
  `minShare` 0.75, `minSupporters` 3, `minSimilarity` 0.5 (0.15 for words).
- **Measure:** run `npm run eval -- --tier=1` and compare coverage against precision for the "embeddings"
  and "words" stages. Plot the trade-off for a few values of `minShare`.
- **Watch out:** at Tier 2, a change here sends other notes to the model, so the LLM cassettes miss and
  need re-recording.
- **Commit:** `perf(planner): let kNN decide more notes at the same precision`

### E3. The second-opinion band (needs re-recording)

- **Question:** is asking twice worth it for every answer between 0.4 and 0.95? It doubles the requests,
  and the time, for most notes.
- **Setting:** `SECOND_SAMPLE` in `src/core/planner/llm-stage.ts` (`low` 0.4, `high` 0.95), or turn it
  off.
- **Measure:** ECE, "at ≥ 80 %" accuracy and the number of model calls. The interesting result is the
  cost per point of calibration.
- **Commit:** `perf(planner): ask for a second opinion only where it pays off`

### E4. How much of each note the model sees (a new prompt version)

- **Question:** does a longer excerpt improve accuracy enough to pay for its tokens? Does a shorter one
  hurt?
- **Setting:** `NOTE_CHARS` (400) in `src/core/ai/prompts/classify-notes.v2.ts`. The project rule: a
  prompt change is a new version file (`classify-notes.v3.ts`), an eval run and a note in the commit.
- **Measure:** accuracy, macro-F1 and input tokens per run (the report counts them).
- **Commit:** `feat(ai): classify notes from longer excerpts (classify-notes v3)`

### E5. Compare local models (needs a download)

- **Question:** how do other small local models compare with qwen3:8b on the same task?
- **How:** pull a model in Ollama (for example a Llama, Gemma or Mistral of similar size), then
  `npm run eval -- --fixture=en-small,cs-small --tier=2 --record --chat-model=<name>`. Each model gets its
  own cassette, so the comparison is repeatable.
- **Measure:** accuracy, model ECE, Brier and time per request, and how well the model follows the answer
  schema: the report's "Model calls (repaired / failed)" column. qwen3:8b has 0 / 0 on both fixtures.
  The summary judge runs on the same model, so check its planted-errors score too before trusting its
  verdict for another model.
- **Commit:** `docs(eval): compare local chat models on note classification`

### E6. Fix ACE's Efforts and Atlas confusion (needs re-recording)

- **Question:** can ACE on en-small reach the other methods' accuracy (74 % against 89–92 %)?
- **Evidence:** the report's "Most frequent mistakes": 14 of ACE's 21 errors on en-small are notes of an
  effort filed as Atlas notes (EVALS finding 14).
- **Setting:** the ACE destination descriptions in the preset charter (`src/core/charter/presets/ace.ts`).
  Say that notes about an ongoing effort belong to it even when they read like reference.
- **Measure:** ACE accuracy and its mistakes on both fixtures, and that the other methods do not move
  (their requests are unchanged, so their cassettes still replay).
- **Commit:** `feat(charter): tell Efforts from Atlas in the ACE descriptions`

### E7. A judge for cluster labels (a new eval task)

- **Question:** do the labels name what the notes in a cluster share?
- **How:** follow the summary judge (`eval/runner/judge.ts`, ADR 0011): give the model a label and the
  titles of its cluster's notes, ask for a verdict per label with the titles that back it, check those
  titles in code, and plant errors (a label swapped with another cluster's) that the judge must catch.
- **Measure:** the share of labels judged right, and the planted errors caught.
- **Commit:** `feat(eval): judge cluster labels against their notes`

### Writing the finding

Add a numbered finding to `docs/EVALS.md`, in the style of the existing ones: what you changed, the
numbers before and after, and what you concluded. A rejected change is also a finding ("asking twice
only between 0.6 and 0.9 lost 3 points of accuracy at ≥ 80 %"). In an interview, a well-measured
negative result shows as much understanding as a win.
