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
  {updating ? 'The charter note' : 'This note'} ("{path}") explains your system in words and holds the rules the plugin follows. You can edit it any
  time; the plugin re-reads it.
</p>
{#if replacesInvalid}
  <p class="avo-warning">Your current charter rules have errors; saving replaces them. A backup is made first.</p>
{/if}
<textarea class="avo-charter-preview" readonly rows="16" aria-label="Charter note preview" value={text}></textarea>
<label class="avo-field avo-field-inline">
  <input type="checkbox" checked={planNow} onchange={(event) => setPlanNow(event.currentTarget.checked)} />
  <span>Plan where every note belongs after saving. Nothing moves until you review and apply the plan.</span>
</label>
