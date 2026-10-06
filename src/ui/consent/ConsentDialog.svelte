<script lang="ts">
  import { plural } from '../../core/model/text';
  import { CARD_CONTENTS, type ConsentChoice, type ConsentState, range } from './consent-state';

  interface Props {
    state: ConsentState;
    /** Label for going on without the model, e.g. "Plan without it". */
    withoutLabel: string;
    answer: (choice: ConsentChoice) => void;
  }

  let { state, withoutLabel, answer }: Props = $props();
  const money = (value: number) => value.toFixed(value < 1 ? 3 : 2);
</script>

<div class="avo-consent">
  <p>
    The language model <strong>{state.model}</strong> on <strong>{state.where}</strong> would {state.purpose}: {plural(state.notes, 'note')}.
  </p>

  {#if state.blocked}
    <p class="avo-warning" role="alert">
      Local-only mode is on, so {state.where} cannot be reached. Turn local-only mode off in the settings to use this model, or go on without it.
    </p>
  {/if}

  <h4 class="avo-dash-title">What is sent</h4>
  <p>{CARD_CONTENTS}</p>
  <p class="avo-muted">
    {#if state.local}
      The model runs on this computer; nothing leaves it.
    {:else}
      These go to {state.where} and are handled under its terms.
    {/if}
    Notes marked private{state.withheld > 0 ? ` (${state.withheld} here)` : ''} and notes your charter ignores are never sent.
  </p>

  <h4 class="avo-dash-title">Estimate</h4>
  <ul class="avo-issues">
    <li>{range(state.calls)} requests, about {range(state.tokens)} tokens in all.</li>
    {#if state.cost}
      <li>About {range(state.cost, money)} at the prices in your settings.</li>
    {/if}
    {#if state.overBudget}
      <li class="avo-warning">This may exceed the token budget for one run; notes left over are flagged for you instead.</li>
    {/if}
  </ul>
  <p class="avo-muted">Answers are cached, so planning again with the same notes costs nothing. Nothing in the vault changes until you review and apply the plan.</p>

  <div class="avo-wizard-footer">
    <button type="button" onclick={() => answer('cancel')}>Cancel</button>
    <span class="avo-wizard-spacer"></span>
    <button type="button" onclick={() => answer('without')}>{withoutLabel}</button>
    <button type="button" class="mod-cta" disabled={state.blocked} onclick={() => answer('model')}>Use the model</button>
  </div>
</div>
