<script lang="ts">
  import type { Charter } from '../../core/charter/schema';
  import { plural } from '../../core/model/text';
  import CharterTree from './CharterTree.svelte';
  import type { CharterFit, FolderContents } from './charter-tree';
  import type { WizardChanges } from './wizard-state';

  interface Props {
    /** The charter before changes: which destinations exist and what they are for. */
    base: Charter;
    /** Edited in place (a reactive object owned by the wizard). */
    changes: WizardChanges;
    problems: string[];
    /** The adjusted charter in this vault; null while the changes do not make a charter. */
    fit: CharterFit | null;
    /** What a vault folder of this name already holds, or null when there is none. */
    contents: (path: string) => FolderContents | null;
  }

  let { base, changes, problems, fit, contents }: Props = $props();

  const included = (id: string) => !changes.removed.includes(id);
  function toggle(id: string, on: boolean): void {
    changes.removed = on ? changes.removed.filter((other) => other !== id) : [...changes.removed, id];
  }
</script>

<div class="avo-choose">
  <div class="avo-adjust">
    <p class="avo-muted">
      Each folder holds the kind of note described under it. Rename it or leave it out; the name of a folder you already have reuses that folder, with the
      notes in it.
    </p>
    <div class="avo-destinations">
      {#each base.destinations as destination (destination.id)}
        <div class="avo-destination">
          <input
            type="checkbox"
            checked={included(destination.id)}
            aria-label={`Use ${destination.path ?? destination.category ?? destination.id}`}
            onchange={(event) => toggle(destination.id, event.currentTarget.checked)}
          />
          <div class="avo-destination-body">
            {#if destination.path !== undefined}
              <input type="text" bind:value={changes.paths[destination.id]} disabled={!included(destination.id)} aria-label={`Folder for ${destination.id}`} spellcheck="false" />
            {:else}
              <span>{destination.category}</span>
            {/if}
            <span class="avo-muted">{destination.description}</span>
            {#if destination.path !== undefined && included(destination.id)}
              {@const existing = contents(changes.paths[destination.id] ?? '')}
              {#if existing && existing.notes > 0}
                <span class="avo-destination-existing">
                  Your folder already holds {plural(existing.notes, 'note')}: {existing.examples.join(', ')}{existing.notes > existing.examples.length ? ` and ${existing.notes - existing.examples.length} more` : ''}.
                </span>
              {/if}
            {/if}
          </div>
        </div>
      {/each}
    </div>

    <details class="avo-details">
      <summary>More options</summary>
      <label class="avo-field">
        <span>Inbox folder (empty for none)</span>
        <input type="text" bind:value={changes.inbox} spellcheck="false" />
      </label>
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
        <span>{base.mode === 'properties' ? 'A note per category listing its notes' : 'A map of content per folder'}</span>
      </label>
      <label class="avo-field">
        <span>Never touch (one folder or pattern per line, e.g. Private/**)</span>
        <textarea rows="3" spellcheck="false" value={changes.ignore.join('\n')} oninput={(event) => (changes.ignore = event.currentTarget.value.split('\n'))}></textarea>
      </label>
    </details>
  </div>

  <section class="avo-choose-preview" aria-label="Preview">
    {#if problems.length > 0}
      <ul class="avo-issues" role="alert">
        {#each problems as problem (problem)}<li class="avo-error">{problem}</li>{/each}
      </ul>
    {:else if fit}
      <CharterTree {fit} />
    {/if}
  </section>
</div>
