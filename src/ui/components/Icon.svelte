<script lang="ts">
  import { useIcons } from '../icons';

  interface Props {
    /** A Lucide icon name, as Obsidian uses them ("folder", "calendar"). */
    name: string;
  }

  let { name }: Props = $props();
  const draw = useIcons();
  let element = $state<HTMLSpanElement | null>(null);
  $effect(() => {
    if (element) draw(element, name);
  });
</script>

<span class="avo-icon" aria-hidden="true" bind:this={element}></span>
