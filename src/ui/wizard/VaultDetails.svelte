<script lang="ts">
  import type { VaultAnalysis } from '../../core/analysis/analyze';
  import { describeDetection } from '../../core/analysis/method-detect';
  import { plural } from '../../core/model/text';

  interface Props {
    analysis: VaultAnalysis;
  }

  let { analysis }: Props = $props();
  const GRADE = { good: 'good', fair: 'fair', poor: 'needs work' } as const;
  const stats = $derived(analysis.stats);
  const facts = $derived([
    describeDetection(analysis.methods),
    `${plural(stats.folderCount, 'folder')}, up to ${plural(stats.maxDepth, 'level')} deep; ${Math.round(stats.rootShare * 100)} % of notes in the root.`,
    `${plural(analysis.triage.orphans.length, 'note')} nothing links to, ${plural(analysis.triage.stubs.length, 'stub')}.`,
    `${plural(stats.tags.variantGroups.length, 'tag')} spelled in more than one way.`,
  ]);
</script>

<details class="avo-details">
  <summary>
    Your vault: {plural(stats.noteCount, 'note')}, health <strong>{analysis.health.score}</strong> ({GRADE[analysis.health.grade]})
  </summary>
  <ul class="avo-issues">
    {#each facts as fact (fact)}<li>{fact}</li>{/each}
  </ul>
</details>
