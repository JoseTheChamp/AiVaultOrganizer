<script lang="ts">
  import { type ApplyState, PHASE_LABELS } from './run-report';

  interface Props {
    state: ApplyState;
    cancel: () => void;
    undo: () => void;
    close: () => void;
  }

  let { state, cancel, undo, close }: Props = $props();
  const TONE = { completed: 'avo-score-good', cancelled: 'avo-score-fair', failed: 'avo-score-poor', 'verification-failed': 'avo-score-poor' } as const;
</script>

<section class="avo-apply" aria-live="polite" aria-label="Apply">
  {#if state.invalid}
    <h3>The plan cannot be applied</h3>
    <p>Nothing was changed. Fix or reject these operations and try again:</p>
    <ul class="avo-issues">
      {#each state.invalid as problem (problem)}<li class="avo-error">{problem}</li>{/each}
    </ul>
    <div class="avo-wizard-footer"><span class="avo-wizard-spacer"></span><button type="button" class="mod-cta" onclick={close}>Back to the review</button></div>
  {:else if state.report}
    {@const report = state.report}
    <h3>{report.title}</h3>
    <p>{report.counts}</p>
    {#if report.message}<p class="avo-warning">{report.message}</p>{/if}
    {#if report.health}
      <div class="avo-score-header">
        <div class={['avo-score', TONE[report.status]]}>
          <span class="avo-score-value">{report.health.after}</span>
          <span class="avo-score-label">Health, was {report.health.before}</span>
        </div>
        <p>
          A backup was saved to <span class="avo-path">{report.backup}</span> before anything changed.
          {#if report.undoable}Undo restores every note exactly as it was, unless you edit it first.{/if}
        </p>
      </div>
    {:else}
      <p>A backup was saved to <span class="avo-path">{report.backup}</span>.</p>
    {/if}
    {#if report.problems.length > 0}
      <h4 class="avo-dash-title">Not applied</h4>
      <ul class="avo-issues">
        {#each report.problems as problem (problem)}<li>{problem}</li>{/each}
      </ul>
    {/if}
    <div class="avo-wizard-footer">
      {#if report.undoable}<button type="button" onclick={undo}>Undo this run</button>{/if}
      <span class="avo-wizard-spacer"></span>
      <button type="button" class="mod-cta" onclick={close}>Done</button>
    </div>
  {:else}
    <h3>{state.phase === 'done' ? 'Finishing…' : PHASE_LABELS[state.phase]}</h3>
    {#if state.phase === 'applying' && state.total > 0}
      <progress class="avo-meter" max={state.total} value={state.done} aria-label="Changes applied"></progress>
      <p class="avo-muted">{state.done} of {state.total}</p>
    {/if}
    <p class="avo-muted">Links are checked after every batch; the run stops if one breaks. A cancelled run can be undone like a finished one.</p>
    <div class="avo-wizard-footer">
      <span class="avo-wizard-spacer"></span>
      <button type="button" disabled={state.cancelling || state.phase !== 'applying'} onclick={cancel}>{state.cancelling ? 'Stopping after this batch…' : 'Cancel'}</button>
    </div>
  {/if}
</section>
