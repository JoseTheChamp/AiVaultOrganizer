# CLAUDE.md — AI Vault Organizer

**AI Vault Organizer** (plugin id `ai-vault-organizer`) is an Obsidian community plugin that keeps a
vault organized against a written, human-readable **charter**: AI proposes, the user approves, nothing
is ever deleted, everything can be undone.

Read before doing anything:

- `docs/PLAN.md` — product spec, architecture, AI design, milestones and the planned commit list. Source of truth.
- `docs/RESEARCH.md` — how people organize vaults, competitor landscape, platform rules. Explains *why*.
- `docs/adr/` — architecture decision records. Add one whenever you make a non-trivial decision.

Quality bar: a production-grade open-source plugin. Readable code, an atomic commit history, tests,
evals and docs are part of the deliverable. When in doubt, do it right rather than fast.

## Non-negotiable invariants

1. **No deletion of user content.** There is no `delete` operation in the domain model. Destructive-looking
   changes are moves into an archive folder, proposed and approved like any other change. The only
   exception: undoing a run may send files *the plugin itself created* to Obsidian's trash (`fileManager.trashFile`).
2. **Single write path.** Every vault mutation goes Plan → validate → backup → apply → journal → verify.
   No code outside `src/core/apply` (and its Obsidian adapter) writes to the vault.
3. **LLMs never act on the vault.** Model output, including tool calls, can only produce Operations inside a
   Plan or a Charter draft. All model output is validated with zod before use. Unknown destinations are rejected.
4. **`src/core/**` never imports `obsidian`.** Obsidian code lives in `src/obsidian/**` adapters that implement
   the ports in `src/core/ports.ts`. This keeps core unit-testable in Node and runnable by the eval CLI.
5. **No telemetry. No servers.** Network calls go only to endpoints the user configured, through `HttpPort`
   (`requestUrl` inside Obsidian). "Local-only mode" must block any non-loopback endpoint.
6. **No secrets anywhere in the repo**: not in code, fixtures, cassettes, screenshots or `data.json`.
   API keys go through Obsidian `SecretStorage`. Cassettes are scrubbed of auth headers.
7. **No real personal notes in the repo.** Fixtures are synthetic only.

## Commands

```bash
npm run dev          # esbuild watch, outputs into dev-vault/.obsidian/plugins/ai-vault-organizer
npm run build        # production bundle: main.js + styles.css (+ manifest.json copied)
npm run lint         # eslint (typescript-eslint + eslint-plugin-obsidianmd)
npm run typecheck    # tsc --noEmit
npm test             # vitest: unit + integration, cassettes only, no network
npm run check        # lint + typecheck + test  — must pass before EVERY commit
npm run eval         # eval harness, replay mode by default
npm run eval -- --record --provider=ollama   # re-record cassettes against a local model
npm run dev:vault    # (re)generate dev-vault/ from fixtures for manual testing
```

`dev-vault/`, `main.js`, `coverage/`, `.env*` and `eval/out/` are gitignored. `main.js` is never committed;
it is built by the release workflow and attached to GitHub releases.

## Git workflow

**Conventional Commits**, enforced by commitlint:

```
<type>(<scope>): <imperative summary, lowercase, no period, ≤ 72 chars>

<body: why the change was needed and what it does, wrapped at 72>

Refs: #<issue>
```

- Types: `feat`, `fix`, `refactor`, `perf`, `test`, `docs`, `build`, `ci`, `chore`, `style`.
- Scopes: `core`, `charter`, `apply`, `analysis`, `embeddings`, `ai`, `planner`, `drift`, `ui`, `obsidian`, `eval`, `release`, `adr`.
- Good: `feat(apply): add append-only journal with inverse operations`
- Bad: `update`, `wip`, `fix stuff`, `changes`, `final`, anything with "and" joining two unrelated changes.

Rules:

1. **One logical change per commit.** Tests go in the same commit as the code they test. A commit must
   build and pass `npm run check` on its own (husky pre-commit runs nano-staged; CI runs everything).
2. **Follow the planned commit list** in `docs/PLAN.md` §11 for the current milestone. If reality differs,
   adjust the plan in the milestone's PR description; don't silently drift.
3. **Branch per milestone**: `m<NN>-<slug>` (e.g. `m02-safety-layer`). Never commit directly to `main`.
4. **Push continuously**: `git push -u origin HEAD` after every commit (or at least after every finished task).
   Open a **draft PR** as soon as the first commit of a milestone is pushed: `gh pr create --draft --fill`.
