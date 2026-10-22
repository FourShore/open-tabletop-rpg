import { evalExpr, evalInt, type Scope } from './expr';
import type { PackIndex } from './pack';
import type { Rng } from './rng';
import type { WhenContext } from './when';

export interface ActiveCondition {
  id: string;
  /** Remaining duration. Undefined = until removed. */
  remaining?: number;
  /** What the duration counts: cards (outside combat, the default) or combat rounds. */
  per?: 'card' | 'round';
}

export interface Character {
  id: string;
  name: string;
  classId: string;
  level: number;
  xp: number;
  /** Ability stats, including level-up gains. Equipment and passives are layered on by `statOf`. */
  stats: Record<string, number>;
  /** Extra max HP from +HP tiles and similar. */
  hpBonus: number;
  hp: number;
  gold: number;
  skills: string[];
  /** slot -> item id */
  equipment: Record<string, string>;
  inventory: string[];
  conditions: ActiveCondition[];
}

export function createCharacter(index: PackIndex, opts: { id: string; name: string; classId: string; level?: number; gold?: number }): Character {
  const cls = index.classes.get(opts.classId);
  if (!cls) throw new Error(`Unknown class '${opts.classId}'`);
  const stats: Record<string, number> = {};
  for (const key of index.abilityStats) stats[key] = cls.baseStats[key] ?? 0;
  const ch: Character = {
    id: opts.id,
    name: opts.name,
    classId: cls.id,
    level: opts.level ?? index.pack.campaign?.startingLevel ?? 1,
    xp: 0,
    stats,
    hpBonus: 0,
    hp: 0,
    gold: opts.gold ?? index.pack.campaign?.startingGold ?? 0,
    skills: [...new Set([...(cls.startingSkills ?? []), ...(cls.basicAttack ? [cls.basicAttack] : [])])],
    equipment: {},
    inventory: [],
    conditions: [],
  };
  for (const itemId of cls.startingItems ?? []) giveItem(index, ch, itemId);
  ch.xp = xpForLevel(index, ch.level);
  ch.hp = maxHp(index, ch);
  return ch;
}

/** Add an item; equipment goes into its slot when the slot is free. */
export function giveItem(index: PackIndex, ch: Character, itemId: string): void {
  const item = index.items.get(itemId);
  if (item?.kind === 'equipment' && item.slot && !ch.equipment[item.slot] && (!item.classes || item.classes.includes(ch.classId))) {
    ch.equipment[item.slot] = itemId;
  } else {
    ch.inventory.push(itemId);
  }
}

/** Sum of a modifier key across equipment, passive skills and conditions. */
export function modifier(index: PackIndex, ch: Character, key: string, rng?: Rng): number {
  const scope = { ...ch.stats, level: ch.level };
  let sum = 0;
  const add = (mods?: Record<string, number | string>) => {
    if (mods && key in mods) sum += evalExpr(mods[key], scope, rng).value;
  };
  for (const itemId of Object.values(ch.equipment)) add(index.items.get(itemId)?.modifiers);
  for (const skillId of ch.skills) {
    const s = index.skills.get(skillId);
    if (s?.passive) add(s.modifiers);
  }
  for (const c of ch.conditions) add(index.conditions.get(c.id)?.modifiers);
  return sum;
}

export function statOf(index: PackIndex, ch: Character, key: string): number {
  return (ch.stats[key] ?? 0) + modifier(index, ch, key);
}

/** Expression scope for anything evaluated "as" this character. */
export function characterScope(index: PackIndex, ch: Character, extra: Scope = {}): Scope {
  const cls = index.classes.get(ch.classId)!;
  const scope: Scope = { level: ch.level, ...extra };
  for (const key of index.abilityStats) scope[key] = statOf(index, ch, key);
  scope.armor = modifier(index, ch, 'armor');
  scope.classHpBase = cls.hp.base;
  scope.classHpPerLevel = evalExpr(cls.hp.perLevel, scope).value;
  scope.classMove = cls.move ?? 5;
  return scope;
}

export function maxHp(index: PackIndex, ch: Character): number {
  const scope = characterScope(index, ch);
  const formula = index.pack.rules?.derived?.maxHp ?? 'classHpBase + classHpPerLevel * (level - 1)';
  return Math.max(1, evalInt(formula, scope) + ch.hpBonus + Math.floor(modifier(index, ch, 'hp')));
}

/** Total XP needed to reach `level` (level 1 = 0). */
export function xpForLevel(index: PackIndex, level: number): number {
  if (level <= 1) return 0;
  const t = index.pack.rules?.leveling?.xpThresholds ?? [];
  return t[Math.min(level - 2, t.length - 1)] ?? 0;
}

/** Level a character's XP has earned, capped by maxLevel and the threshold table. */
export function levelForXp(index: PackIndex, xp: number): number {
  const lv = index.pack.rules?.leveling;
  const t = lv?.xpThresholds ?? [];
  let level = 1;
  while (level - 1 < t.length && xp >= t[level - 1]) level++;
  return Math.min(level, lv?.maxLevel ?? 20);
}

export function characterWhenContext(index: PackIndex, ch: Character, base: Omit<WhenContext, 'level'>): WhenContext {
  return {
    ...base,
    level: ch.level,
    stat: (k) => statOf(index, ch, k),
    skills: new Set(ch.skills),
    items: new Set([...ch.inventory, ...Object.values(ch.equipment)]),
    classId: ch.classId,
    hpFraction: ch.hp / maxHp(index, ch),
  };
}
