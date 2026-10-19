/**
 * Random choices a test can replay from its seed (mulberry32), for the
 * records' property tests: a failure names its seed, and the same seed
 * makes the same choices again.
 */
export function createRandom(seed: number) {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
  };
  const int = (min: number, max: number): number =>
    min + Math.floor(next() * (max - min + 1));
  return {
    chance: (probability: number): boolean => next() < probability,
    int,
    pick<T>(items: readonly T[]): T {
      const item = items[int(0, items.length - 1)];
      if (item === undefined) {
        throw new Error("Nothing to pick from");
      }
      return item;
    },
    shuffle<T>(items: readonly T[]): T[] {
      const shuffled = [...items];
      for (let index = shuffled.length - 1; index > 0; index--) {
        const other = int(0, index);
        const item = shuffled[index];
        const swapped = shuffled[other];
        if (item !== undefined && swapped !== undefined) {
          shuffled[index] = swapped;
          shuffled[other] = item;
        }
      }
      return shuffled;
    },
  };
}

export type Random = ReturnType<typeof createRandom>;
