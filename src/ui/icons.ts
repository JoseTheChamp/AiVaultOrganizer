import { getContext, setContext } from 'svelte';

/** Draws a named icon into an element: Obsidian's `setIcon` in the plugin, nothing in tests. */
export type IconSetter = (element: HTMLElement, name: string) => void;

const KEY = Symbol('avo-icons');

/** Called by a root component with what its host passed in, so every child can draw icons. */
export function provideIcons(setter: IconSetter | undefined): void {
  setContext(KEY, setter ?? (() => undefined));
}

export function useIcons(): IconSetter {
  return getContext<IconSetter | undefined>(KEY) ?? (() => undefined);
}
