import type { Rng } from './rng';

/** Pick one entry by weight. Returns undefined when every weight is zero. */
export function pickWeighted<T>(entries: T[], weightOf: (e: T) => number, rng: Rng): T | undefined {
  const total = entries.reduce((sum, e) => sum + Math.max(0, weightOf(e)), 0);
  if (total <= 0) return undefined;
  let roll = rng.next() * total;
  for (const e of entries) {
    roll -= Math.max(0, weightOf(e));
    if (roll < 0) return e;
  }
  return entries[entries.length - 1];
}

/** Draw up to `n` distinct entries by weight, without replacement. */
export function drawWeighted<T>(entries: T[], weightOf: (e: T) => number, n: number, rng: Rng): T[] {
  const pool = entries.slice();
  const out: T[] = [];
  while (out.length < n) {
    const pick = pickWeighted(pool, weightOf, rng);
    if (pick === undefined) break;
    out.push(pick);
    pool.splice(pool.indexOf(pick), 1);
  }
  return out;
}
