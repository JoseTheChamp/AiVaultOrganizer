<script lang="ts">
  import { plural, verb } from '../../core/model/text';
  import { clock, progressText, remainingText } from '../activity';
  import { statusView } from '../ai-status';
  import type { DashboardActions, DashboardModel, NextStep } from './dashboard-state';

  interface Props {
    model: DashboardModel;
    actions: DashboardActions;
  }

  let { model, actions }: Props = $props();
  const current = $derived(model.state);
  // Nothing that changes the vault, or starts another long task, while one runs.
  const busy = $derived(model.busy || model.activity !== null);
  const ai = $derived(model.aiStatus ? statusView(model.aiStatus) : null);

  // A task's clock ticks on its own: one request to a local model may take minutes, and the card
  // must not look stuck meanwhile.
  let now = $state(Date.now());
  $effect(() => {
    if (!model.activity) return;
    now = Date.now();
    const timer = window.setInterval(() => (now = Date.now()), 1000);
    return () => window.clearInterval(timer);
  });

  const GRADE = { good: 'Good', fair: 'Fair', poor: 'Needs work' } as const;

  interface Card {
    title: string;
    detail: string;
    action: { label: string; run: () => void } | null;
    /** A smaller second way forward. */
    alternative?: { label: string; run: () => void };
  }

  /** What the card says and does for each next step. */
  function card(next: NextStep, aiOn: boolean): Card {
    const withoutAi = aiOn ? undefined : { label: 'Set up AI', run: actions.setUpAi };
    switch (next.kind) {
      case 'set-up-ai':
        return {
          title: 'Start by connecting AI',
          detail: "AI sorts the notes your rules can't place. Free on this computer, or with your API key.",
          action: { label: 'Set up AI', run: actions.setUpAi },
          alternative: { label: 'Continue without AI', run: actions.setUp },
        };
      case 'set-up-charter':
        return { title: 'Choose how to organize your vault', detail: 'Pick a system and see how your notes would fit it.', action: { label: 'Choose a system', run: actions.setUp } };
      case 'fix-charter':
        return { title: 'The charter has problems', detail: 'Fix them in the charter note, then come back.', action: { label: 'Open charter', run: actions.openCharter } };
      case 'review':
        return { title: `Review ${plural(next.changes, 'proposed change')}`, detail: 'Nothing changes until you approve.', action: { label: 'Review', run: actions.review } };
      case 'organize':
        return {
          title: `${plural(next.notes, 'note')} ${verb(next.notes, 'is', 'are')} out of place`,
          detail: aiOn ? 'Plan where they belong; you approve every change.' : 'Without AI, only notes your rules or similar notes recognize get placed.',
          action: { label: 'Organize', run: actions.plan },
          ...(withoutAi ? { alternative: withoutAi } : {}),
        };
      case 'new-folders': {
        const count = next.folders.length;
        const names = next.folders.map((path) => path.split('/').pop() ?? path).join(', ');
        return {
          title: `${plural(count, 'new folder')} in your system`,
          detail: `${names}: say what goes in ${count === 1 ? 'it' : 'them'}, and organize again to fill ${count === 1 ? 'it' : 'them'}.`,
          action: { label: 'Add and organize', run: actions.organizeAgain },
        };
      }
      case 'waiting':
        return {
          title: `${plural(next.notes, 'note')} ${verb(next.notes, 'waits', 'wait')} in ${next.where}`,
          detail: 'No folder fits them yet. Add folders for them, then organize to move them there.',
          action: { label: 'Add folders', run: actions.setUp },
          alternative: { label: 'Organize', run: actions.plan },
        };
      case 'tidy':
        return { title: 'Everything is in place', detail: 'Notes that drift from your system show up here.', action: null };
    }
  }
</script>

