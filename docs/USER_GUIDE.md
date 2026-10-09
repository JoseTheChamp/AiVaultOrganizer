# User guide

AI Vault Organizer keeps your Obsidian vault organized against a **charter**: a note that describes how
your vault is organized and holds the rules the plugin follows. The plugin proposes changes, you approve
them, a backup is made first, and every run can be undone. No note is ever deleted.

This guide covers the current development version. It is desktop only.

## Contents

1. [Install](#install)
2. [Quick start](#quick-start)
3. [The dashboard](#the-dashboard)
4. [Choosing a system](#choosing-a-system)
5. [Setting up AI](#setting-up-ai)
6. [Organizing your notes](#organizing-your-notes)
7. [Reviewing a plan](#reviewing-a-plan)
8. [Applying and undoing](#applying-and-undoing)
9. [Keeping the vault tidy](#keeping-the-vault-tidy)
10. [Other tools](#other-tools)
11. [The charter note](#the-charter-note)
12. [Privacy](#privacy)
13. [Backups](#backups)
14. [Settings](#settings)
15. [Commands](#commands)
16. [Troubleshooting](#troubleshooting)

## Install

The plugin is not in Obsidian's community directory yet.

1. Download `main.js`, `manifest.json` and `styles.css` from the latest release on GitHub, or build them
   with `npm install` and `npm run build`.
2. Put the three files in `<your vault>/.obsidian/plugins/ai-vault-organizer/`.
3. In Obsidian, open **Settings → Community plugins**, turn off restricted mode if needed, and enable
   **AI Vault Organizer**.

Try it on a copy of your vault first. The plugin never deletes a note and can undo every run, but a
copy costs nothing.

## Quick start

1. Click the **dashboard** icon in the ribbon (or run **Open dashboard**).
2. Optional: click **Set up** next to *AI* to connect a language model ([Setting up AI](#setting-up-ai)).
3. Click **Choose a system**, pick a method and click through the three steps. This writes the charter
   note.
4. Leave **Then plan where my notes go** on. The plugin plans and opens the review.
5. Accept what you agree with, then click **Apply**. A backup is made first.

If something looks wrong afterwards, click **Undo this run** in the report, or **Undo** on the dashboard.

## The dashboard

The dashboard sits in the right sidebar.

- **Health**: a score from 0 to 100 for how organized the vault is: notes nothing links to, notes left
  in the root or the inbox, broken links, tags spelled several ways, missing properties, empty folders and
  folder depth.
- **Next step**: the one thing to do now. A new vault starts with *Set up AI* (or *Continue without
  AI*), then *Choose a system*; later it is *Review* a waiting plan, *Organize* notes that are out of
  place, *Add folders* for notes waiting in Other, or nothing when everything is in place.
- **In progress**: while the plugin organizes or indexes, this card shows the step, how many notes are
  done, a progress bar, a clock and, once the pace is known, how long is left, with **Stop**.
- **System**: your method, with **Open** (the charter note) and **Change** (the wizard again).
- **AI**: the model, where it runs, and a status light: green when it answers, yellow when the model is
  not installed, red when it is offline or blocked by local-only mode, with what to do. It is checked when
  the dashboard opens and once a minute, with a free request that lists models (no tokens).
- **Last change**: the last run, with **Undo**.

**Full diagnosis** at the bottom opens the detailed analysis of the vault.

## Choosing a system

**Choose a system** (or the **Set up charter** command) opens a wizard with three steps.

### 1. Choose a system

On the left is the list of methods. The one your vault already resembles is marked **Recommended**, and
each shows how well your vault matches it:

| Method | In one line |
|---|---|
| Keep my current structure | Turns the folders you already have into a charter. Nothing has to move. |
| PARA | Projects, areas, resources, archive: sorted by how actionable a note is. |
| ACE | Atlas to know, Calendar for time, Efforts to act. |
| Flat + categories | Almost no folders; a `categories` property says what each note is. |
| Johnny.Decimal | Numbered areas and categories; every note gets an ID such as 11.03. |
| Zettelkasten | Small linked notes; folders only by kind of note. |
| Topic folders | One folder per subject. |

On the right, the selected method appears as the **folder tree it would give your vault**:

- your existing folder names, where they fit;
- your existing project subfolders;
- the number of notes each folder would hold by the method's rules alone;
- at the bottom, how many notes the rules leave for similar notes, AI or you.

**About** opens what the method is, what it is good for, and what it is not so good for.

Folder names follow the language of your vault where the methods come translated (English and Czech),
and are English otherwise; rename any of them in the next step. AI reads notes in any language either way.

**Suggest a system** asks AI to read samples of your notes and propose a system. You can add a wish such
as "keep courses apart". Without AI set up, it opens [Set up AI](#setting-up-ai) first. The suggestion
appears at the top of the list as **Suggested by AI**.

### 2. Adjust

Each folder shows what kind of note it holds, for example *Atomic notes: one idea each*. Folders are
grouped under the folder they are in, such as a Johnny.Decimal area. Rename folders, remove the ones you do
not want (**×**; **Add back** brings them back), and add folders for subjects the method does not cover:

- **Add a folder here**, next to a group, adds one inside it. In Johnny.Decimal the name starts with the
  area's next free number (`10-19 Life admin/14 `), so you only type the rest.
- The folder-plus button on any folder, one you added included, adds a subfolder inside it (`2 Areas/`,
  `Hobbies/`). A new folder that only holds subfolders needs no description: notes go into the
  subfolders.
- **Add a folder** at the bottom adds one at the top level.

A new folder needs a name and a sentence on what goes in it, such as *Running, races and training plans*:
AI files notes by that sentence, not by the name. In Johnny.Decimal, notes named `14.01 …` then go to
`14 Sport` automatically, and the index lists it. The tree on the right updates as you type. If two folders get the same name, or a
new folder has no description, you see why and cannot continue until it is fixed.

Typing the name of a folder you already have reuses that folder, with the notes in it, and the row says
what is there (*Your folder already holds 12 notes: Bread, Leek soup, Tea and 9 more*). If those notes are not the
kind the folder is for, pick another name: the plugin files notes by what the folder is for, not by its
name.

Every method comes with **Other** (`90-99 Other/91 Other` in Johnny.Decimal, a `[[Other]]` category in
Flat + categories): notes nothing else fits go there, so organizing leaves no note behind. Remove it if
you would rather have such notes flagged for you.

**More options** holds:

- **Inbox folder**: where new notes wait to be filed. Leave it empty for no inbox.
- **Tags**: keep them as they are, or normalize them to lowercase with dashes (`#web-dev`).
- **Heading for related links**: where suggested links go in a note.
- **Maps of content**: a note per folder (or per category) that lists its notes.
- **Never touch**: folders or patterns, such as `Private/**`, that the plugin ignores completely.

### 3. Create

This creates the charter note (`Vault Charter.md` by default). **Show the note** previews it. With
**Then plan where my notes go** on, planning starts right after.

## Setting up AI

**The plugin works without AI.** Rules, similar notes, drift checks, the analysis and undo never call a
model.

**What AI adds.** Without AI, the plugin can only place notes that already say where they belong:

- a property such as `type: project` or `status: done`;
- a date in the file name;
- a strong resemblance to notes already in place.

In a messy vault that is often only a fraction of the notes. AI reads each remaining note (its title,
headings and first few hundred characters) and proposes where it belongs. It also names project
subfolders, writes the plan's summary and can suggest a whole system.

**Set up AI** (dashboard, command palette, or the top of the AI settings) asks where AI runs:

- **On this computer**: free and private.
  1. Install [Ollama](https://ollama.com).
  2. Run `ollama pull qwen3:8b` once.
  3. Choose Ollama and the model.

  Turn on **Also compare notes by meaning** to find similar notes better, even across languages. It
  needs `ollama pull bge-m3`. LM Studio works too.
- **With my API key**: OpenAI, Anthropic, Google Gemini, Mistral, OpenRouter or Groq. Paste your key; it is
  stored in Obsidian's keychain on this device, never in the plugin's settings file. Usage is billed by the
  provider.
- **No AI**: rules and similar notes only.

**Save and test** checks the connection. If it fails, the dialog stays open and says why: the server is
not running, the key is wrong, or the model is not installed (with the models that are).

## Organizing your notes

**Organize** on the dashboard (or the **Organize vault** command) builds a plan for the whole vault:

1. **Rules** place what they can. They are never wrong.
2. **Similar notes** place notes that closely resemble notes already in the right folder.
3. **AI**, if set up, proposes places for the rest. A dialog asks first: **Use AI?**
   - It names the model and where it runs, the number of notes, and the estimated requests, tokens and
     (with prices set) cost. After a first run it also says how long the run may take at that run's pace.
   - **What is sent** shows exactly what the model sees.
   - **Use AI** sends; **Without AI** plans with rules and similar notes only; **Cancel** stops.
4. What nothing places for sure goes to **Other**: notes no rule, similar note or AI could place, and notes
   the AI was unsure about (its two answers disagreed). The reason shows the best guess, such as *No folder
   fits for sure (best guess: 13 Home, 39 %)*. Notes in Other are placed again each time you organize, so
   once you add a folder that fits them (**Change** on the dashboard), they move there. Without Other, such
   notes are flagged for you instead.
5. The plan also normalizes properties and tags, updates maps of content, and flags notes whose queries
   (Dataview, Bases) would show something different after the moves.

While it works, the dashboard and a notice show each step, for example *qwen3:8b is placing notes, 30 of
74, about 3 min to go*. The model first places every note, then double-checks the uncertain ones with a
second request: answers that agree are trusted more. A model on your computer may take a minute or more
per request; the clock shows it is still working. **Stop** (or a click on the notice) ends the AI part:
notes it has not reached wait in Other (or are flagged, without Other), and the rest of the plan is ready
to review. If the model is offline, the **Use AI?** dialog says so and
offers to plan without it.

Nothing changes yet. The plan opens in the review.

## Reviewing a plan

The review opens in its own tab. At the top is a one-line summary; **notes about this plan** opens any
warnings.

**Rows.** Each row is one proposed change, grouped by kind and destination:

- *Needs your attention* comes first: notes nobody could place, possible duplicates, and queries that
  would change. **Open note** opens the note.
- *New folders*, *Moves into …*, *Property renames*, *Tags* and so on follow.
- *Empty folders to remove* comes last: folders this plan's moves would leave empty, and empty folders
  that are no part of your system (a stray *New folder*), so the old structure does not linger. Empty
  folders inside your system's folders stay unless the plan empties them: they may be placeholders. A folder goes to the trash only if it is still empty when the plan runs (otherwise it
  is kept, and the run report says why), and undo brings it back. Its confidence is that of the least
  certain move out of it, so accepting by confidence never removes a folder whose notes stay.

Each change has a **confidence** badge. Rules are certain (100 %). For similar notes and AI, the number is
calibrated on test vaults so that high means usually right: changes at 80 % or more were right 94–100 %
of the time there. Click a row to see **why** and **exactly what changes**:

- a move shows both paths;
- an edit shows the lines that change, removed in red and added in green;
- a new note shows its content.

**Deciding.**

- **Accept** and **Reject** on each row. Click again to undecide.
- **Accept N changes** accepts every shown, undecided change at or above the confidence you pick in the
  menu next to it.
- Decisions keep related changes together. Accepting a property fix of a note that also moves accepts the
  move; rejecting the move rejects its fixes.
- **Learn from my decisions** uses what you accepted and rejected to re-score the undecided changes. It
  may also propose places for flagged notes. No AI is asked.

**Finding things.** Type in **Find**, or open **Filters**: who decided (rules, similar notes, AI, you),
destination, status, minimum confidence.

**Keyboard.** Tab into the list, then:

| Key | Does |
|---|---|
| `j` / `k` (or arrows) | Next / previous change |
| `a` | Accept and go to the next |
| `r` | Reject and go to the next |
| `u` | Undecide |
| `Enter` | Show why and what changes |

Decisions are saved as you make them, so you can close the review and come back later (**Review pending
plan**).

## Applying and undoing

**Apply N accepted changes** shows its progress:

1. Checking the plan against the vault as it is now.
2. Creating a backup.
3. Applying changes in batches. After every batch, every link is checked, and the run stops if one would
   break.

**Cancel** stops after the current batch. The report then shows:

- what was applied, what was skipped or failed, and why;
- the health score before and after;
- where the backup is.

**Undo this run** (or **Undo last run**) restores every note exactly as it was, byte for byte. Notes you
edited after the run are left alone and listed, so your later work is never overwritten.

If Obsidian is set not to update internal links when files move (**Settings → Files and links**), the
review asks you to confirm before applying moves.

## Keeping the vault tidy

- **Check drift** shows where the vault departs from the charter: notes in the wrong place, notes no rule
  places, missing categories or properties, values the charter does not allow, and notes waiting too long
  in the inbox.
- The dashboard's next step says when notes are out of place; **Organize** plans only what is needed.

## Other tools

- **Find similar notes**: the notes closest to the one you are reading. It compares shared words without
  AI, or meaning with *Also compare notes by meaning* on. The first search indexes the vault; click the
  progress notice to stop.
- **Analyze vault**: the full diagnosis, with a copyable Markdown report.
- **Create backup**: a backup now, without changing anything.

## The charter note

The charter is an ordinary note. It starts with prose that explains your system, and ends with a
```` ```charter ```` block of YAML that holds the rules. In reading view, the block shows as a summary
card, or as a list of problems with line numbers if the YAML is wrong.

You can edit both parts. The plugin only rewrites sections it generated (they are marked) and never
touches your own text. Changing the charter changes what the plugin proposes from then on.

## Privacy

- **Network.** Nothing is sent anywhere unless you set up a model. There is no telemetry and no server of
  ours.
- **Local-only mode** (on by default) blocks every request to anything but this computer. Choosing a
  cloud provider in **Set up AI** turns it off.
- **Consent every run.** Before notes go to a model, the **Use AI?** dialog shows what and where, every
  time.
- **What a model sees** of a note: its title, folder, tags, a few properties, headings, outgoing links,
  how recently it changed and the first few hundred characters of text.
- **Private notes.** Add `ai-vault-organizer: private` to a note's properties to keep it away from every
  AI feature. Notes in **Never touch** are ignored entirely.
- **Local data.** Model answers and the similarity index are cached in `.ai-vault-organizer/cache/`
  inside your vault. Clear them in the settings, and exclude the folder from sync if you prefer.

## Backups

Every apply starts with a zip of all notes, canvases and bases in `.ai-vault-organizer/backups/`. The last
10 are kept; change this in the settings.

**Restoring by hand.** Each zip holds `vault/` (your files) and `manifest.json` (sizes and checksums).
Close Obsidian, extract the zip and copy the contents of `vault/` over your vault.

## Settings

| Section | Setting | What it does |
|---|---|---|
| Charter | Charter note | Path of the charter note. |
| AI | Guided setup | Opens **Set up AI**. |
| AI | Use a language model, provider, endpoint, model, API key, thinking | The language model in detail. *Thinking* is off by default for Ollama, which answers much faster. |
| AI | Better similarity | An embedding model to compare notes by meaning. |
| Privacy and limits | Local-only mode | Blocks requests to anything but this computer. |
| Privacy and limits | Parallel requests, requests per minute | Keeps within your provider's limits. |
| Privacy and limits | Token budget per run | A run stops asking the model once it reaches this. |
| Privacy and limits | Price per million tokens | Optional; shows cost estimates before each run. |
| Backups | Backups to keep, include attachments | Backup retention and size. |
| Advanced | Debug logging, clear model response cache, similarity index | For troubleshooting. |

## Commands

| Command | |
|---|---|
| Open dashboard | The sidebar dashboard. |
| Set up AI | Connect a language model. |
| Set up charter | The wizard: choose and adjust a system. |
| Organize vault | Plan where notes belong (the dashboard's *Organize*). |
| Review pending plan | Reopen the last plan. |
| Check drift | Where the vault departs from the charter. |
| Undo last run | Restore the vault as it was before the last run. |
| Create backup | A backup now. |
| Analyze vault | The full diagnosis. |
| Find similar notes | The closest notes to the active one. |

No command has a default hotkey; assign your own in **Settings → Hotkeys**.

## Troubleshooting

- **"Set up AI" says it cannot reach the server.** Start Ollama (or LM Studio's local server) and try
  again.
- **"… is not installed".** Run the `ollama pull …` command shown, or pick one of the installed models
  listed.
- **A cloud model is blocked.** Local-only mode is on. **Set up AI** with *With my API key* turns it off, or
  turn it off in the settings.
- **Many notes are flagged "could not be placed".** Without AI, only notes that rules or similar notes
  recognize are placed. Set up AI, or file a few notes yourself and click **Learn from my decisions**.
- **Planning with a local model is slow.** A model running on the processor instead of the graphics card
  takes a minute or more per request. Use a smaller model, or check that Ollama uses your GPU.
- **A change was skipped.** The note changed after the plan was made. Plan again to include it.
- **Something else.** Turn on **Debug logging** in the settings and look at the developer console
  (`Ctrl+Shift+I`).
