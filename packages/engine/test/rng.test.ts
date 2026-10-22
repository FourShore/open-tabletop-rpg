import { describe, expect, it } from 'vitest';
import { createRng, shuffle } from '../src/rng';

describe('rng', () => {
  it('is deterministic per seed and resumable from its state', () => {
    const a = createRng(99);
    const seq = [a.next(), a.next()];
    const b = createRng(99);
    expect([b.next(), b.next()]).toEqual(seq);
    const c = createRng(99);
    c.next();
    expect(createRng(c.state).next()).toBe(seq[1]);
  });

  it('rolls fair-looking dice', () => {
    const rng = createRng(7);
    const counts = new Array(6).fill(0);
    for (let i = 0; i < 6000; i++) counts[rng.die(6) - 1]++;
    for (const n of counts) expect(n).toBeGreaterThan(850);
  });

  it('shuffles without losing items', () => {
    expect(shuffle([1, 2, 3, 4, 5], createRng(2)).sort()).toEqual([1, 2, 3, 4, 5]);
  });
});
