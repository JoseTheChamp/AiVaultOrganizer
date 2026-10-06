/** Seeded randomness for fixtures: the same seed always produces the same vault. */
export type Random = () => number;

/** Small, fast, seedable PRNG; plenty for fixtures. */
export function mulberry32(seed: number): Random {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

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
