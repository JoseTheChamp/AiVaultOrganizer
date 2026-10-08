<script lang="ts">
  import type { Charter, Destination } from '../../core/charter/schema';
  import { plural } from '../../core/model/text';
  import Icon from '../components/Icon.svelte';
  import CharterTree from './CharterTree.svelte';
  import type { CharterFit, FolderContents } from './charter-tree';
  import { newFolderExample, type WizardChanges } from './wizard-state';

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

  const kept = $derived(base.destinations.filter((destination) => !changes.removed.includes(destination.id)));
  const removed = $derived(base.destinations.filter((destination) => changes.removed.includes(destination.id)));
  const nameOf = (destination: Destination) => (destination.path !== undefined ? changes.paths[destination.id] || destination.path : (destination.category ?? destination.id));

  function add(): void {
    const key = Math.max(0, ...changes.added.map((folder) => folder.key)) + 1;
    changes.added = [...changes.added, { key, path: '', description: '' }];
  }
</script>

{#snippet existing(path: string)}
  {@const held = contents(path)}
  {#if held && held.notes > 0}
    <span class="avo-destination-existing">
      Your folder already holds {plural(held.notes, 'note')}: {held.examples.join(', ')}{held.notes > held.examples.length ? ` and ${held.notes - held.examples.length} more` : ''}.
    </span>
  {/if}
{/snippet}

<div class="avo-choose">
  <div class="avo-adjust">
    <p class="avo-muted">
      Each folder holds the kind of note described under it. Rename, remove or add folders; the name of a folder you already have reuses that folder, with the
      notes in it.
    </p>
    <div class="avo-destinations">
      {#each kept as destination (destination.id)}
        <div class="avo-destination">
          <div class="avo-destination-body">
            {#if destination.path !== undefined}
              <input type="text" bind:value={changes.paths[destination.id]} aria-label={`Folder for ${destination.id}`} spellcheck="false" />
            {:else}
              <span>{destination.category}</span>
            {/if}
            <span class="avo-muted">{destination.description}</span>
            {#if destination.path !== undefined}{@render existing(changes.paths[destination.id] ?? '')}{/if}
          </div>
          <button type="button" class="clickable-icon" aria-label={`Remove ${nameOf(destination)}`} onclick={() => (changes.removed = [...changes.removed, destination.id])}>
            <Icon name="x" />
          </button>
        </div>
      {/each}
      {#each changes.added as folder (folder.key)}
        <div class="avo-destination">
          <div class="avo-destination-body">
            <input type="text" bind:value={folder.path} placeholder={newFolderExample(base)} aria-label="New folder" spellcheck="false" />
            <input type="text" bind:value={folder.description} placeholder="What goes here, e.g. running, races and training plans" aria-label={`What goes into ${folder.path || 'the new folder'}`} />
            {@render existing(folder.path)}
          </div>
          <button type="button" class="clickable-icon" aria-label={`Remove ${folder.path || 'the new folder'}`} onclick={() => (changes.added = changes.added.filter((other) => other.key !== folder.key))}>
            <Icon name="x" />
          </button>
        </div>
      {/each}
    </div>
    <div class="avo-adjust-actions">
      <button type="button" onclick={add}><Icon name="plus" /> Add a folder</button>
      {#each removed as destination (destination.id)}
        <button type="button" class="avo-link" onclick={() => (changes.removed = changes.removed.filter((id) => id !== destination.id))}>Add back {nameOf(destination)}</button>
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
