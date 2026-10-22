// The level-up tile draw. Defaults match the design doc; every number comes
// from rules.leveling when the pack sets it.

import { characterWhenContext, maxHp, type Character } from './character';
import type { PackIndex } from './pack';
import type { Rng } from './rng';
import type { Leveling, SkillDef } from './types';
import { evalWhen, inRange } from './when';
import { pickWeighted } from './weighted';

export type Tile =
  | { kind: 'skill'; skillId: string; tier: number }
  | { kind: 'statBoost'; stat: string; amount: number }
  | { kind: 'anyStat'; amount: number };

const DEFAULT_TIER_WEIGHTS: Leveling['tierWeights'] = [
  { level: { max: 3 }, weights: [70, 25, 5, 0, 0] },
  { level: { min: 4, max: 6 }, weights: [45, 35, 15, 5, 0] },
  { level: { min: 7, max: 9 }, weights: [25, 35, 25, 12, 3] },
  { level: { min: 10, max: 14 }, weights: [10, 25, 30, 25, 10] },
  { level: { min: 15 }, weights: [5, 15, 25, 30, 25] },
];
const DEFAULT_TILE_COUNT: Leveling['tileCount'] = [
  { level: { max: 4 }, count: 3 },
  { level: { min: 5, max: 9 }, count: 4 },
  { level: { min: 10 }, count: 5 },
];

export function tileCount(lv: Leveling, level: number): number {
  return (lv.tileCount ?? DEFAULT_TILE_COUNT)!.find((b) => inRange(level, b.level))?.count ?? 3;
}

export function tierWeights(lv: Leveling, level: number): number[] {
  return (lv.tierWeights ?? DEFAULT_TIER_WEIGHTS)!.find((b) => inRange(level, b.level))?.weights ?? [1];
}

/** Skills this character could be offered right now. */
export function eligibleSkills(index: PackIndex, ch: Character, flags: Set<string>, partySize: number): SkillDef[] {
  const known = new Set(ch.skills);
  const ctx = characterWhenContext(index, ch, { flags, partySize });
  return (index.pack.skills ?? []).filter(
    (s) =>
      !known.has(s.id) &&
      (s.weight ?? 1) > 0 &&
      s.classes.some((c) => c.class === ch.classId) &&
      evalWhen(s.requires, ctx),
  );
}

/**
 * Build a level-up offer for a character who is about to reach `newLevel`.
 * Random tiles first (skills and stat boosts, no duplicates), then the fixed tiles.
 */
