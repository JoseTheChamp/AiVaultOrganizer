<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { Lang } from '../../core/charter/presets/index';
  import { percent } from '../format';
  import type { Choice, ChoiceOption } from './wizard-state';

  interface Props {
    options: ChoiceOption[];
    choice: Choice;
    lang: Lang;
    /** Language is fixed while editing an existing charter. */
    langLocked: boolean;
    choose: (choice: Choice) => void;
    setLang: (lang: Lang) => void;
    /** The AI draft controls, when a language model is set up. */
    children?: Snippet;
  }

  let { options, choice, lang, langLocked, choose, setLang, children }: Props = $props();
</script>

{@render children?.()}

<fieldset class="avo-choices">
  <legend>How should this vault be organized?</legend>
  {#each options as option (option.choice)}
    <label class={['avo-choice', option.choice === choice && 'is-selected']}>
      <input type="radio" name="avo-method" value={option.choice} checked={option.choice === choice} onchange={() => choose(option.choice)} />
      <span class="avo-choice-body">
        <span class="avo-choice-title">
          {option.label}
          {#if option.recommended}<span class="avo-chip">Recommended</span>{/if}
          {#if option.fit !== null && option.fit > 0}<span class="avo-muted">fits {percent(option.fit)}</span>{/if}
        </span>
        <span class="avo-muted">{option.summary}</span>
      </span>
    </label>
  {/each}
</fieldset>

<label class="avo-field">
  <span>Language of folder names and the charter</span>
  <select class="dropdown" value={lang} disabled={langLocked} onchange={(event) => setLang(event.currentTarget.value === 'cs' ? 'cs' : 'en')}>
    <option value="en">English</option>
    <option value="cs">Čeština</option>
  </select>
</label>
