<script lang="ts">
  import { plural } from '../../core/model/text';
  import { CARD_CONTENTS, type ConsentChoice, type ConsentState, range } from './consent-state';

  interface Props {
    state: ConsentState;
    /** Label for going on without the model, e.g. "Without AI". */
    withoutLabel: string;
    answer: (choice: ConsentChoice) => void;
  }

  let { state, withoutLabel, answer }: Props = $props();
  const money = (value: number) => value.toFixed(value < 1 ? 3 : 2);
</script>

<div class="avo-consent">
  <p>
    <strong>{state.model}</strong>
    {state.local ? 'on this computer' : `via ${state.where}`} would {state.purpose}: {plural(state.notes, 'note')}.
  </p>
  <p class="avo-muted">
    About {range(state.calls)} requests and {range(state.tokens)} tokens{#if state.cost}, about {range(state.cost, money)} at your prices{/if}.
    {#if state.local}Nothing leaves this computer.{/if}
  </p>

  {#if state.blocked}
    <p class="avo-warning" role="alert">Local-only mode is on, so {state.where} cannot be reached. Turn it off in the AI settings to use this model.</p>
  {/if}
  {#if state.overBudget}
    <p class="avo-warning">This may go over your token budget for one run; notes left over are flagged for you.</p>
  {/if}

  <details class="avo-details">
    <summary>What is sent</summary>
    <p>{CARD_CONTENTS}</p>
    <p>
      {state.local ? 'It stays on this computer.' : `It goes to ${state.where}.`}
      Private notes{state.withheld > 0 ? ` (${state.withheld} here)` : ''} and ignored notes are never sent. Answers are cached, so asking again costs nothing.
    </p>
  </details>

  <div class="avo-wizard-footer">
    <button type="button" onclick={() => answer('cancel')}>Cancel</button>
    <span class="avo-wizard-spacer"></span>
    <button type="button" onclick={() => answer('without')}>{withoutLabel}</button>
    <button type="button" class="mod-cta" disabled={state.blocked} onclick={() => answer('model')}>Use AI</button>
  </div>
</div>
