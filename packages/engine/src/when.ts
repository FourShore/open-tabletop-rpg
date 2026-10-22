import type { Range, When } from './types';
import type { Rng } from './rng';

/** What a `when` / `requires` condition can look at. Missing parts evaluate to false. */
export interface WhenContext {
  flags: Set<string>;
  partySize: number;
  /** Character level in a character context, else average party level. */
  level: number;
  rng?: Rng;
  stat?: (key: string) => number;
  skills?: Set<string>;
  items?: Set<string>;
  classId?: string;
  hpFraction?: number;
  adjacentToEnemy?: boolean;
  round?: number;
}

export function inRange(value: number, range: Range): boolean {
  return (range.min === undefined || value >= range.min) && (range.max === undefined || value <= range.max);
}

/** Every key present must hold (an implicit AND). */
export function evalWhen(cond: When | undefined, ctx: WhenContext): boolean {
  if (!cond) return true;
  if (cond.all && !cond.all.every((c) => evalWhen(c, ctx))) return false;
  if (cond.any && !cond.any.some((c) => evalWhen(c, ctx))) return false;
  if (cond.not && evalWhen(cond.not, ctx)) return false;
  if (cond.flag !== undefined && !ctx.flags.has(cond.flag)) return false;
  if (cond.level && !inRange(ctx.level, cond.level)) return false;
  if (cond.partySize && !inRange(ctx.partySize, cond.partySize)) return false;
  if (cond.stat && !(ctx.stat && inRange(ctx.stat(cond.stat.key), cond.stat))) return false;
  if (cond.hasSkill !== undefined && !ctx.skills?.has(cond.hasSkill)) return false;
  if (cond.hasItem !== undefined && !ctx.items?.has(cond.hasItem)) return false;
  if (cond.class !== undefined && ctx.classId !== cond.class) return false;
  if (cond.hpBelow !== undefined && !(ctx.hpFraction !== undefined && ctx.hpFraction < cond.hpBelow)) return false;
  if (cond.adjacentToEnemy !== undefined && (ctx.adjacentToEnemy ?? false) !== cond.adjacentToEnemy) return false;
  if (cond.round && !(ctx.round !== undefined && inRange(ctx.round, cond.round))) return false;
  // Chance is rolled last so a failed earlier check doesn't consume randomness.
  if (cond.chance !== undefined && !(ctx.rng && ctx.rng.next() < cond.chance)) return false;
  return true;
}
