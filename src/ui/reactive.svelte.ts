/**
 * A deeply reactive object for the Obsidian classes that host components: runes work only in
 * Svelte files, so views and modals (plain TypeScript) get their reactive state from here. A
 * component that receives the object re-renders when the host changes a field.
 */
export function reactive<T extends object>(initial: T): T {
  const value = $state(initial);
  return value;
}
