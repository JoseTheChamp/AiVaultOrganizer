<script lang="ts">
  import { tick } from 'svelte';
  import type { Charter, Destination } from '../../core/charter/schema';
  import { parentFolder } from '../../core/model/paths';
  import { plural } from '../../core/model/text';
  import Icon from '../components/Icon.svelte';
  import { type AdjustNode, adjustTree, cleanPath, moveNode, parentPath, siblingsOf, subfolderStart } from './adjust-tree';
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

  const tree = $derived(adjustTree(base, changes));
  const removed = $derived(base.destinations.filter((destination) => changes.removed.includes(destination.id)));

  /** The part of `path` below `parent`: rows show a folder's own name, the tree shows where it is. */
  const nameIn = (path: string, parent: string) => (parent !== '' && path.toLowerCase().startsWith(`${parent.toLowerCase()}/`) ? path.slice(parent.length + 1) : path);
  const parentOf = (destination: Destination) => (destination.path !== undefined ? parentFolder(destination.path) : '');
  const label = (node: AdjustNode) => (node.kind === 'destination' && node.destination.path === undefined ? (node.destination.category ?? node.destination.id) : node.path);

  function rename(destination: Destination, name: string): void {
    const parent = parentOf(destination);
    changes.paths[destination.id] = parent === '' ? name : `${parent}/${name}`;
  }

  /** Whether other new folders sit inside this one: then it needs no description of its own. */
  const holdsFolders = (key: number) => changes.added.some((other) => other.parent === `a:${key}`);

  /** The new row whose name field takes the cursor once it appears. */
  let focusKey: number | null = null;

  /** Adds a folder inside `parent` (a reference, '' for the top level), its name started for the user to finish. */
  function add(parent: string, path: string): void {
    const key = Math.max(0, ...changes.added.map((folder) => folder.key)) + 1;
    focusKey = key;
    changes.added = [...changes.added, { key, parent, name: subfolderStart(base, changes, path), description: '' }];
  }

  /** Puts the cursor after a started name ("14 "), ready for the rest. */
  function focusEnd(node: HTMLInputElement, key: number): void {
    if (key !== focusKey) return;
    focusKey = null;
    node.focus();
    node.setSelectionRange(node.value.length, node.value.length);
  }

  // Reordering: a row moves among its siblings, by dragging its handle or with the arrow keys on it.
  // Focus targets after a move; not state, nothing renders from it.
  const handles: Record<string, HTMLElement> = {};
  function handle(node: HTMLElement, key: string) {
    handles[key] = node;
    return {
      destroy: () => {
        if (handles[key] === node) delete handles[key];
      },
    };
  }
  let dragging = $state<string | null>(null);
  let drop = $state<{ key: string; after: boolean } | null>(null);

  async function move(key: string, target: string, after: boolean): Promise<void> {
    const order = moveNode(tree, key, target, after);
    if (!order) return;
    changes.order = order;
    await tick();
    handles[key]?.focus();
  }
  function onHandleKey(event: KeyboardEvent, node: AdjustNode): void {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    const siblings = siblingsOf(tree, node.key) ?? [];
    const index = siblings.findIndex((sibling) => sibling.key === node.key);
    const neighbour = siblings[index + (event.key === 'ArrowUp' ? -1 : 1)];
    if (neighbour) void move(node.key, neighbour.key, event.key === 'ArrowDown');
  }
  function onDragStart(event: DragEvent, node: AdjustNode): void {
    dragging = node.key;
    event.dataTransfer?.setData('text/plain', node.key);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
    const row = (event.currentTarget as HTMLElement).closest('.avo-folder');
    if (row instanceof HTMLElement) event.dataTransfer?.setDragImage(row, 16, 16);
  }
  function onDragOver(event: DragEvent, node: AdjustNode): void {
    if (!dragging || dragging === node.key || !siblingsOf(tree, dragging)?.some((sibling) => sibling.key === node.key)) return;
    event.preventDefault();
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
    drop = { key: node.key, after: event.clientY > box.top + box.height / 2 };
  }
  function onDrop(event: DragEvent): void {
    event.preventDefault();
    if (dragging && drop) void move(dragging, drop.key, drop.after);
    dragging = null;
    drop = null;
  }
  function onDragEnd(): void {
    dragging = null;
    drop = null;
  }
</script>

