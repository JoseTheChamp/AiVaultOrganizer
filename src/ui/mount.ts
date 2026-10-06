import { type Component, mount, unmount } from 'svelte';

/** A component mounted into an Obsidian container (a view or a modal); destroy it on close. */
export interface MountedComponent {
  destroy(): void;
}

/**
 * Mounts a Svelte component into an element that Obsidian owns. Views and modals stay thin
 * Obsidian classes: they create the container, mount the component with plain props and
 * callbacks, and destroy it in `onClose`.
 */
export function mountComponent<Props extends Record<string, unknown>>(component: Component<Props>, target: HTMLElement, props: Props): MountedComponent {
  const instance = mount(component, { target, props });
  return {
    destroy: () => {
      void unmount(instance);
    },
  };
}
