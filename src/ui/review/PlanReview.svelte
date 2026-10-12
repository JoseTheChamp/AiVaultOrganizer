<script lang="ts">
  import { SvelteMap, SvelteSet } from 'svelte/reactivity';
  import { OPERATION_SOURCES } from '../../core/model/operation';
  import { plural } from '../../core/model/text';
  import { percent } from '../format';
  import ApplyProgress from './ApplyProgress.svelte';
  import ReviewRow from './ReviewRow.svelte';
  import {
    acceptAbove,
    type Decision,
    decide,
    decidedPlan,
    decisionCounts,
    destinationsOf,
    groupItems,
    initialDecisions,
    matches,
    NO_FILTERS,
    type ReviewActions,
    type ReviewFilters,
    type ReviewItem,
    type ReviewModel,
  } from './review-state';
  import type { OperationPreview } from '../../core/apply/preview';

  interface Props {
    model: ReviewModel;
    actions: ReviewActions;
  }

  let { model, actions }: Props = $props();

  /** Rows shown per group before "Show all": long plans stay quick to scroll. */
  const PAGE = 100;
  const SOURCE_LABELS = { rule: 'Rules', knn: 'Similar notes', llm: 'AI', user: 'You' } as const;
  const THRESHOLDS = [0.95, 0.9, 0.8, 0.7, 0.5];

  // Decisions start from the plan and follow it when a run updates it; the reviewer overrides them.
  let decisions = $derived(initialDecisions(model.plan));
  let filters = $state<ReviewFilters>({ ...NO_FILTERS });
  let threshold = $derived(model.threshold);
  let acknowledged = $state(false);
  const expanded = new SvelteSet<string>();
  const previews = new SvelteMap<string, OperationPreview>();
  const showAll = new SvelteSet<string>();
  // Focus targets for j and k; not state, nothing renders from it.
  const rows: Record<string, HTMLButtonElement> = {};

  const shown = $derived(model.items.filter((item) => matches(item, decisions.get(item.op.id) ?? 'pending', filters)));
  // Changes rejected before the review opened wait in a folded section at the end, where a decision can
  // still be undone. A change rejected now stays where it is, struck through, so the reviewer sees what
  // happened; it folds away the next time the review opens. Filtering by "rejected" shows all in place.
  // svelte-ignore state_referenced_locally
  const folded = new SvelteSet(model.plan.operations.filter((op) => op.status === 'rejected').map((op) => op.id));
  const apart = $derived(filters.status !== 'rejected');
  const isFolded = (item: ReviewItem) => folded.has(item.op.id) && decisions.get(item.op.id) === 'rejected';
  const groups = $derived(groupItems(apart ? shown.filter((item) => !isFolded(item)) : shown));
  const rejected = $derived(apart ? shown.filter(isFolded) : []);
  let rejectedOpen = $state(false);
  const order = $derived([...groups.flatMap((group) => (showAll.has(group.title) ? group.items : group.items.slice(0, PAGE))), ...(rejectedOpen ? rejected : [])]);
  const counts = $derived(decisionCounts(model.items, decisions));
  const destinations = $derived(destinationsOf(model.items));
  const bulkCount = $derived(shown.filter((item) => item.decidable && decisions.get(item.op.id) === 'pending' && item.op.confidence >= threshold).length);
  const hasMoves = $derived(model.plan.operations.some((op) => op.kind === 'move' && decisions.get(op.id) === 'accepted'));
  const blocking = $derived(model.validation.issues.filter((issue) => issue.severity === 'error' && (!issue.opId || decisions.get(issue.opId) === 'accepted')));
  const general = $derived(model.validation.issues.filter((issue) => !issue.opId));
  const needsAck = $derived(hasMoves && model.linksAutoUpdateOff && !acknowledged);
  // The model's highlights may repeat a warning word for word (it is asked to point at them); show it once.
  const notes = $derived(
    [
      ...(model.plan.summary?.highlights ?? []).map((text) => ({ text, tone: 'info' })),
      ...model.plan.warnings.map((warning) => ({ text: warning.message, tone: 'warning' })),
      ...general.map((issue) => ({ text: issue.message, tone: issue.severity })),
    ].filter((note, index, all) => all.findIndex((other) => other.text === note.text) === index),
  );
  const flagged = $derived(model.items.filter((item) => item.op.kind === 'flag' && item.op.issue === 'ambiguous').length);
  const filtering = $derived(filters.source !== 'all' || filters.destination !== 'all' || filters.status !== 'all' || filters.minConfidence > 0);
  const canApply = $derived(counts.accepted > 0 && blocking.length === 0 && !model.busy && !needsAck);

  function update(next: Map<string, Decision>): void {
    decisions = next;
    // A change taken back from the folded section returns to its group for good.
    for (const id of folded) if (next.get(id) !== 'rejected') folded.delete(id);
    actions.save(decidedPlan(model.plan, next));
  }
  function decideOne(item: ReviewItem, decision: Decision): void {
    if (item.decidable) update(decide(model.plan, decisions, [item.op.id], decision));
  }
  async function toggle(item: ReviewItem): Promise<void> {
    if (expanded.has(item.op.id)) {
      expanded.delete(item.op.id);
      return;
    }
    expanded.add(item.op.id);
    if (!previews.has(item.op.id)) previews.set(item.op.id, await actions.preview(item.op));
  }
  function focusRow(index: number): void {
    const item = order[Math.max(0, Math.min(order.length - 1, index))];
    if (item) rows[item.op.id]?.focus();
  }
  function onKey(event: KeyboardEvent, index: number, item: ReviewItem): void {
    switch (event.key) {
      case 'j':
      case 'ArrowDown':
        focusRow(index + 1);
        break;
      case 'k':
      case 'ArrowUp':
        focusRow(index - 1);
        break;
      case 'a':
        decideOne(item, 'accepted');
        focusRow(index + 1);
        break;
      case 'r':
        decideOne(item, 'rejected');
        focusRow(index + 1);
        break;
      case 'u':
        decideOne(item, 'pending');
        break;
      default:
        return;
    }
    event.preventDefault();
  }
