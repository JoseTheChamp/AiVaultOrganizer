# 0011. A language-model judge for plan summaries, tested with planted errors

- Status: Accepted
- Date: 2026-10-09

## Context

Every eval metric so far is computed in code against the generator's ground truth. The plan summary is
the one model output with no single right answer: the review header shows it to the user before they
approve a plan, so it must not misstate the plan, and it should point at what deserves a look. Until now
it was only checked for producing valid JSON.

Faithfulness to a short list of facts is checkable, so a judge model can grade it. But a judge is a model
too, and qwen3:8b, the only model the evals record, showed exactly how one fails. A first draft asked for
reasoning, a list of unsupported claims and a 1–5 score:

- it gave both real summaries 5 / 5, including one that only said "verify all 71 moves";
- it explained a planted wrong count away ("99 moves = 71 moves + 28 notes in Resources");
- it called an invented action "part of the plan facts";
- it caught 1 of the 4 planted errors across both fixtures.

Asked to split the summary into claims itself, it restated the facts instead, and in Czech translated the
summary so that the planted number disappeared.

## Decision

**1. Code does what code can do; the model answers only what needs language.**

- Code splits the summary into its sentences and highlights. The model rules on each given statement, so it
  can neither skip a claim nor invent one.
- For each statement the model quotes the shortest words of the facts that back it, and says `supported`,
  `unsupported` or `advice`.
- Code checks every quote: it must be in the facts (case, spacing, quote marks and line labels aside), and
  it must hold the statement's numbers or numbers that add up to them. An approval that fails either check
  is overruled. Advice is not judged, but a number in it is still checked against the facts.
- Whether the summary names a particular note or folder, and whether its numbers appear in the facts at
  all, are computed in code without the judge.

**2. The judge is tested on every run.** Two copies of the summary carry a planted error: the first count
it states, changed to a number the facts do not back, and an action no plan takes ("It also merges 4 pairs
of duplicate notes"). A control counts as caught only when the judge flags that statement. The share caught
is pinned in `eval/thresholds.json` next to the share of backed claims, so a judge that stops noticing
errors fails CI instead of silently approving.

**3. The judge is eval-only.** `summary-judge` v1 lives with the other prompts (CLAUDE.md), but nothing in
the plugin imports it, so it is not in the bundle and never sees a user's vault. It costs 3 calls and about
3,500 tokens per fixture when recording; replays are free.

## Consequences

- The plan summary has a measured quality: 100 % of claims backed, 0 unsupported numbers and 2 of 2
  planted errors caught on both fixtures, with `plan-summary` v2. The judge made the v1 → v2 change
  measurable: v1 was faithful but generic on en-small; v2 names the least certain notes on both fixtures.
- The planted wrong count is caught by the quote rules rather than by the model, which approved "99 moves"
  quoting "moves: 71". The invented action is caught by the model itself. The report says which is which;
  only the second tests the model's judgement.
- The same model writes and judges the summary, so a bias towards its own wording is not ruled out. The
  controls measure whether the judge notices errors, not whether it is fair.
- Two summaries per run and two kinds of planted errors are a small sample. The judge is a regression
  check for this one output, not a general measure of writing quality.

## Alternatives considered

- **A 1–5 rubric score.** The first draft; the model approved everything and its scores did not follow
  its own rubric (one unsupported claim found, still 4 / 5). Yes/no checks per statement are easier for a
  small model and can be verified.
- **The model finds the claims.** It restated the facts instead of the summary and dropped the planted
  errors. Splitting in code made the decomposition exact.
- **Only code checks.** Numbers and named notes can be checked in code, invented actions cannot: "merges
  duplicates" contains no wrong number.
- **A larger judge model.** Would need a download or a paid endpoint, against ADR 0004's local-first
  default and the recorded-cassette workflow; the quote checks get reliable results from the same 8B model.
- **People rating summaries.** Best for agreement studies, but not repeatable in CI. The planted errors
  give a repeatable, if narrower, check of the judge.
