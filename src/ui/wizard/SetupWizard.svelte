<script lang="ts">
  import { renderCharterNote } from '../../core/charter/charter-note';
  import { customizeCharter } from '../../core/charter/customize';
  import { type Lang, toLang } from '../../core/charter/presets/index';
  import type { Charter } from '../../core/charter/schema';
  import CharterStep from './CharterStep.svelte';
  import CustomizeStep from './CustomizeStep.svelte';
  import DiagnoseStep from './DiagnoseStep.svelte';
  import MethodStep from './MethodStep.svelte';
  import { baseCharter, type Choice, choiceOptions, initialChanges, previewCharter, recommendedChoice, STEPS, type WizardInput, type WizardStep } from './wizard-state';

  interface Props {
    input: WizardInput;
    /** Writes the charter (through a reviewed plan) and, when asked, plans the vault against it. */
    submit: (charter: Charter, planNow: boolean) => void;
    cancel: () => void;
  }

  let { input, submit, cancel }: Props = $props();

  // The wizard owns its working copy of the choices; the input it was opened with does not change.
  const start = (() => {
    const lang: Lang = input.existing ? toLang(input.existing.language) : input.analysis.stats.language.language;
    const choice = recommendedChoice(input);
    return { lang, choice, changes: initialChanges(baseCharter(input, choice, lang)) };
  })();

  let step = $state<WizardStep>('diagnose');
  let lang = $state(start.lang);
  let choice = $state<Choice>(start.choice);
  let changes = $state(start.changes);
  let planNow = $state(true);

  const options = $derived(choiceOptions(input, lang));
  const base = $derived(baseCharter(input, choice, lang));
  const result = $derived(customizeCharter(base, changes));
  const charter = $derived(result.ok ? result.value : null);
  const problems = $derived(result.ok ? [] : result.error);
  const preview = $derived(charter ? previewCharter(input, charter) : null);
  const index = $derived(STEPS.findIndex((candidate) => candidate.id === step));

  // A new method or language starts the form over from that charter.
  function choose(next: Choice): void {
    choice = next;
    changes = initialChanges(baseCharter(input, next, lang));
  }
  function setLang(next: Lang): void {
    lang = next;
    changes = initialChanges(baseCharter(input, choice, next));
  }
  function go(offset: number): void {
    const next = STEPS[index + offset];
    if (next) step = next.id;
  }
</script>

<div class="avo-wizard">
  <ol class="avo-steps" aria-label="Setup steps">
    {#each STEPS as candidate, i (candidate.id)}
      <li class={['avo-step', i === index && 'is-current', i < index && 'is-done']} aria-current={i === index ? 'step' : undefined}>
        {i + 1}. {candidate.label}
      </li>
    {/each}
  </ol>

  <div class="avo-wizard-body">
    {#if step === 'diagnose'}
      <DiagnoseStep analysis={input.analysis} />
    {:else if step === 'method'}
      <MethodStep {options} {choice} {lang} langLocked={choice === 'existing'} {choose} {setLang} />
    {:else if step === 'customize'}
      <CustomizeStep {base} {changes} {problems} {preview} />
    {:else if charter}
      <CharterStep
        path={input.charterPath}
        text={renderCharterNote(charter)}
        updating={input.existing !== null}
        replacesInvalid={input.replacesInvalid}
        {planNow}
        setPlanNow={(value) => (planNow = value)}
      />
    {/if}
  </div>

  <div class="avo-wizard-footer">
    <button type="button" onclick={cancel}>Cancel</button>
    <span class="avo-wizard-spacer"></span>
    {#if index > 0}
      <button type="button" onclick={() => go(-1)}>Back</button>
    {/if}
    {#if step === 'charter'}
      <button type="button" class="mod-cta" disabled={!charter} onclick={() => charter && submit(charter, planNow)}>
        {input.existing ? 'Update charter' : 'Create charter'}
      </button>
    {:else}
      <button type="button" class="mod-cta" disabled={step === 'customize' && !charter} onclick={() => go(1)}>Next</button>
    {/if}
  </div>
</div>