5. **Fixups, not noise**: small corrections to an earlier commit in the same branch → `git commit --fixup <sha>`,
   then before marking the PR ready: `GIT_SEQUENCE_EDITOR=: git rebase -i --autosquash origin/main` and
   `git push --force-with-lease`. Never force-push `main`. Never rewrite history once a review has started.
6. **PRs** use `.github/pull_request_template.md`: summary, why, commit list, how tested, eval impact,
   screenshots/GIF for UI. Link the milestone issue (`Closes #N`).
7. **Merging**: Josef reviews and merges. Use "Create a merge commit" (no squash) so the atomic commits stay
   visible. Do not merge to `main` yourself unless Josef explicitly says so in this session.
8. **Releases**: tags are bare semver (`0.3.0`, **no `v` prefix**) and must equal `manifest.json` version.
   Update `manifest.json`, `versions.json`, `package.json`, `CHANGELOG.md` in one `chore(release): x.y.z` commit.
9. Keep `CHANGELOG.md` (Keep a Changelog format) updated under `## [Unreleased]` in the PR that changes behavior.

## Obsidian plugin rules (the automated directory review checks these)

- Use `this.app`, never the global `app`.
- HTTP only via `requestUrl` (wrapped by `HttpPort`). No `fetch` in plugin code (the Node eval adapter may use it).
- No `innerHTML` / `outerHTML` / `insertAdjacentHTML`. Use `createEl`, `setText`, or Svelte templates.
- All paths through `normalizePath`.
- Frontmatter edits only via `app.fileManager.processFrontMatter`; body edits via `app.vault.process` (atomic).
- Moves and renames only via `app.fileManager.renameFile` (it updates links). Never `vault.rename` for notes.
- Register listeners with `registerEvent` / `registerDomEvent` / `registerInterval`; clean up in `onunload`.
  Don't detach leaves in `onunload`.
- UI text in sentence case. Settings headings via `new Setting(el).setHeading()`. No default hotkeys.
  Command ids must not contain the plugin id (Obsidian prefixes them).
- Styling only in `styles.css` with Obsidian CSS variables; no hard-coded colors.
- `manifest.json`: `isDesktopOnly: true` for v1, `minAppVersion` ≥ `1.11.4` (SecretStorage), id without
  "obsidian", name without "Obsidian"/"Plugin", description ≤ 250 chars ending with a period.
- `vault.adapter` is allowed only for the plugin's own storage under `.ai-vault-organizer/`.
- No `console.log` in production paths; use the `Logger` port (debug toggle in settings).

## Coding conventions

- TypeScript `strict` + `noUncheckedIndexedAccess`. No `any`; parse unknown input with zod.
- Core = pure functions and small classes with injected ports (constructor DI). No singletons, no globals.
- Expected failures (validation, conflicts) return a `Result<T, E>`; bugs throw.
- Files `kebab-case.ts`, tests colocated as `*.test.ts`. One concept per module.
- Prompts live only in `src/core/ai/prompts/<id>.v<N>.ts` and export `{ id, version, build(), schema }`.
  Changing a prompt = new version + eval run + note in the PR.
- Comments explain *why*. All code, comments, docs and commit messages in English.
- Prefer small, well-known dependencies. Ask before adding anything > 100 kB or with WASM/native parts.

## How to work a milestone

1. Read the milestone in `docs/PLAN.md` §11 and its GitHub issue.
2. Enter plan mode and post a task list that maps 1:1 to the planned commits. Wait for Josef's OK.
3. Create the branch, implement task by task: code → tests → `npm run check` → commit → push.
   Open the draft PR after the first push.
4. Before marking ready: autosquash fixups, update `CHANGELOG.md`, README (if user-visible), ADR (if a decision
   was made), `docs/EVALS.md` (if AI behavior changed). Fill the PR template.
5. Add a **"Design notes"** section to the PR description: the key idea, the tricky parts and the
   trade-offs considered, so a reviewer can follow the reasoning without reading every line.
6. Ask Josef to review. Address comments with new commits (or fixups before he starts reviewing).

## Stop and ask Josef when

- A decision affects user data, the invariants, or the charter format (needs an ADR).
- You want to add a heavy dependency, a WASM/native module, or a new network endpoint.
- An eval metric regresses beyond the threshold in `eval/thresholds.json`.
- Before merging to `main`, tagging a release, or submitting to the community directory.
- The plan in `docs/PLAN.md` turns out to be wrong. Propose the change; don't improvise silently.
