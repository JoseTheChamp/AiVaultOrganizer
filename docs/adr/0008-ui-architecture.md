# 0008. UI architecture: Svelte 5 components in thin Obsidian views

- Status: Accepted
- Date: 2026-10-06

## Context

M9 adds the screens of PLAN §9.1:

- a dashboard in the sidebar;
- a setup wizard of several steps;
- a consent and cost dialog;
- a plan review that filters, previews and bulk-accepts hundreds of operations, with keyboard
  navigation;
- apply progress with cancel, and a run report.

Until now the plugin built its few modals with Obsidian's `Setting` API and `createEl`. That works
for forms, but the review needs state that changes everywhere at once: filters, selection, counts,
previews and focus. Building that by hand means re-rendering and keeping DOM nodes in sync.

The plugin review rules constrain any choice. There must be no `innerHTML`, styles may live only in
`styles.css` with Obsidian's CSS variables, and listeners must be cleaned up on unload. The bundle is
budgeted (400 kB until now) and loads on every Obsidian start.

## Decision

**Svelte 5 with runes, compiled by esbuild-svelte.**

- Components live in `src/ui/`, named in PascalCase as Svelte components are. Plain TypeScript
  modules next to them keep the logic: filtering, grouping, bulk decisions, keyboard handling and
  formatting. Those modules are unit-tested in Node like the core.
- Components only render state and forward events. Their tests mount them in jsdom with
  `@testing-library/svelte`.

**Obsidian classes stay thin.**

- An `ItemView` or `Modal` creates its container, mounts a component with `mountComponent(component,
  target, props)`, and destroys it in `onClose`.
- Props are plain data and callbacks. Components never receive the plugin, the app or a writer.
  Anything that changes the vault goes back through a callback to a flow, and from there through the
  single write path (invariant 2).

**Styling.**

- Components have no `<style>` blocks. A test fails when one appears, or when a component uses an
  `avo-` class that `styles.css` does not define.
- Inline styles and `{@html}` are lint errors (`svelte/no-inline-styles`, `svelte/no-at-html-tags`).
- Every rule uses Obsidian's CSS variables, so themes apply.

**Checks.** `npm run typecheck` runs `svelte-check` after `tsc`. ESLint lints components with
`eslint-plugin-svelte` and the project's TypeScript settings, and the pre-commit hook includes
`.svelte` files.

**Bundle budget: 600 kB**, from 400 kB.

- The Svelte runtime costs about 50 kB minified.
- Wiring the M8 planner into the plugin adds the cascade, analysis and prompts, which were not
  bundled before (about 50 kB).
- The views add the rest.
- zod and yaml remain the largest parts (about 97 kB each). Moving to `zod/mini` is noted for M12
  hardening.

## Consequences

- The review, wizard and dashboard are declarative, and most of their behaviour is tested without
  a DOM.
- Contributors need Svelte 5 for the UI only; the core and adapters are unchanged.
- The bundle grows by about a quarter. Obsidian loads it once per start; the plugin defers heavy work
  (indexing, the search worker) until it is used.
- Obsidian's own components (`Setting`, `Notice`, `Modal`) are still used where they fit: settings,
  notices and simple confirmations.

## Alternatives considered

- **Plain DOM with `createEl`**, as before. It has no runtime cost, but the review's re-rendering
  and state synchronization would be hand-written and hard to test.
- **React or Preact.** React's runtime is several times larger. Preact is smaller than Svelte, but
  JSX with hooks needs more glue for Obsidian's lifecycle, and PLAN §6.1 already chose Svelte, as
  many community plugins have.
- **Svelte with `<style>` blocks** compiled into injected CSS. That would break the rule that all
  styling lives in `styles.css`, where themes and users can override it.
