// What a hero can do in the current fight (for phones to show), and a simple
// autopilot that picks a sensible move (for the CLI, tests, and heroes whose
// player has left).

import {
  affectedUnits,
  blockedFromMoving,
  dist,
  fromKey,
  heroSkills,
  reachable,
  skillBlocked,
  unitMove,
  validTargetPoints,
  type Reader,
  type Unit,
} from './combat';
import type { Action, GameState } from './game';
import { text, type PackIndex } from './pack';
import type { Point, Targeting } from './types';

export interface AbilityOption {
  id: string;
  name: string;
  description?: string;
  cost: number;
  /** Why it can't be used now; absent when it can. */
  blocked?: string;
  target: NonNullable<Targeting['target']>;
  range: number;
  area?: Targeting['area'];
  /** Squares it can be aimed at. Empty for abilities that need no aim. */
  targets: Point[];
  heals: boolean;
  damages: boolean;
}

export interface HeroCombatOptions {
  heroId: string;
  actionsLeft: number;
  done: boolean;
  down: boolean;
  canMove: boolean;
  moveSquares: Point[];
  skills: AbilityOption[];
  items: (AbilityOption & { count: number })[];
  /** Downed allies next to this hero. */
  revive: string[];
}

export function heroCombatOptions(index: PackIndex, state: GameState, heroId: string): HeroCombatOptions | undefined {
  const cs = state.combat;
  const u = cs?.units.find((x) => x.id === heroId && x.side === 'hero');
  if (!cs || !u) return undefined;
  const r: Reader = { index, s: state };
  const active = cs.phase === 'heroes' && !u.done && !u.down;
  const canMove = active && u.actionsLeft >= 1 && !blockedFromMoving(r, u);
  const aimed = (t?: Targeting) => !['self', 'allAllies', 'allEnemies'].includes(t?.target ?? 'enemy');
  const skills = heroSkills(r, u).map((id): AbilityOption => {
    const s = index.skills.get(id)!;
    const blocked = active ? skillBlocked(r, cs, u, s) : 'Not your turn';
    return {
      id,
      name: text(s.name) || id,
      description: text(s.description) || undefined,
      cost: s.cost ?? 1,
      blocked,
      target: s.targeting?.target ?? 'enemy',
      range: s.targeting?.range ?? 1,
      area: s.targeting?.area,
      targets: !blocked && aimed(s.targeting) ? validTargetPoints(r, cs, u, s.targeting) : [],
      heals: (s.effects ?? []).some((e) => e.type === 'heal'),
      damages: (s.effects ?? []).some((e) => e.type === 'damage'),
    };
  });
  const ch = state.party.find((p) => p.id === heroId)!;
  const counts = new Map<string, number>();
  for (const id of ch.inventory) if (index.items.get(id)?.use) counts.set(id, (counts.get(id) ?? 0) + 1);
  const items = [...counts].map(([id, count]) => {
    const item = index.items.get(id)!;
    const cost = item.use!.cost ?? 1;
    const t = item.use!.targeting;
    const targets = active ? validTargetPoints(r, cs, u, t) : [];
    const blocked = !active ? 'Not your turn' : u.actionsLeft < cost ? 'Not enough actions' : !targets.length ? 'No target in range' : undefined;
    return {
      id,
      name: text(item.name) || id,
      description: text((item as { description?: string }).description) || undefined,
      count,
      cost,
      blocked,
      target: t?.target ?? 'self',
      range: t?.range ?? 0,
      area: t?.area,
      targets: !blocked && aimed(t) ? targets : [],
      heals: (item.use!.effects ?? []).some((e) => e.type === 'heal'),
      damages: (item.use!.effects ?? []).some((e) => e.type === 'damage'),
    };
  });
  const revive = active && u.actionsLeft >= 1 ? cs.units.filter((x) => x.side === 'hero' && x.down && dist(x.pos, u.pos) <= 1).map((x) => x.id) : [];
  return {
    heroId,
    actionsLeft: u.actionsLeft,
    done: u.done,
    down: !!u.down,
    canMove,
    moveSquares: canMove ? [...reachable(r, cs, u, unitMove(r, u)).keys()].map(fromKey) : [],
    skills,
    items,
    revive,
  };
}

/** A reasonable next action for a hero: revive, heal, attack, close in, or end the turn. */
export function suggestCombatAction(index: PackIndex, state: GameState, heroId: string): Action {
  const o = heroCombatOptions(index, state, heroId);
  const cs = state.combat!;
  const end: Action = { type: 'endTurn', playerId: heroId };
  if (!o || o.done || o.down) return end;
  const me = cs.units.find((u) => u.id === heroId)!;
  const unitAt = (p: Point) => cs.units.find((u) => !u.dead && u.pos[0] === p[0] && u.pos[1] === p[1]);
  if (o.revive.length) return { type: 'revive', playerId: heroId, targetId: o.revive[0] };

  const hurt = (u?: Unit) => !!u && u.side === 'hero' && u.hp / Math.max(1, u.maxHp) < 0.5;
  for (const a of [...o.skills, ...o.items]) {
    if (a.blocked || !a.heals) continue;
    const t = a.targets.find((p) => hurt(unitAt(p))) ?? (a.target === 'self' && hurt(me) ? me.pos : undefined);
    if (t) return 'count' in a ? { type: 'useItem', playerId: heroId, itemId: a.id, target: t } : { type: 'useSkill', playerId: heroId, skillId: a.id, target: t };
  }

  // Hit the weakest enemy in reach with the strongest-looking attack (special skills before the basic one).
  const attacks = o.skills.filter((a) => !a.blocked && a.damages && a.target !== 'ally' && a.target !== 'self');
  for (const a of attacks.reverse()) {
    const targeting = index.skills.get(a.id)!.targeting;
    // Area attacks: only where they hit an enemy and no friend.
    const good = (p: Point) => {
      const hit = affectedUnits({ index, s: state }, cs, me, targeting, p);
      return hit.some((u) => u.side === 'enemy') && !hit.some((u) => u.side === 'hero');
    };
    const enemies = a.targets.map((p) => ({ p, u: unitAt(p) })).filter((x) => (a.target === 'tile' ? good(x.p) : x.u?.side === 'enemy'));
    if (!enemies.length) continue;
    const best = enemies.reduce((a1, b) => ((b.u?.hp ?? 99) < (a1.u?.hp ?? 99) ? b : a1));
    return { type: 'useSkill', playerId: heroId, skillId: a.id, target: best.p };
  }

  if (o.canMove) {
    const foes = cs.units.filter((u) => u.side === 'enemy' && !u.dead);
    if (!foes.length) return end;
    const range = Math.max(1, ...o.skills.filter((a) => a.damages).map((a) => a.range));
    const gap = (p: Point) => Math.min(...foes.map((f) => dist(f.pos, p)));
    const now = gap(me.pos);
    if (now > range) {
      const best = o.moveSquares.reduce<Point | undefined>((b, p) => (b === undefined || Math.abs(gap(p) - range) < Math.abs(gap(b) - range) ? p : b), undefined);
      if (best && gap(best) < now) return { type: 'move', playerId: heroId, to: best };
    }
  }
  return end;
}