{#snippet existing(path: string)}
  {@const held = contents(path)}
  {#if held && held.notes > 0}
    <span class="avo-folder-held">
      Your folder already holds {plural(held.notes, 'note')}: {held.examples.join(', ')}{held.notes > held.examples.length ? ` and ${held.notes - held.examples.length} more` : ''}.
    </span>
  {/if}
{/snippet}

{#snippet grip(node: AdjustNode)}
  <button
    type="button"
    class="avo-folder-grip clickable-icon"
    draggable="true"
    aria-label={`Move ${label(node) || 'the new folder'}`}
    aria-describedby="avo-move-help"
    use:handle={node.key}
    ondragstart={(event) => onDragStart(event, node)}
    ondragend={onDragEnd}
    onkeydown={(event) => onHandleKey(event, node)}
  >
    <Icon name="grip-vertical" />
  </button>
{/snippet}

{#snippet branch(nodes: AdjustNode[], nested: boolean)}
  <ul class={['avo-folders', nested && 'avo-folders-nested']}>
    {#each nodes as node (node.key)}
      <li>
        <!-- Rows are drop targets for the mouse; the keyboard reorders with the arrow keys on each handle. -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class={['avo-folder', dragging === node.key && 'is-dragging', drop?.key === node.key && (drop.after ? 'is-drop-after' : 'is-drop-before')]}
          ondragover={(event) => onDragOver(event, node)}
          ondragleave={() => (drop = drop?.key === node.key ? null : drop)}
          ondrop={onDrop}
        >
          {@render grip(node)}
          <span class="avo-folder-icon"><Icon name="folder" /></span>
          {#if node.kind === 'group'}
            <span class="avo-folder-group">{node.path}</span>
            <div class="avo-folder-actions">
              <button type="button" class="avo-link" aria-label={`Add a folder in ${node.path}`} onclick={() => add(`g:${node.path}`, node.path)}>
                <Icon name="folder-plus" /> Add folder
              </button>
            </div>
          {:else if node.kind === 'destination'}
            {@const destination = node.destination}
            <div class="avo-folder-main">
              {#if destination.path !== undefined}
                <input
                  type="text"
                  class="avo-folder-name"
                  value={nameIn(node.path, parentOf(destination))}
                  oninput={(event) => rename(destination, event.currentTarget.value)}
                  aria-label={`Folder for ${destination.id}`}
                  spellcheck="false"
                />
              {:else}
                <span class="avo-folder-category">{destination.category}</span>
              {/if}
              <span class="avo-folder-about">{destination.description}</span>
              {#if destination.path !== undefined}{@render existing(node.path)}{/if}
            </div>
            <div class="avo-folder-actions">
              {#if destination.path !== undefined}
                <button type="button" class="clickable-icon" aria-label={`Add a subfolder to ${node.path}`} onclick={() => add(`d:${destination.id}`, node.path)}>
                  <Icon name="folder-plus" />
                </button>
              {/if}
              <button type="button" class="clickable-icon" aria-label={`Remove ${label(node)}`} onclick={() => (changes.removed = [...changes.removed, destination.id])}>
                <Icon name="x" />
              </button>
            </div>
          {:else}
            {@const folder = node.added}
            {@const inside = parentPath(folder.parent, base, changes)}
            <div class="avo-folder-main">
              <input
                type="text"
                class="avo-folder-name"
                bind:value={folder.name}
                use:focusEnd={folder.key}
                placeholder={folder.parent === '' ? newFolderExample(base) : 'Folder name'}
                aria-label="New folder"
                spellcheck="false"
              />
              <input
                type="text"
                class="avo-folder-describe"
                bind:value={folder.description}
                placeholder={holdsFolders(folder.key) ? 'Optional: it only holds the folders inside it' : 'What goes here, e.g. running, races and training plans'}
                aria-label={`What goes into ${node.path || 'the new folder'}`}
              />
              {@render existing(node.path)}
            </div>
            <div class="avo-folder-actions">
              <button
                type="button"
                class="clickable-icon"
                aria-label={`Add a subfolder to ${node.path || 'the new folder'}`}
                disabled={cleanPath(folder.name) === ''}
                onclick={() => add(`a:${folder.key}`, node.path)}
              >
                <Icon name="folder-plus" />
              </button>
              <button
                type="button"
                class="clickable-icon"
                aria-label={`Remove ${node.path || (inside ? `the new folder in ${inside}` : 'the new folder')}`}
                onclick={() => (changes.added = changes.added.filter((other) => other.key !== folder.key))}
              >
                <Icon name="x" />
              </button>
            </div>
          {/if}
        </div>
        {#if node.children.length > 0}{@render branch(node.children, true)}{/if}
      </li>
    {/each}
  </ul>
{/snippet}

<div class="avo-choose">
  <div class="avo-adjust">
    <p class="avo-muted">
      Each folder holds the kind of note described under it. Rename, add, remove or drag folders into order; the name of a folder you already have reuses that
      folder, with the notes in it.
    </p>
    <p id="avo-move-help" class="avo-visually-hidden">Drag the handle, or press the up and down arrow keys on it, to move the folder among the folders next to it.</p>
    {@render branch(tree, false)}
    <div class="avo-adjust-actions">
      <button type="button" onclick={() => add('', '')}><Icon name="plus" /> Add a folder</button>
      {#each removed as destination (destination.id)}
        <button type="button" class="avo-link" onclick={() => (changes.removed = changes.removed.filter((id) => id !== destination.id))}>
          Add back {destination.path !== undefined ? (changes.paths[destination.id] ?? destination.path) : (destination.category ?? destination.id)}
        </button>
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
