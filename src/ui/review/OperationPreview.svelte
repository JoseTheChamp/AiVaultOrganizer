<script lang="ts">
  import type { OperationPreview } from '../../core/apply/preview';

  interface Props {
    preview: OperationPreview;
    openNote: (path: string) => void;
  }

  let { preview, openNote }: Props = $props();
  const MARK = { same: ' ', add: '+', remove: '−' } as const;
  // What the sign means, for screen readers.
  const SPOKEN = { add: 'Added: ', remove: 'Removed: ' } as const;
</script>

<div class="avo-preview">
  {#if preview.kind === 'move'}
    <p><span class="avo-visually-hidden">From </span><span class="avo-path avo-diff-remove">{preview.from}</span></p>
    <p><span class="avo-visually-hidden">To </span><span class="avo-path avo-diff-add">{preview.to}</span></p>
    <p class="avo-muted">Obsidian updates links to the note when it moves.</p>
  {:else if preview.kind === 'folder'}
    <p>Creates the folder <span class="avo-path">{preview.path}</span>.</p>
  {:else if preview.kind === 'create'}
    <p>Creates <span class="avo-path">{preview.path}</span>:</p>
    <pre class="avo-diff">{preview.content}</pre>
  {:else if preview.kind === 'edit'}
    <div class="avo-diff" role="group" aria-label={`Changes to ${preview.path}`}>
      {#each preview.lines as line, index (index)}
        {#if line.type === 'gap'}
          <div class="avo-diff-gap">… {line.count} unchanged {line.count === 1 ? 'line' : 'lines'}</div>
        {:else}
          <div class={`avo-diff-${line.type}`}>
            <span aria-hidden="true">{MARK[line.type]}</span>{#if line.type !== 'same'}<span class="avo-visually-hidden">{SPOKEN[line.type]}</span>{/if}
            {line.text}
          </div>
        {/if}
      {/each}
    </div>
  {:else if preview.kind === 'flag'}
    {#if preview.related.length > 0}
      <p>
        Related:
        {#each preview.related as path (path)}
          <button type="button" class="avo-link" onclick={() => openNote(path)}>{path}</button>
        {/each}
      </p>
    {/if}
  {:else}
    <p class="avo-muted">{preview.reason}</p>
  {/if}
</div>