</script>

<div class="avo-review-view">
  {#if model.apply}
    <ApplyProgress state={model.apply} cancel={actions.cancelApply} undo={actions.undoRun} close={actions.closeApply} />
  {:else}
  <header class="avo-review-header">
    <p class="avo-review-summary">{model.plan.summary?.summary ?? `${plural(model.items.length, 'proposed change')}.`}</p>
    {#if notes.length > 0}
      <details class="avo-details">
        <summary>{plural(notes.length, 'note')} about this plan</summary>
        <ul class="avo-issues">
          {#each notes as note (note.text)}<li class={note.tone === 'error' ? 'avo-error' : note.tone === 'warning' ? 'avo-warning' : ''}>{note.text}</li>{/each}
        </ul>
      </details>
    {/if}
    {#if flagged > 0 && !model.aiReady}
      <p class="avo-hint">
        {plural(flagged, 'note')} could not be placed without AI.
        <button type="button" class="avo-link" onclick={actions.setUpAi}>Set up AI to place them</button>
      </p>
    {/if}
  </header>

  <div class="avo-review-toolbar">
    <input type="search" placeholder="Find" aria-label="Find in proposed changes" bind:value={filters.query} />
    <details class="avo-filters">
      <summary>Filters{filtering ? ' (on)' : ''}</summary>
      <div class="avo-filters-body">
        <select class="dropdown" aria-label="Decided by" bind:value={filters.source}>
          <option value="all">Decided by anyone</option>
          {#each OPERATION_SOURCES as source (source)}<option value={source}>{SOURCE_LABELS[source]}</option>{/each}
        </select>
        <select class="dropdown" aria-label="Destination" bind:value={filters.destination}>
          <option value="all">All destinations</option>
          {#each destinations as destination (destination)}<option value={destination}>{destination}</option>{/each}
        </select>
        <select class="dropdown" aria-label="Status" bind:value={filters.status}>
          <option value="all">Any status</option>
          <option value="pending">Undecided</option>
          <option value="accepted">Accepted</option>
          <option value="rejected">Rejected</option>
        </select>
        <label class="avo-review-threshold">
          <span>Confidence at least {percent(filters.minConfidence)}</span>
          <input type="range" min="0" max="1" step="0.05" bind:value={filters.minConfidence} />
        </label>
      </div>
    </details>
    <span class="avo-wizard-spacer"></span>
    <select class="dropdown" aria-label="Confidence to accept at" bind:value={threshold}>
      {#each THRESHOLDS as value (value)}<option {value}>{percent(value)} or more</option>{/each}
    </select>
    <button type="button" disabled={bulkCount === 0} onclick={() => update(acceptAbove(model.plan, decisions, shown, threshold))}>
      Accept {plural(bulkCount, 'change')}
    </button>
    <button
      type="button"
      disabled={model.busy || counts.pending === 0 || counts.accepted + counts.rejected === 0}
      title="Your accepted and rejected changes teach the plugin where similar notes belong. No AI is asked."
      onclick={() => actions.learn(decidedPlan(model.plan, decisions))}
    >
      Learn from my decisions
    </button>
  </div>
  <p class="avo-muted avo-review-keys">Nothing changes until you apply, and you can undo it. Keys: j and k move, a accepts, r rejects, Enter shows the change.</p>

  {#if shown.length === 0}
    <p class="avo-muted">No proposed change matches these filters.</p>
  {/if}

  {#snippet row(item: ReviewItem)}
    <ReviewRow
      {item}
      decision={decisions.get(item.op.id) ?? 'pending'}
      expanded={expanded.has(item.op.id)}
      preview={previews.get(item.op.id) ?? null}
      toggle={() => void toggle(item)}
      decide={(decision) => decideOne(item, decision)}
      openNote={actions.openNote}
      onkeydown={(event) => onKey(event, order.indexOf(item), item)}
      register={(element) => {
        if (element) rows[item.op.id] = element;
        else delete rows[item.op.id];
      }}
    />
  {/snippet}

  {#each groups as group (group.title)}
    <section class="avo-review-group" aria-label={group.title}>
      <h4 class="avo-dash-title">{group.title} ({group.items.length})</h4>
      <ul class="avo-rows">
        {#each showAll.has(group.title) ? group.items : group.items.slice(0, PAGE) as item (item.op.id)}
          {@render row(item)}
        {/each}
      </ul>
      {#if group.items.length > PAGE && !showAll.has(group.title)}
        <button type="button" class="avo-link" onclick={() => showAll.add(group.title)}>Show all {group.items.length}</button>
      {/if}
    </section>
  {/each}

  {#if rejected.length > 0}
    <details class="avo-details avo-review-rejected" bind:open={rejectedOpen}>
      <summary>Rejected ({rejected.length}): nothing happens to these</summary>
      <ul class="avo-rows">
        {#each rejected as item (item.op.id)}
          {@render row(item)}
        {/each}
      </ul>
    </details>
  {/if}

  <footer class="avo-review-footer">
    {#if hasMoves && model.linksAutoUpdateOff}
      <label class="avo-field avo-field-inline avo-warning">
        <input type="checkbox" bind:checked={acknowledged} />
        <span>Obsidian is set not to update links when notes move, so moved notes would leave broken links. Apply anyway (the run stops and can be undone if links break).</span>
      </label>
    {/if}
    {#each blocking as issue, index (index)}
      <p class="avo-error">{issue.message}</p>
    {/each}
    <span class="avo-muted">{counts.accepted} accepted, {counts.rejected} rejected, {counts.pending} undecided</span>
    <span class="avo-wizard-spacer"></span>
    <button type="button" class="mod-cta" disabled={!canApply} onclick={() => actions.apply(decidedPlan(model.plan, decisions))}>
      {model.busy ? 'Another run is changing the vault…' : `Apply ${plural(counts.accepted, 'accepted change')}`}
    </button>
  </footer>
  {/if}
</div>
