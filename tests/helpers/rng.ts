// A small seeded generator for the tests, so every run draws the same "random" lines (DECISIONS D-09).
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Two different pins, uniformly. */
export function pinPair(random: () => number, pins: number): [number, number] {
  const u = Math.floor(random() * pins);
  let v = Math.floor(random() * pins);
  if (v === u) v = (u + 1 + Math.floor(random() * (pins - 1))) % pins;
  return [u, v];
}
