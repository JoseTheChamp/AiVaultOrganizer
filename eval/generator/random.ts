/** Seeded randomness for fixtures: the same seed always produces the same vault. */
import { mulberry32, type Random } from '../../src/core/model/random';

export { mulberry32, type Random };

export function pick<T>(random: Random, items: readonly T[]): T {
  const item = items[Math.floor(random() * items.length)];
  if (item === undefined) throw new Error('pick from an empty list');
  return item;
}

/** Up to `count` distinct items, in random order. */
export function sample<T>(random: Random, items: readonly T[], count: number): T[] {
  const pool = [...items];
  const chosen: T[] = [];
  while (chosen.length < count && pool.length > 0) chosen.push(...pool.splice(Math.floor(random() * pool.length), 1));
  return chosen;
}

export function shuffle<T>(random: Random, items: readonly T[]): T[] {
  return sample(random, items, items.length);
}

/** True with probability `p`. */
export function chance(random: Random, p: number): boolean {
  return random() < p;
}