<div class="avo-dashboard">
  {#if model.error}
    <p class="avo-error" role="alert">{model.error}</p>
  {:else if !current}
    <p class="avo-muted">Reading the vault…</p>
  {:else}
    <div class="avo-dash-health">
      <div class={['avo-score', `avo-score-${current.health.grade}`]}>
        <span class="avo-score-value">{current.health.score}</span>
        <span class="avo-score-label">{GRADE[current.health.grade]}</span>
      </div>
      <span class="avo-muted">Vault health, {plural(current.health.notes, 'note')}</span>
    </div>

    {#if model.activity}
      {@const activity = model.activity}
      <section class="avo-next" aria-label="In progress">
        <p class="avo-next-title">{activity.title}…</p>
        <p class="avo-muted" aria-live="polite">{progressText(activity)}</p>
        {#if activity.total}
          <progress class="avo-meter" max={activity.total} value={activity.done ?? 0} aria-label={activity.title}></progress>
        {:else}
          <progress class="avo-meter" aria-label={activity.title}></progress>
        {/if}
        <div class="avo-activity-footer">
          <span class="avo-muted">{clock(now - activity.startedAt)}{activity.remaining !== undefined ? `, ${remainingText(activity.remaining)}` : ''}</span>
          {#if activity.stoppable}
            <button type="button" onclick={actions.stop}>Stop</button>
          {/if}
        </div>
      </section>
    {:else}
      {@const next = card(current.next, current.chat.model !== null)}
      <section class="avo-next" aria-label="Next step">
        <p class="avo-next-title">{next.title}</p>
        <p class="avo-muted">{next.detail}</p>
        <div class="avo-dash-actions">
          {#if next.action}
            <button type="button" class="mod-cta" disabled={busy} onclick={next.action.run}>{next.action.label}</button>
          {/if}
          {#if next.alternative}
            <button type="button" class="avo-link" disabled={busy} onclick={next.alternative.run}>{next.alternative.label}</button>
          {/if}
        </div>
      </section>
    {/if}

    <dl class="avo-status">
      <dt>System</dt>
      <dd>
        {#if current.charter.status === 'ok'}
          {current.charter.method}
          <button type="button" class="avo-link" onclick={actions.openCharter}>Open</button>
          <button type="button" class="avo-link" disabled={busy} onclick={actions.setUp}>Change</button>
        {:else}
          <span class="avo-muted">Not chosen yet</span>
        {/if}
      </dd>

      <dt>AI</dt>
      <dd>
        {#if current.chat.model}
          <span class="avo-ai-line">
            <span class={['avo-light', `avo-light-${ai?.tone ?? 'off'}`]} aria-hidden="true"></span>
            {current.chat.model}
            <span class="avo-muted">{ai ? ai.label : 'Checking…'}{current.chat.local ? ', on this computer' : `, via ${current.chat.where}`}</span>
          </span>
          {#if ai?.problem}<span class="avo-ai-problem">{ai.problem}</span>{/if}
          <button type="button" class="avo-link" onclick={actions.setUpAi}>{ai?.problem ? 'Fix' : 'Change'}</button>
        {:else}
          <span class="avo-muted">Off</span>
          <button type="button" class="avo-link" onclick={actions.setUpAi}>Set up</button>
        {/if}
      </dd>

      <dt>Last change</dt>
      <dd>
        {#if current.lastRun}
          {new Date(current.lastRun.at).toLocaleDateString()}, {plural(current.lastRun.applied, 'change')}{current.lastRun.undone ? ' (undone)' : ''}
          {#if current.canUndo}<button type="button" class="avo-link" disabled={busy} onclick={actions.undo}>Undo</button>{/if}
        {:else}
          <span class="avo-muted">None yet</span>
        {/if}
      </dd>
    </dl>

    <div class="avo-dash-footer">
      {#if current.charter.status === 'ok'}
        <button type="button" class="avo-link" disabled={busy} onclick={actions.organizeAgain}>Organize again</button>
      {/if}
      <button type="button" class="avo-link" onclick={actions.analyze}>Full diagnosis</button>
      <button type="button" class="avo-link" onclick={actions.refresh}>Refresh</button>
    </div>
  {/if}
</div>
