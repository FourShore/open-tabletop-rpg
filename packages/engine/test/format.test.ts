import { describe, expect, it } from 'vitest';
import { describeEvent } from '../src/format';
import { autoPlay, exampleIndex } from './helpers';

describe('describeEvent', () => {
  it('describes every event of a full playthrough', async () => {
    const index = await exampleIndex();
    for (const seed of [1, 2, 3]) {
      const { state, log } = autoPlay(index, seed);
      for (const e of log) {
        const line = describeEvent(index, state, e);
        if (line !== null) expect(line).not.toMatch(/undefined|NaN|\[object/);
      }
    }
  });

  it('hides secret rolls unless asked to reveal them', async () => {
    const index = await exampleIndex();
    const { state } = autoPlay(index, 1);
    const e = { type: 'checkRolled', playerId: state.party[0].id, stat: 'wis', natural: 9, total: 11, dc: 12, success: false, critical: false, fumble: false, secret: true } as const;
    expect(describeEvent(index, state , e)).toBe(`${state.party[0].name} rolls WIS in secret.`);
    expect(describeEvent(index, state, e, { revealSecret: true })).toMatch(/11 vs DC 12\. Failure\./);
  });
});
