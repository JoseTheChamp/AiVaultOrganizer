import type { Charter } from '../charter/schema';

/** Folders a plan may create notes or folders in (validator `allowedRoots`). */
export function charterRoots(charter: Charter): string[] {
  const roots = charter.destinations.map((d) => d.path).filter((p): p is string => p !== undefined);
  if (charter.inbox) roots.push(charter.inbox);
  if (charter.system.daily) roots.push(charter.system.daily.path);
  // Properties-mode vaults keep notes (and generated category notes) in the root.
  if (charter.mode === 'properties') roots.push('');
  return roots;
}
