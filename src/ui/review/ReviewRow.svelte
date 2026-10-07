<script lang="ts">
  import type { OperationPreview as Preview } from '../../core/apply/preview';
  import ConfidenceBadge from '../components/ConfidenceBadge.svelte';
  import OperationPreview from './OperationPreview.svelte';
  import type { Decision, ReviewItem } from './review-state';

  interface Props {
    item: ReviewItem;
    decision: Decision;
    expanded: boolean;
    /** The preview, once loaded. */
    preview: Preview | null;
    toggle: () => void;
    decide: (decision: Decision) => void;
    openNote: (path: string) => void;
    /** Keyboard shortcuts while the row has focus. */
    onkeydown: (event: KeyboardEvent) => void;
    /** Registers the row's focus target with the list, for j/k. */
    register: (element: HTMLButtonElement | null) => void;
  }

  let { item, decision, expanded, preview, toggle, decide, openNote, onkeydown, register }: Props = $props();
  let summary = $state<HTMLButtonElement | null>(null);
  $effect(() => {
    register(summary);
    return () => register(null);
  });
  const SOURCE = { rule: 'a rule', knn: 'similar notes', llm: 'AI', user: 'you' } as const;
  const notePath = $derived('path' in item.op ? item.op.path : item.op.from);
</script>

<li class={['avo-row', `is-${decision}`]}>
  <div class="avo-row-main">
    <button type="button" class="avo-row-summary" bind:this={summary} aria-expanded={expanded} {onkeydown} onclick={toggle}>
      <span class="avo-row-title">{item.description}</span>
    </button>
    {#if item.decidable}
      <ConfidenceBadge confidence={item.op.confidence} source={SOURCE[item.op.source]} />
      <div class="avo-row-actions" role="group" aria-label="Decision">
        <button type="button" class={['avo-decide', decision === 'accepted' && 'is-active']} aria-pressed={decision === 'accepted'} onclick={() => decide(decision === 'accepted' ? 'pending' : 'accepted')}>Accept</button>
        <button type="button" class={['avo-decide', decision === 'rejected' && 'is-active']} aria-pressed={decision === 'rejected'} onclick={() => decide(decision === 'rejected' ? 'pending' : 'rejected')}>Reject</button>
      </div>
    {:else}
      <button type="button" class="avo-link" onclick={() => openNote(notePath)}>Open note</button>
    {/if}
  </div>
  {#each item.issues as issue (issue.message)}
    <p class={issue.severity === 'error' ? 'avo-error' : 'avo-warning'}>{issue.message}</p>
  {/each}
  {#if expanded}
    {#if item.op.rationale}<p class="avo-muted avo-row-rationale">Why: {item.op.rationale}</p>{/if}
    {#if preview}
      <OperationPreview {preview} {openNote} />
    {:else}
      <p class="avo-muted">Loading preview…</p>
    {/if}
  {/if}
</li>
