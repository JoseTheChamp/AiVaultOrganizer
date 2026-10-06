<script lang="ts">
  import { plural, verb } from '../../core/model/text';
  import type { DashboardActions, DashboardModel, ModelStatus } from './dashboard-state';

  interface Props {
    model: DashboardModel;
    actions: DashboardActions;
  }

  let { model, actions }: Props = $props();
  const state = $derived(model.state);
  const busy = $derived(model.busy);

  const GRADE = { good: 'Good', fair: 'Fair', poor: 'Needs work' } as const;
  const RUN = { completed: 'completed', failed: 'stopped after an error', cancelled: 'cancelled', 'verification-failed': 'stopped to protect links', running: 'did not finish' } as const;

  const describe = (status: ModelStatus, none: string) => (status.model ? `${status.model} on ${status.where}` : none);
</script>

<div class="avo-dashboard">
  {#if model.error}
    <p class="avo-error" role="alert">{model.error}</p>
  {:else if !state}
    <p class="avo-muted">Reading the vault…</p>
  {:else}
    <section class="avo-dash-section" aria-labelledby="avo-dash-health">
      <div class={['avo-score', `avo-score-${state.health.grade}`]}>
        <span class="avo-score-value">{state.health.score}</span>
        <span class="avo-score-label" id="avo-dash-health">Health: {GRADE[state.health.grade]}</span>
      </div>
      <p class="avo-muted">{plural(state.health.notes, 'note')}</p>
    </section>

    <section class="avo-dash-section" aria-labelledby="avo-dash-charter">
      <h4 class="avo-dash-title" id="avo-dash-charter">Charter</h4>
      {#if state.charter.status === 'ok'}
        <p>{state.charter.method}, revision {state.charter.revision}</p>
        {#if state.drift}
          <p>
            {#if state.drift.offCharter === 0}
              Every note follows the charter.
            {:else}
              {plural(state.drift.offCharter, 'note')} of {state.drift.notes} {verb(state.drift.offCharter, 'is', 'are')} off-charter.
            {/if}
          </p>
        {/if}
        <div class="avo-dash-actions">
          <button type="button" class="mod-cta" disabled={busy} onclick={actions.plan}>Plan re-alignment</button>
          <button type="button" onclick={actions.openCharter}>Open charter</button>
          <button type="button" disabled={busy} onclick={actions.setUp}>Edit charter</button>
        </div>
      {:else if state.charter.status === 'missing'}
        <p>No charter yet. The charter is a note that describes your system; the plugin follows it.</p>
        <div class="avo-dash-actions">
          <button type="button" class="mod-cta" disabled={busy} onclick={actions.setUp}>Set up charter</button>
        </div>
      {:else if state.charter.status === 'invalid'}
        <p class="avo-warning">The charter rules have {plural(state.charter.problems, 'problem')}. Fix them in the charter note.</p>
        <div class="avo-dash-actions">
          <button type="button" class="mod-cta" onclick={actions.openCharter}>Open charter</button>
        </div>
      {:else}
        <p class="avo-warning">"{state.charter.path}" is not a charter. Rename it, or choose another charter note in the settings.</p>
      {/if}
    </section>

    {#if state.pending}
      <section class="avo-dash-section" aria-labelledby="avo-dash-pending">
        <h4 class="avo-dash-title" id="avo-dash-pending">Pending plan</h4>
        <p>{plural(state.pending.open, 'proposed change')} {verb(state.pending.open, 'waits', 'wait')} for your review.</p>
        <div class="avo-dash-actions">
          <button type="button" class="mod-cta" disabled={busy} onclick={actions.review}>Review</button>
        </div>
      </section>
    {/if}

    <section class="avo-dash-section" aria-labelledby="avo-dash-run">
      <h4 class="avo-dash-title" id="avo-dash-run">Last run</h4>
      {#if state.lastRun}
        <p>
          {new Date(state.lastRun.at).toLocaleString()}: {plural(state.lastRun.applied, 'change')}, {RUN[state.lastRun.status]}{state.lastRun.undone ? ', undone' : ''}.
        </p>
      {:else}
        <p class="avo-muted">Nothing has been applied yet.</p>
      {/if}
      {#if state.canUndo}
        <div class="avo-dash-actions">
          <button type="button" disabled={busy} onclick={actions.undo}>Undo last run</button>
        </div>
      {/if}
    </section>

    <section class="avo-dash-section" aria-labelledby="avo-dash-ai">
      <h4 class="avo-dash-title" id="avo-dash-ai">AI</h4>
      <p>Language model: {describe(state.chat, 'none (rules and similar notes only)')}</p>
      <p>Better similarity: {describe(state.embeddings, 'off (shared words)')}</p>
    </section>

    <div class="avo-dash-actions">
      <button type="button" onclick={actions.analyze}>Analyze vault</button>
      <button type="button" onclick={actions.refresh}>Refresh</button>
    </div>
  {/if}
</div>
