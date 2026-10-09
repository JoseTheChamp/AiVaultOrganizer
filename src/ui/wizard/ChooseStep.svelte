<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { VaultAnalysis } from '../../core/analysis/analyze';
  import { percent } from '../format';
  import CharterTree from './CharterTree.svelte';
  import type { CharterFit } from './charter-tree';
  import VaultDetails from './VaultDetails.svelte';
  import type { Choice, ChoiceOption } from './wizard-state';

  interface Props {
    analysis: VaultAnalysis;
    options: ChoiceOption[];
    choice: Choice;
    /** The chosen system as it would look in this vault. */
    fit: CharterFit;
    choose: (choice: Choice) => void;
    /** The AI suggestion controls (or a way to set AI up). */
    children?: Snippet;
  }

  let { analysis, options, choice, fit, choose, children }: Props = $props();
  const selected = $derived(options.find((option) => option.choice === choice) ?? options[0]);
</script>

<VaultDetails {analysis} />

<div class="avo-choose">
  <fieldset class="avo-choices">
    <legend class="avo-visually-hidden">Systems</legend>
    {#each options as option (option.choice)}
      <label class={['avo-choice', option.choice === choice && 'is-selected']}>
        <input type="radio" name="avo-method" value={option.choice} checked={option.choice === choice} onchange={() => choose(option.choice)} />
        <span class="avo-choice-body">
          <span class="avo-choice-title">
            {option.label}
            {#if option.recommended}<span class="avo-chip">Recommended</span>{/if}
            {#if option.fit !== null && option.fit >= 0.05}<span class="avo-muted">{percent(option.fit)} match</span>{/if}
          </span>
          <span class="avo-muted">{option.about.tagline}</span>
        </span>
      </label>
    {/each}
    {@render children?.()}
  </fieldset>

  {#if selected}
    <section class="avo-choose-preview" aria-label={`${selected.label} in your vault`}>
      <h4 class="avo-choose-heading">
        {selected.label}
        {#if selected.about.origin}<span class="avo-muted">by {selected.about.origin}</span>{/if}
      </h4>
      <CharterTree {fit} />
      <details class="avo-details">
        <summary>About {selected.label}</summary>
        <p>{selected.about.description}</p>
        {#if selected.about.goodFor.length > 0}
          <p class="avo-good">Good for</p>
          <ul class="avo-issues">{#each selected.about.goodFor as item (item)}<li>{item}</li>{/each}</ul>
        {/if}
        {#if selected.about.notFor.length > 0}
          <p class="avo-bad">Not so good for</p>
          <ul class="avo-issues">{#each selected.about.notFor as item (item)}<li>{item}</li>{/each}</ul>
        {/if}
      </details>
    </section>
  {/if}
</div>
