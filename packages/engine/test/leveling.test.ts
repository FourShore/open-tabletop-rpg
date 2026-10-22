import { describe, expect, it } from 'vitest';
import { createCharacter } from '../src/character';
import { applyTile, drawLevelUpTiles, tileCount } from '../src/leveling';
import { indexPack, mergePack } from '../src/pack';
import { createRng } from '../src/rng';
import type { Pack } from '../src/types';
import { exampleIndex } from './helpers';

// A pack with plenty of unrestricted skills in every tier, so tier weights are the only thing shaping the draw.
function syntheticIndex() {
  const skills = [1, 2, 3, 4, 5].flatMap((tier) =>
    Array.from({ length: 8 }, (_, i) => ({ id: `t${tier}-${i}`, name: `T${tier} ${i}`, tier, classes: [{ class: 'hero' }] })),
  );
  const pack = mergePack(
    {
      spec: 'otrpg/0.1', id: 'test', name: 'Test', version: '0',
      stats: [{ key: 'str', name: 'Strength' }, { key: 'dex', name: 'Dexterity' }],
      classes: [{ id: 'hero', name: 'Hero', baseStats: { str: 1, dex: 1 }, hp: { base: 10, perLevel: 2 } }],
      skills,
      rules: { leveling: { categoryWeights: { skill: 100, statBoost: 0 } } },
    },
    [],
  ) as Pack;
  return indexPack(pack);
}

function tierShares(level: number, draws = 3000) {
  const index = syntheticIndex();
  const rng = createRng(level);
  const counts = [0, 0, 0, 0, 0];
  let total = 0;
  for (let i = 0; i < draws; i++) {
    const ch = createCharacter(index, { id: 'a', name: 'A', classId: 'hero', level: level - 1 });
    for (const t of drawLevelUpTiles(index, ch, level, rng)) {
      if (t.kind === 'skill') (counts[t.tier - 1]++, total++);
    }
  }
  return counts.map((n) => n / total);
}

describe('level-up tile draw', () => {
  it('offers more tiles at higher levels', () => {
    expect([2, 4, 5, 9, 10, 20].map((l) => tileCount({}, l))).toEqual([3, 3, 4, 4, 5, 5]);
  });

  it('favors low tiers early and high tiers late', () => {
    const early = tierShares(2);
    const late = tierShares(15);
    // Defaults: level 2-3 = 70/25/5/0/0, level 15+ = 5/15/25/30/25. Drawing without
    // replacement within one offer flattens these slightly, so allow some slack.
    expect(early[0]).toBeGreaterThan(0.6);
    expect(early[3] + early[4]).toBe(0);
    expect(late[0]).toBeLessThan(0.1);
    expect(late[4]).toBeGreaterThan(0.2);
  });

  it('never repeats a tile and always ends with the +1 any stat tile', async () => {
    const index = await exampleIndex();
    const rng = createRng(5);
    for (const classId of index.classes.keys()) {
      for (let i = 0; i < 50; i++) {
        const ch = createCharacter(index, { id: 'a', name: 'A', classId });
        const tiles = drawLevelUpTiles(index, ch, 2, rng);
        expect(tiles.at(-1)).toEqual({ kind: 'anyStat', amount: 1 });
        const keys = tiles.map((t) => JSON.stringify(t));
        expect(new Set(keys).size).toBe(keys.length);
        expect(tiles.some((t) => t.kind === 'skill')).toBe(true);
        for (const t of tiles) if (t.kind === 'skill') expect(ch.skills).not.toContain(t.skillId);
      }
    }
  });

  it('respects skill prerequisites', async () => {
    const index = await exampleIndex();
    const rng = createRng(11);
    for (let i = 0; i < 200; i++) {
      const ch = createCharacter(index, { id: 'a', name: 'A', classId: 'wizard' });
      const ids = drawLevelUpTiles(index, ch, 2, rng).flatMap((t) => (t.kind === 'skill' ? [t.skillId] : []));
      // Fireball needs Firebolt (which wizards start with); Meteor needs Fireball and INT 7.
      expect(ids).not.toContain('meteor');
    }
  });

  it('applies tiles and raises HP with the level', async () => {
    const index = await exampleIndex();
    const ch = createCharacter(index, { id: 'a', name: 'A', classId: 'knight' });
    expect(ch.hp).toBe(14);
    applyTile(index, ch, { kind: 'anyStat', amount: 1 }, 'dex');
    expect(ch.level).toBe(2);
    expect(ch.stats.dex).toBe(2);
    expect(ch.hp).toBe(19);
    applyTile(index, ch, { kind: 'statBoost', stat: 'hp', amount: 6 });
    expect(ch.hp).toBe(30);
    applyTile(index, ch, { kind: 'skill', skillId: 'guardian', tier: 2 });
    expect(ch.skills).toContain('guardian');
    expect(ch.hp).toBe(39); // +5 for the level, +4 from Guardian's passive hp bonus
    expect(() => applyTile(index, ch, { kind: 'anyStat', amount: 1 })).toThrow(/Pick an ability stat/);
  });
});
