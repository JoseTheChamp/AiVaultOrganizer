<script lang="ts">
  import { confidenceLevel, percent } from '../format';

  interface Props {
    /** 0..1, calibrated. */
    confidence: number;
    /** Who decided: shown in the tooltip, so the badge stays short. */
    source?: string | null;
  }

  let { confidence, source = null }: Props = $props();
  const level = $derived(confidenceLevel(confidence));
  const label = $derived(percent(confidence));
  const title = $derived(source ? `Confidence ${label}, decided by ${source}` : `Confidence ${label}`);
</script>

<span class={['avo-badge', `avo-badge-${level}`]} {title} aria-label={title}>{label}</span>
