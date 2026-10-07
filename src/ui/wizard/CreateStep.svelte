<script lang="ts">
  interface Props {
    path: string;
    /** The charter note as it will be written. */
    text: string;
    updating: boolean;
    replacesInvalid: boolean;
    planNow: boolean;
    setPlanNow: (value: boolean) => void;
  }

  let { path, text, updating, replacesInvalid, planNow, setPlanNow }: Props = $props();
</script>

<p>
  {updating ? 'Updates' : 'Creates'} the note <strong>{path}</strong>, which describes your system in plain words and holds its rules. You can edit it
  any time.
</p>
{#if replacesInvalid}
  <p class="avo-warning">Your current charter rules have errors; this replaces them.</p>
{/if}
<details class="avo-details">
  <summary>Show the note</summary>
  <textarea class="avo-charter-preview" readonly rows="14" aria-label="Charter note preview" value={text}></textarea>
</details>
<label class="avo-field avo-field-inline">
  <input type="checkbox" checked={planNow} onchange={(event) => setPlanNow(event.currentTarget.checked)} />
  <span>Then plan where my notes go (nothing moves until you approve)</span>
</label>
