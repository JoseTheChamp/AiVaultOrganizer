<script lang="ts">
  import { plural, verb } from '../../core/model/text';
  import type { DashboardActions, DashboardModel, ModelStatus, NextStep } from './dashboard-state';

  interface Props {
    model: DashboardModel;
    actions: DashboardActions;
  }

  let { model, actions }: Props = $props();
  const state = $derived(model.state);
  const busy = $derived(model.busy);

  const GRADE = { good: 'Good', fair: 'Fair', poor: 'Needs work' } as const;

  /** What the card says and does for each next step. */
  function card(next: NextStep): { title: string; detail: string; action: { label: string; run: () => void } | null } {
    switch (next.kind) {
      case 'set-up-charter':
        return { title: 'Choose how to organize your vault', detail: 'Pick a system and see how your notes would fit it.', action: { label: 'Choose a system', run: actions.setUp } };
      case 'fix-charter':
        return { title: 'The charter has problems', detail: 'Fix them in the charter note, then come back.', action: { label: 'Open charter', run: actions.openCharter } };
      case 'review':
        return { title: `Review ${plural(next.changes, 'proposed change')}`, detail: 'Nothing changes until you approve.', action: { label: 'Review', run: actions.review } };
      case 'organize':
        return {
          title: `${plural(next.notes, 'note')} ${verb(next.notes, 'is', 'are')} out of place`,
          detail: 'Plan where they belong; you approve every change.',
          action: { label: 'Organize', run: actions.plan },
        };
      case 'tidy':
        return { title: 'Everything is in place', detail: 'Notes that drift from your system show up here.', action: null };
    }
  }

  const where = (status: ModelStatus) => (status.local ? 'on this computer' : `via ${status.where}`);
</script>

<div class="avo-dashboard">
  {#if model.error}
    <p class="avo-error" role="alert">{model.error}</p>
  {:else if !state}
    <p class="avo-muted">Reading the vault…</p>
  {:else}
    {@const next = card(state.next)}
    <div class="avo-dash-health">
      <div class={['avo-score', `avo-score-${state.health.grade}`]}>
        <span class="avo-score-value">{state.health.score}</span>
        <span class="avo-score-label">{GRADE[state.health.grade]}</span>
      </div>
      <span class="avo-muted">Vault health, {plural(state.health.notes, 'note')}</span>
    </div>

    <section class="avo-next" aria-label="Next step">
      <p class="avo-next-title">{next.title}</p>
      <p class="avo-muted">{next.detail}</p>
      {#if next.action}
        <button type="button" class="mod-cta" disabled={busy} onclick={next.action.run}>{next.action.label}</button>
      {/if}
    </section>

    <dl class="avo-status">
      <dt>System</dt>
      <dd>
        {#if state.charter.status === 'ok'}
          {state.charter.method}
          <button type="button" class="avo-link" onclick={actions.openCharter}>Open</button>
          <button type="button" class="avo-link" disabled={busy} onclick={actions.setUp}>Change</button>
        {:else}
          <span class="avo-muted">Not chosen yet</span>
        {/if}
      </dd>

      <dt>AI</dt>
      <dd>
        {#if state.chat.model}
          {state.chat.model} <span class="avo-muted">{where(state.chat)}</span>
          <button type="button" class="avo-link" onclick={actions.setUpAi}>Change</button>
        {:else}
          <span class="avo-muted">Off</span>
          <button type="button" class="avo-link" onclick={actions.setUpAi}>Set up</button>
        {/if}
      </dd>

      <dt>Last change</dt>
      <dd>
        {#if state.lastRun}
          {new Date(state.lastRun.at).toLocaleDateString()}, {plural(state.lastRun.applied, 'change')}{state.lastRun.undone ? ' (undone)' : ''}
          {#if state.canUndo}<button type="button" class="avo-link" disabled={busy} onclick={actions.undo}>Undo</button>{/if}
        {:else}
          <span class="avo-muted">None yet</span>
        {/if}
      </dd>
    </dl>

    <div class="avo-dash-footer">
      <button type="button" class="avo-link" onclick={actions.analyze}>Full diagnosis</button>
      <button type="button" class="avo-link" onclick={actions.refresh}>Refresh</button>
    </div>
  {/if}
</div>