export function drawLevelUpTiles(index: PackIndex, ch: Character, newLevel: number, rng: Rng, flags = new Set<string>(), partySize = 1): Tile[] {
  const lv = index.pack.rules?.leveling ?? {};
  const count = tileCount(lv, newLevel);
  const weights = tierWeights(lv, newLevel);
  const fallback = lv.emptyTierFallback ?? 'lower';
  const category = lv.categoryWeights ?? { skill: 80, statBoost: 20 };
  const cls = index.classes.get(ch.classId)!;

  // Requirements are checked at the level being reached.
  let skillPool = eligibleSkills(index, { ...ch, level: newLevel }, flags, partySize);
  const ctx = characterWhenContext(index, { ...ch, level: newLevel }, { flags, partySize });
  let boostPool = (lv.statBoostTiles ?? [])
    .filter((t) => evalWhen(t.when, ctx))
    .map((t) => ({ ...t, stat: t.stat === 'primary' ? (cls.keyStats?.[0] ?? index.abilityStats[0]) : t.stat }));

  const drawSkill = (): Tile | undefined => {
    if (!skillPool.length) return undefined;
    const byTier = new Map<number, SkillDef[]>();
    for (const s of skillPool) byTier.set(s.tier, [...(byTier.get(s.tier) ?? []), s]);
    const tiers = weights.map((w, i) => ({ tier: i + 1, w }));
    const rolled = pickWeighted(tiers, (t) => t.w, rng)?.tier ?? 1;
    const tier = resolveTier(rolled, [...byTier.keys()], fallback);
    if (tier === undefined) return undefined;
    const skill = pickWeighted(byTier.get(tier)!, (s) => s.weight ?? 1, rng)!;
    skillPool = skillPool.filter((s) => s !== skill);
    return { kind: 'skill', skillId: skill.id, tier: skill.tier };
  };
  const drawBoost = (): Tile | undefined => {
    const pick = pickWeighted(boostPool, (t) => t.weight ?? 1, rng);
    if (!pick) return undefined;
    // One boost per stat in a single offer.
    boostPool = boostPool.filter((t) => t.stat !== pick.stat);
    return { kind: 'statBoost', stat: pick.stat, amount: pick.amount };
  };

  const tiles: Tile[] = [];
  while (tiles.length < count) {
    const wantSkill = rng.next() * ((category.skill ?? 0) + (category.statBoost ?? 0)) < (category.skill ?? 0);
    const tile = wantSkill ? (drawSkill() ?? drawBoost()) : (drawBoost() ?? drawSkill());
    if (!tile) break;
    tiles.push(tile);
  }
  if ((lv.guaranteeSkillTile ?? true) && !tiles.some((t) => t.kind === 'skill') && skillPool.length) {
    const skill = drawSkill();
    if (skill) tiles[tiles.length ? tiles.length - 1 : 0] = skill;
  }
  for (const f of lv.fixedTiles ?? [{ kind: 'anyStat' as const, amount: 1 }]) {
    if (f.kind === 'anyStat') tiles.push({ kind: 'anyStat', amount: f.amount ?? 1 });
  }
  return tiles;
}

function resolveTier(rolled: number, available: number[], fallback: NonNullable<Leveling['emptyTierFallback']>): number | undefined {
  if (available.includes(rolled)) return rolled;
  if (fallback === 'skip') return undefined;
  const lower = available.filter((t) => t < rolled).sort((a, b) => b - a)[0];
  const higher = available.filter((t) => t > rolled).sort((a, b) => a - b)[0];
  if (fallback === 'lower') return lower ?? higher;
  if (fallback === 'higher') return higher ?? lower;
  if (lower === undefined) return higher;
  if (higher === undefined) return lower;
  return rolled - lower <= higher - rolled ? lower : higher;
}

/** Apply a chosen tile and raise the character one level. `stat` is required for anyStat tiles. */
export function applyTile(index: PackIndex, ch: Character, tile: Tile, stat?: string): void {
  const before = maxHp(index, ch);
  const cap = index.pack.rules?.statCap ?? Infinity;
  const raise = (key: string, amount: number) => {
    if (key === 'hp') ch.hpBonus += amount;
    else ch.stats[key] = Math.min(cap, (ch.stats[key] ?? 0) + amount);
  };
  if (tile.kind === 'skill') ch.skills.push(tile.skillId);
  else if (tile.kind === 'statBoost') raise(tile.stat, tile.amount);
  else {
    if (!stat || !index.abilityStats.includes(stat)) throw new Error(`Pick an ability stat for the +${tile.amount} tile`);
    raise(stat, tile.amount);
  }
  ch.level += 1;
  // New max HP from the level and tile is gained as current HP too.
  ch.hp = Math.min(maxHp(index, ch), ch.hp + Math.max(0, maxHp(index, ch) - before));
}

export function describeTile(index: PackIndex, tile: Tile): string {
  if (tile.kind === 'skill') {
    const s = index.skills.get(tile.skillId);
    const name = typeof s?.name === 'string' ? s.name : tile.skillId;
    return `${name} (tier ${tile.tier} skill)`;
  }
  if (tile.kind === 'statBoost') return `+${tile.amount} ${tile.stat.toUpperCase()}`;
  return `+${tile.amount} to any stat`;
}
