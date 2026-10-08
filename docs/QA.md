# Manual QA

Automated tests cover the core, the components and the apply path in memory. This checklist covers what
only Obsidian shows: views, modals, the real file manager, themes and the keyboard. Run it before every
release and after changes to the UI or the Obsidian adapters, and record the result at the end.

## Setup

1. `npm run dev:vault -- en-small` writes a synthetic 82-note vault (with the plugin built into it) to
   `dev-vault/`. `cs-small` is the Czech one; `messy-para` is small and quick.
2. Open `dev-vault/` in Obsidian (never a real vault) and enable the plugin. After a rebuild, reload it from
   the developer console: `app.plugins.disablePlugin('ai-vault-organizer')`, then `enablePlugin(…)`.
3. Snapshot the vault for the undo check: `node scripts/hash-vault.mjs dev-vault > before.json`.
4. For the AI steps, run Ollama with `qwen3:8b` and `bge-m3` (see the README).

## Checklist

### Dashboard

- [ ] The ribbon icon and **Open dashboard** open it in the right sidebar, once (no second copy).
- [ ] The next-step card follows the vault: *Choose a system* without a charter, then *Review* or
      *Organize*, then *Everything is in place*.
- [ ] It updates by itself after a charter is saved and after a run; buttons that change the vault are
      disabled while a run applies.

### Set up AI

- [ ] **Set up AI** opens from the dashboard, the command palette and the top of the AI settings.
- [ ] *On this computer* with Ollama: **Save and test** succeeds with an installed model, and names the
      installed models when the chosen one is missing.
- [ ] *With my API key*: the key field is a password field; after saving, the settings file holds only
      `ai-vault-organizer-<provider>`, never the key; local-only mode is off.
- [ ] *No AI* turns both models off.

### Setup wizard

- [ ] Three steps; the step heading takes focus on every step (a screen reader announces it).
- [ ] Choose: the recommended method is selected; the tree on the right shows the vault's own folder
      names, project subfolders and note counts; **About** shows good for and not so good for.
- [ ] Switching method or language updates the tree and resets the adjustments.
- [ ] Adjust: renaming a folder updates the tree as you type; two destinations with one folder show the
      problem and disable **Next**; **More options** holds inbox, tags, links, maps and ignored folders.
- [ ] Create: **Create charter** writes the note through a backup and opens it.
- [ ] Editing again starts from the saved charter ("Keep my charter"), with earlier changes intact.
- [ ] **Suggest a system** without AI opens **Set up AI** first; with AI, the consent dialog, then the
      "Suggested by AI" choice.

### Planning and consent

- [ ] Without AI: **Organize** opens the review; notes no rule places are flagged, with an offer to set AI up.
- [ ] With **Better similarity** on a cloud endpoint, indexing asks first; the progress notice stops when clicked.
- [ ] With a language model, **Use AI?** names the model and where it runs, the notes, requests and tokens
      (and cost with prices set); **What is sent** opens the details. **Without AI**, **Cancel** and
      **Use AI** each do what they say.
- [ ] Local-only mode with a cloud model: the dialog says it is blocked and **Use AI** is disabled.
- [ ] A note marked `ai-vault-organizer: private` raises the "never sent" count and never appears in a
      request (debug logging on).

### Review

- [ ] Opens in a tab; flags first, then folders, moves by destination, edits.
- [ ] **Filters** opens the filters (who decided, confidence, destination, status) and says when one is on;
      **Find** narrows the list.
- [ ] A row shows only the change; opening it shows the reason and the preview.
- [ ] Previews: a move shows both paths; a property or tag edit shows the changed frontmatter lines; a
      related-links edit shows the inserted lines; a note that will move is previewed at its current path.
- [ ] Keyboard only: <kbd>Tab</kbd> into the list, <kbd>j</kbd>/<kbd>k</kbd> move, <kbd>a</kbd> accepts
      and moves on, <kbd>r</kbd> rejects, <kbd>u</kbd> undecides, <kbd>Enter</kbd> opens the preview.
- [ ] Rejecting a move rejects the edits that wait for it; accepting such an edit accepts its move.
- [ ] **Accept N changes** accepts only shown, undecided rows at or above the threshold picked in the menu.
- [ ] With **Files and links → Automatically update internal links** off, applying moves needs the extra OK.
- [ ] **Learn from my decisions** after accepting a few similar notes updates other rows' confidence and
      rationale, and may propose a place for a flagged note.
- [ ] Closing and reopening Obsidian restores the review with its decisions.

### Apply, report, undo

- [ ] Progress shows the phase and "N of M"; **Cancel** stops after the current batch.
- [ ] The report lists what was skipped or failed and why, the health score before and after, and the backup.
- [ ] **Undo this run** (or **Undo last run**) restores the vault:
      `node scripts/hash-vault.mjs dev-vault --compare before.json` prints "Identical".

### Themes and accessibility

- [ ] Default light and dark themes, and one community theme (Minimal): badges, diff lines and the step
      list are readable; no colour is the only signal.
- [ ] Every control is reachable and usable with the keyboard; focus is always visible.

## Results

| Date | Obsidian | Vault | Result | Notes |
|---|---|---|---|---|
