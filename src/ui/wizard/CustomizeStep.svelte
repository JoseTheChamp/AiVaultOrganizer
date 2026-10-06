<script lang="ts">
  import type { Charter } from '../../core/charter/schema';
  import { plural } from '../../core/model/text';
  import type { CharterPreview, WizardChanges } from './wizard-state';

  interface Props {
    /** The charter before changes: which destinations exist and what they are for. */
    base: Charter;
    /** Edited in place (a reactive object owned by the wizard). */
    changes: WizardChanges;
    problems: string[];
    preview: CharterPreview | null;
  }

  let { base, changes, problems, preview }: Props = $props();

  const included = (id: string) => !changes.removed.includes(id);
  function toggle(id: string, on: boolean): void {
    changes.removed = on ? changes.removed.filter((other) => other !== id) : [...changes.removed, id];
  }
</script>

<h4 class="avo-dash-title">Destinations</h4>
<p class="avo-muted">Rename folders to your liking; existing folders with these names are reused. Leave out what you do not need.</p>
<div class="avo-destinations">
  {#each base.destinations as destination (destination.id)}
    <div class="avo-destination">
      <input
        type="checkbox"
        checked={included(destination.id)}
        aria-label={`Use ${destination.path ?? destination.category ?? destination.id}`}
        onchange={(event) => toggle(destination.id, event.currentTarget.checked)}
      />
      {#if destination.path !== undefined}
        <input type="text" bind:value={changes.paths[destination.id]} disabled={!included(destination.id)} aria-label={`Folder for ${destination.id}`} spellcheck="false" />
      {:else}
        <span>{destination.category}</span>
      {/if}
      <span class="avo-muted">{destination.description}</span>
    </div>
  {/each}
</div>

<label class="avo-field">
  <span>Inbox folder (empty for none)</span>
  <input type="text" bind:value={changes.inbox} spellcheck="false" />
</label>

<h4 class="avo-dash-title">Conventions</h4>
<label class="avo-field">
  <span>Tags</span>
  <select class="dropdown" bind:value={changes.tagStyle}>
    <option value="keep">Keep as they are</option>
    <option value="lowercase-kebab">Lowercase with dashes (#web-dev)</option>
  </select>
</label>
<label class="avo-field">
  <span>Heading for related links</span>
  <input type="text" bind:value={changes.relatedHeading} />
</label>
<label class="avo-field avo-field-inline">
  <input type="checkbox" bind:checked={changes.mocs} />
  <span>{base.mode === 'properties' ? 'Keep a note per category that lists its notes' : 'Keep a map of content per destination'}</span>
</label>
<label class="avo-field">
  <span>Folders and notes the plugin never touches (one glob per line)</span>
  <textarea rows="3" spellcheck="false" value={changes.ignore.join('\n')} oninput={(event) => (changes.ignore = event.currentTarget.value.split('\n'))}></textarea>
</label>

{#if problems.length > 0}
  <ul class="avo-issues" role="alert">
    {#each problems as problem (problem)}
      <li class="avo-error">{problem}</li>
    {/each}
  </ul>
{:else if preview}
  <p class="avo-muted">
    With this charter, {plural(preview.fit, 'note')} already fit and its rules would file {plural(preview.ruleMoves, 'note')}.
    {plural(preview.open, 'note')} that no rule places would be compared with similar notes, or with the language model if one is set up.
  </p>
{/if}
