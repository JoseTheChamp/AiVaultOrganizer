<script lang="ts">
  import type { VaultAnalysis } from '../../core/analysis/analyze';
  import { describeDetection } from '../../core/analysis/method-detect';
  import { plural } from '../../core/model/text';

  interface Props {
    analysis: VaultAnalysis;
  }

  let { analysis }: Props = $props();
  const GRADE = { good: 'Good', fair: 'Fair', poor: 'Needs work' } as const;
  const stats = $derived(analysis.stats);
  const facts = $derived([
    `${plural(stats.noteCount, 'note')} in ${plural(stats.folderCount, 'folder')}, up to ${plural(stats.maxDepth, 'level')} deep.`,
    `${Math.round(stats.rootShare * 100)} % of notes sit in the vault root.`,
    `${plural(analysis.triage.orphans.length, 'note')} that nothing links to, and ${plural(analysis.triage.stubs.length, 'stub')}.`,
    `${plural(stats.tags.variantGroups.length, 'tag')} spelled in more than one way.`,
    `${plural(stats.notesWithUnresolvedLinks, 'note')} with links to notes that do not exist.`,
  ]);
  // The weakest parts of the score, which the charter and the plan can improve.
  const weakest = $derived(
    analysis.health.components
      .filter((component) => component.weight > 0)
      .sort((a, b) => a.value - b.value)
      .slice(0, 3),
  );
</script>

<div class="avo-score-header">
  <div class={['avo-score', `avo-score-${analysis.health.grade}`]}>
    <span class="avo-score-value">{analysis.health.score}</span>
    <span class="avo-score-label">Health: {GRADE[analysis.health.grade]}</span>
  </div>
  <div class="avo-score-summary">
    <p>{describeDetection(analysis.methods)}</p>
    <ul class="avo-issues">
      {#each facts as fact (fact)}
        <li>{fact}</li>
      {/each}
    </ul>
  </div>
</div>

<h4 class="avo-dash-title">Where the score loses most</h4>
<ul class="avo-issues">
  {#each weakest as component (component.id)}
    <li><strong>{component.label}</strong>: {component.detail}</li>
  {/each}
</ul>
<p class="avo-muted">Nothing changes in this wizard until you create the charter, and moving notes always goes through a review with a backup.</p>
