<script lang="ts">
  import { plural } from '../../core/model/text';
  import Icon from '../components/Icon.svelte';
  import type { CharterFit, TreeNode } from './charter-tree';

  interface Props {
    fit: CharterFit;
  }

  let { fit }: Props = $props();
  const ICON = { destination: 'folder', group: 'folder', inbox: 'inbox', daily: 'calendar', root: 'vault' } as const;
</script>

{#snippet branch(nodes: TreeNode[])}
  <ul class="avo-tree">
    {#each nodes as node (node.name)}
      <li>
        <div class="avo-tree-row" title={node.description}>
          <Icon name={ICON[node.kind]} />
          <span class="avo-tree-name">{node.name}</span>
          {#if node.notes > 0}<span class="avo-tree-count">{node.notes}</span>{/if}
        </div>
        {#if node.description && node.kind !== 'group'}
          <div class="avo-tree-description">{node.description}</div>
        {/if}
        {#if node.subfolders.length > 0}
          <div class="avo-tree-description">{node.subfolders.join(', ')}{node.moreSubfolders > 0 ? ` and ${node.moreSubfolders} more` : ''}</div>
        {/if}
        {#if node.children.length > 0}{@render branch(node.children)}{/if}
      </li>
    {/each}
  </ul>
{/snippet}

<div class="avo-tree-box">
  {@render branch(fit.tree)}
  <p class="avo-tree-summary">
    {#if fit.open === 0}
      All {plural(fit.total, 'note')} fit by its rules.
    {:else}
      {fit.placed} of {plural(fit.total, 'note')} fit by its rules. The other {fit.open} are sorted by similar notes or AI, or left for you.
    {/if}
  </p>
</div>
