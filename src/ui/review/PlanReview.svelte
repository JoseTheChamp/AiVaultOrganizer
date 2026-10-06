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
  const SOURCE_LABELS = { rule: 'Rules', knn: 'Similar notes', llm: 'Language model', user: 'You' } as const;

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
  const groups = $derived(groupItems(shown));
  const order = $derived(groups.flatMap((group) => (showAll.has(group.title) ? group.items : group.items.slice(0, PAGE))));
  const counts = $derived(decisionCounts(model.items, decisions));
  const destinations = $derived(destinationsOf(model.items));
  const bulkCount = $derived(shown.filter((item) => item.decidable && decisions.get(item.op.id) === 'pending' && item.op.confidence >= threshold).length);
  const hasMoves = $derived(model.plan.operations.some((op) => op.kind === 'move' && decisions.get(op.id) === 'accepted'));
  const blocking = $derived(model.validation.issues.filter((issue) => issue.severity === 'error' && (!issue.opId || decisions.get(issue.opId) === 'accepted')));
  const general = $derived(model.validation.issues.filter((issue) => !issue.opId));
  const needsAck = $derived(hasMoves && model.linksAutoUpdateOff && !acknowledged);
  const canApply = $derived(counts.accepted > 0 && blocking.length === 0 && !model.busy && !needsAck);

  function update(next: Map<string, Decision>): void {
    decisions = next;
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
    {#if model.plan.summary}
      <p>{model.plan.summary.summary}</p>
      {#if model.plan.summary.highlights.length > 0}
        <ul class="avo-issues">
          {#each model.plan.summary.highlights as highlight (highlight)}<li>{highlight}</li>{/each}
        </ul>
      {/if}
    {/if}
    {#each model.plan.warnings as warning (warning.code)}
      <p class="avo-warning">{warning.message}</p>
    {/each}
    {#each general as issue (issue.message)}
      <p class={issue.severity === 'error' ? 'avo-error' : 'avo-warning'}>{issue.message}</p>
    {/each}
    <p class="avo-muted">
      Nothing changes until you apply. A backup is made first, and every change can be undone. Keys: j and k move, a accepts, r rejects, u undecides,
      Enter shows what changes.
    </p>
  </header>

  <div class="avo-review-toolbar" role="search">
    <input type="search" placeholder="Find" aria-label="Find in proposed changes" bind:value={filters.query} />
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

  <div class="avo-review-bulk">
    <label class="avo-review-threshold">
      <span>Accept all shown at or above {percent(threshold)}</span>
      <input type="range" min="0.5" max="1" step="0.05" bind:value={threshold} />
    </label>
    <button type="button" disabled={bulkCount === 0} onclick={() => update(acceptAbove(model.plan, decisions, shown, threshold))}>
      Accept {plural(bulkCount, 'change')}
    </button>
    <span class="avo-wizard-spacer"></span>
    <button
      type="button"
      disabled={model.busy || counts.pending === 0 || counts.accepted + counts.rejected === 0}
      title="Places you accepted teach the plugin where similar notes belong; undecided rows are re-scored and flagged notes may get a place. No model is asked."
      onclick={() => actions.learn(decidedPlan(model.plan, decisions))}
    >
      Learn from my decisions
    </button>
  </div>

  {#if shown.length === 0}
    <p class="avo-muted">No proposed change matches these filters.</p>
  {/if}

  {#each groups as group (group.title)}
    <section class="avo-review-group" aria-label={group.title}>
      <h4 class="avo-dash-title">{group.title} ({group.items.length})</h4>
      <ul class="avo-rows">
        {#each showAll.has(group.title) ? group.items : group.items.slice(0, PAGE) as item (item.op.id)}
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
        {/each}
      </ul>
      {#if group.items.length > PAGE && !showAll.has(group.title)}
        <button type="button" class="avo-link" onclick={() => showAll.add(group.title)}>Show all {group.items.length}</button>
      {/if}
    </section>
  {/each}

  <footer class="avo-review-footer">
    {#if hasMoves && model.linksAutoUpdateOff}
      <label class="avo-field avo-field-inline avo-warning">
        <input type="checkbox" bind:checked={acknowledged} />
        <span>Obsidian is set not to update links when notes move, so moved notes would leave broken links. Apply anyway (the run stops and can be undone if links break).</span>
      </label>
    {/if}
    {#each blocking as issue (issue.message)}
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
