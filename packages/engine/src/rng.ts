// Seeded, serializable RNG (mulberry32). The whole state is one integer, so a
// game can be saved, replayed, or resolved identically on server and client.

export interface Rng {
  /** Float in [0, 1). */
  next(): number;
  /** Integer in [1, sides]. */
  die(sides: number): number;
  /** Integer in [0, n). */
  int(n: number): number;
  readonly state: number;
}

export function createRng(seed: number): Rng {
  let s = seed >>> 0;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    die: (sides) => 1 + Math.floor(next() * sides),
    int: (n) => Math.floor(next() * n),
    get state() {
      return s;
    },
  };
}

export function seedFromString(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function shuffle<T>(items: T[], rng: Rng): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
