<script lang="ts">
  import { renderCharterNote } from '../../core/charter/charter-note';
  import { customizeCharter } from '../../core/charter/customize';
  import { type Lang, toLang } from '../../core/charter/presets/index';
  import type { Charter } from '../../core/charter/schema';
  import { type IconSetter, provideIcons } from '../icons';
  import AdjustStep from './AdjustStep.svelte';
  import { charterFit, folderContents } from './charter-tree';
  import ChooseStep from './ChooseStep.svelte';
  import CreateStep from './CreateStep.svelte';
  import { baseCharter, type Choice, choiceOptions, initialChanges, recommendedChoice, STEPS, type WizardInput, type WizardStep } from './wizard-state';

  interface Props {
    input: WizardInput;
    /** Writes the charter (through a reviewed plan) and, when asked, plans the vault against it. */
    submit: (charter: Charter, planNow: boolean) => void;
    cancel: () => void;
    /** Asks AI for a charter, setting AI up first if needed (after consent). */
    requestDraft?: (lang: Lang, wish: string) => Promise<Charter | null>;
    icons?: IconSetter;
  }

  let { input, submit, cancel, requestDraft, icons }: Props = $props();
  // svelte-ignore state_referenced_locally
  provideIcons(icons);

  // The wizard owns its working copy of the choices; the input it was opened with does not change.
  const start = (() => {
    const lang: Lang = input.existing ? toLang(input.existing.language) : input.analysis.stats.language.language;
    const choice = recommendedChoice(input);
    return { lang, choice, changes: initialChanges(baseCharter(input, choice, lang)) };
  })();

  let step = $state<WizardStep>('choose');
  let lang = $state(start.lang);
  let choice = $state<Choice>(start.choice);
  let changes = $state(start.changes);
  let planNow = $state(true);
  let draft = $state<Charter | null>(null);
  let drafting = $state(false);
  let wish = $state('');

  const options = $derived(choiceOptions(input, draft));
  const base = $derived(baseCharter(input, choice, lang, draft));
  const baseFit = $derived(charterFit(base, input.snapshot, input.charterPath));
  const result = $derived(customizeCharter(base, changes));
  const charter = $derived(result.ok ? result.value : null);
  const problems = $derived(result.ok ? [] : result.error);
  const fit = $derived(charter ? charterFit(charter, input.snapshot, input.charterPath) : null);
  const index = $derived(STEPS.findIndex((candidate) => candidate.id === step));

  // A new system or language starts the adjustments over from that charter.
  function choose(next: Choice): void {
    choice = next;
    changes = initialChanges(baseCharter(input, next, lang, draft));
  }
  function setLang(next: Lang): void {
    lang = next;
    changes = initialChanges(baseCharter(input, choice, next, draft));
  }
  async function askForDraft(): Promise<void> {
    if (!requestDraft || drafting) return;
    drafting = true;
    try {
      const proposed = await requestDraft(lang, wish.trim());
      if (proposed) {
        draft = proposed;
        lang = toLang(proposed.language);
        choose('draft');
      }
    } finally {
      drafting = false;
    }
  }
  function go(offset: number): void {
    const next = STEPS[index + offset];
    if (next) step = next.id;
  }

  // Each step announces itself: focus moves to its heading, so screen readers read the new step.
  let heading = $state<HTMLHeadingElement | null>(null);
  let moved = false;
  $effect(() => {
    void step;
    if (moved) heading?.focus();
    moved = true;
  });
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
    <h3 class="avo-step-title avo-visually-hidden" tabindex="-1" bind:this={heading}>Step {index + 1} of {STEPS.length}: {STEPS[index]?.label}</h3>
    {#if step === 'choose'}
      <ChooseStep analysis={input.analysis} {options} {choice} fit={baseFit} {lang} langLocked={choice === 'existing' || choice === 'draft'} {choose} {setLang}>
        {#if requestDraft}
          <div class="avo-draft">
            <span class="avo-muted">Not sure? Let AI read samples of your notes and suggest a system.</span>
            <input type="text" bind:value={wish} placeholder="Optional wish, e.g. keep courses apart" aria-label="A wish for the suggestion" disabled={drafting} />
            <button type="button" disabled={drafting} onclick={() => void askForDraft()}>{drafting ? 'Suggesting…' : 'Suggest a system'}</button>
          </div>
        {/if}
      </ChooseStep>
    {:else if step === 'adjust'}
      <AdjustStep {base} {changes} {problems} {fit} contents={(path) => folderContents(input.snapshot, path)} />
    {:else if charter}
      <CreateStep
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
    {#if step === 'create'}
      <button type="button" class="mod-cta" disabled={!charter} onclick={() => charter && submit(charter, planNow)}>
        {input.existing ? 'Update charter' : 'Create charter'}
      </button>
    {:else}
      <button type="button" class="mod-cta" disabled={step === 'adjust' && !charter} onclick={() => go(1)}>Next</button>
    {/if}
  </div>
</div>
