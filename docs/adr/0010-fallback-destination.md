# 0010. A fallback destination, and folders of your own in the wizard

- Status: Accepted
- Date: 2026-10-08

## Context

After applying every change a Johnny.Decimal plan proposed with confidence, 14 of 82 notes on the
synthetic vault were still where they had been: in the root, in `Inbox`, in old topic folders. The user's
verdict: it "looks like unfinished work". Every one of them had a proposed move at 39 %. The model had
answered twice and disagreed, because the starter Johnny.Decimal index has no category for running,
photography, cooking or people, so it forced guesses ("Knife skills → 12 Health"). Not accepting those
was right; leaving the notes where they were looked broken.

Two things were missing:

- **A place for what fits nowhere.** The charter could only say where notes belong, not what happens to
  the rest. Undecided notes became flags, and uncertain guesses stayed pending, so a reorganization never
  finished.
- **Folders of your own.** The wizard let people rename and leave out a method's folders, but not add
  one. A Johnny.Decimal user who runs could not add `14 Sport` before the first plan.

## Decision

**1. A destination may be the charter's fallback** (`fallback: true`, at most one). It is a normal folder
or category, by default `Other` (`90-99 Other/91 Other` in Johnny.Decimal, `Ostatní` in Czech), and it
means "notes nothing else fits wait here".

- The planner files in it every note the cascade leaves undecided, and every note whose placement by
  similar notes or the model is below 50 % confident: in practice, the model's two answers disagreed.
  The move is a rule (100 %), and its reason keeps the best guess ("best guess: 13 Home, 39 %").
- The fallback is not offered to the model, and notes in it neither vote nor serve as examples: "Other" is
  the absence of a decision, not a topic. The model keeps the choice to abstain.
- Notes in the fallback are classified again on every run, so they leave it once a folder fits, for
  example after the user adds one.
- Without a fallback, the old behavior stands: undecided notes are flagged for the user.

**2. The setup wizard adds one by default**, for every method and for the current charter, as a row the
user can remove like any other.

**3. The wizard lets people add folders.** A new folder needs a path and a description of what goes in
it, because the description is what the classifier reads. In Johnny.Decimal, a path such as
`30-39 Learning/33 Photography` also gets the category's ID rule (`^33\.\d{2}`) and its entry in the
index. Removing is an explicit button on every row; removed method folders can be added back.

## Consequences

- An accepted plan leaves every note in a folder of the charter, which is what "organized" means to the
  people using it.
- A correct but uncertain guess ("Home office setup → 13 Home", 39 %) lands in Other instead of being
  applied. That is the honest outcome for an answer the model could not repeat, and the reason shows the
  guess, so moving it by hand is one step.
- Charter presets are unchanged; the wizard adds the fallback. The evals use presets directly, so prompts,
  cassettes and metrics are unaffected. The fallback is a new charter field: older plugin versions reject
  a charter that uses it, which is acceptable before the first release.
- The dashboard has to say when notes wait in the fallback, or a vault would look finished while Other
  fills up.

## Alternatives considered

- **Offer "Other" to the model as a target.** The model could then say "nothing fits" directly. But it
  changes every classification prompt, and a weak model takes the easy way out; the eval fixtures would
  need new ground truth. Abstaining and disagreement already identify these notes.
- **Keep uncertain guesses as pending moves and add Other only for undecided notes.** Fewer notes in Other,
  but bulk acceptance would again leave the 39 % notes behind, which is the problem we set out to solve.
- **Use the inbox as the fallback.** The inbox means "not processed yet"; these notes were processed and
  fit nowhere. Mixing the two makes the inbox's age warning meaningless.
