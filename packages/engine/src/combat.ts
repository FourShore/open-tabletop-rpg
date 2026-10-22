// Grid combat. A combat card puts a `CombatState` on the game: heroes act
// first, in any order, each spending their actions (moving costs one, a skill
// costs its `cost`); when every hero has ended their turn the enemies act on
// the intents they showed at the start of the round.
//
// Everything here is pure and works on the same context as game.ts, so a
// battle replays identically from the same seed.

import { characterScope, maxHp, modifier, statOf, type ActiveCondition, type Character } from './character';
import { evalExpr, evalInt, type Scope } from './expr';
import type { PackIndex } from './pack';
import { text } from './pack';
import type { Rng } from './rng';
import type { CombatSpec, ConditionDef, Effect, EnemyDef, EnemyTargetRule, ItemDef, MapDef, Point, SkillDef, Targeting, TerrainDef } from './types';
import { evalWhen, type WhenContext } from './when';

// ---------- state ----------

export interface Unit {
  /** Hero units use the hero's id, so `playerId` and unit id are the same. */
  id: string;
  side: 'hero' | 'enemy';
  enemyId?: string;
  name: string;
  pos: Point;
  /** Enemies only; a hero's HP lives on their character. */
  hp: number;
  maxHp: number;
  /** Enemies only; a hero's conditions live on their character. */
  conditions: ActiveCondition[];
  actionsLeft: number;
  done: boolean;
  cooldowns: Record<string, number>;
  usesThisCombat: Record<string, number>;
  intent?: Intent;
  /** A hero at 0 HP: still on the board, can be healed or revived. */
  down?: boolean;
  /** An enemy at 0 HP. Kept so the log and the screen can still name it. */
  dead?: boolean;
}

export interface Intent {
  action: 'skill' | 'approach' | 'flee' | 'hold';
  skillId?: string;
  targetId?: string;
  rule: EnemyTargetRule;
}

export interface CombatState {
  cardId: string;
  map: string;
  round: number;
  phase: 'heroes' | 'enemies';
  units: Unit[];
  /** Reinforcements still to arrive. */
  waves: { enemy: string; count: number; at?: string; round: number }[];
  objective: NonNullable<CombatSpec['objective']>;
  /** Damage each hero has dealt, for `highestThreat` targeting. */
  threat: Record<string, number>;
  nextId: number;
}

export type CombatEvent =
  | { type: 'roundStarted'; round: number }
  | { type: 'enemyPhase' }
  | { type: 'unitSpawned'; unitId: string; name: string; pos: Point }
  | { type: 'unitMoved'; unitId: string; from: Point; to: Point; path: Point[] }
  | { type: 'skillUsed'; unitId: string; skillId: string; name: string; target?: Point; targets: string[] }
  | { type: 'itemUsed'; unitId: string; itemId: string; name: string }
  | { type: 'attackRolled'; unitId: string; targetId: string; natural: number; total: number; defense: number; hit: boolean; critical: boolean }
  | { type: 'saveRolled'; unitId: string; natural: number; total: number; dc: number; saved: boolean }
  | { type: 'unitDamaged'; unitId: string; amount: number; hp: number; damageType?: string }
  | { type: 'unitHealed'; unitId: string; amount: number; hp: number }
  | { type: 'unitCondition'; unitId: string; condition: string; on: boolean; duration?: number }
  | { type: 'unitDown'; unitId: string }
  | { type: 'unitDied'; unitId: string; killerId?: string }
  | { type: 'revived'; unitId: string; byId: string; natural: number; total: number; dc: number; success: boolean }
  | { type: 'turnEnded'; unitId: string }
  | { type: 'turnSkipped'; unitId: string };

/** Read-only access, for working out options without changing anything. */
export interface Reader {
  index: PackIndex;
  s: CombatCtx['s'];
}

/** What combat needs from the game: the same shape as game.ts's context. */
export interface CombatCtx {
  index: PackIndex;
  s: { party: Character[]; combat?: CombatState; flags: string[]; scenarioFlags: string[]; skillUses: Record<string, number> };
  rng: Rng;
  events: { push(e: CombatEvent | { type: 'narrate'; text: string }): void };
  /** Give a killing blow's XP and loot to a hero (game.ts owns rewards). */
  reward(heroId: string, xp: number, loot?: string): void;
}

export class CombatError extends Error {}

// ---------- setup ----------

export function createCombat(c: CombatCtx, cardId: string, spec: CombatSpec): CombatState {
  const { index, s } = c;
  const map = mapOf(index, spec.map);
  const cs: CombatState = {
    cardId,
    map: map.id,
    round: 0,
    phase: 'heroes',
    units: [],
    waves: [],
    objective: { kind: 'defeatAll', ...spec.objective },
    threat: {},
    nextId: 1,
  };
  s.combat = cs;
  const starts = map.heroStart ?? [];
  s.party.forEach((ch, i) => {
    const pos = freeNear(c, cs, starts[i] ?? [i % map.width, map.height - 1]);
    cs.units.push({ id: ch.id, side: 'hero', name: ch.name, pos, hp: ch.hp, maxHp: maxHp(index, ch), conditions: [], actionsLeft: 0, done: false, cooldowns: {}, usesThisCombat: {}, down: ch.hp <= 0 });
  });
  const ctx = partyWhen(c);
  const scope = partyScope(c);
  for (const sp of spec.spawns) {
    if (!evalWhen(sp.when, ctx)) continue;
    const count = evalInt(sp.count ?? 1, scope, c.rng);
    if (count <= 0) continue;
    if (sp.round && sp.round > 1) cs.waves.push({ enemy: sp.enemy, count, at: sp.at, round: sp.round });
    else spawn(c, cs, sp.enemy, count, sp.at);
  }
  startRound(c, cs);
  return cs;
}

function spawn(c: CombatCtx, cs: CombatState, enemyId: string, count: number, at?: string, near?: Point): void {
  const { index } = c;
  const def = enemyDef(index, enemyId);
  const map = mapOf(index, cs.map);
  const points = at ? (map.spawnPoints?.[at] ?? []) : [];
  const scope = partyScope(c);
  for (let i = 0; i < count; i++) {
    const want: Point = near ?? points[i % Math.max(1, points.length)] ?? [Math.floor(map.width / 2), 0];
    const pos = freeNear(c, cs, want);
    const hp = Math.max(1, evalInt(def.hp, scope, c.rng));
    const sameKind = cs.units.filter((u) => u.enemyId === enemyId).length;
    const name = text(def.name) + (count > 1 || sameKind > 0 ? ` ${sameKind + 1}` : '');
    const u: Unit = { id: `e${cs.nextId++}`, side: 'enemy', enemyId, name, pos, hp, maxHp: hp, conditions: [], actionsLeft: 0, done: false, cooldowns: {}, usesThisCombat: {} };
    cs.units.push(u);
    c.events.push({ type: 'unitSpawned', unitId: u.id, name: u.name, pos });
  }
}

// ---------- rounds ----------

function startRound(c: CombatCtx, cs: CombatState): void {
  cs.round += 1;
  cs.phase = 'heroes';
  c.events.push({ type: 'roundStarted', round: cs.round });
  for (const w of cs.waves.filter((w) => w.round === cs.round)) spawn(c, cs, w.enemy, w.count, w.at);
  cs.waves = cs.waves.filter((w) => w.round !== cs.round);
  for (const u of living(cs)) for (const k of Object.keys(u.cooldowns)) u.cooldowns[k] = Math.max(0, u.cooldowns[k] - 1);
  const base = c.index.pack.rules?.turn?.actionsPerTurn ?? 2;
  for (const u of cs.units.filter((x) => x.side === 'hero')) {
    u.done = false;
    u.actionsLeft = 0;
    if (u.down) {
      u.done = true;
      continue;
    }
    const skip = beginTurn(c, cs, u);
    if (skip || u.down) {
      u.done = true;
      continue;
    }
    u.actionsLeft = Math.max(1, base + Math.floor(unitMod(c, u, 'actions')));
  }
  planIntents(c, cs);
}

/** Start-of-turn condition effects, then durations tick. Returns true if the turn is skipped. */
function beginTurn(c: CombatCtx, cs: CombatState, u: Unit): boolean {
  const conds = conditionsOf(c, u);
  for (const cond of conds.slice()) {
    const def = c.index.conditions.get(cond.id);
    if (def?.onTurnStart) applyEffects(c, cs, u, def.onTurnStart, [u], undefined, false);
  }
  const skip = conds.some((x) => c.index.conditions.get(x.id)?.skipTurn);
  if (skip) c.events.push({ type: 'turnSkipped', unitId: u.id });
  // Only round-based durations tick here; a blessing from a story card counts cards.
  const ticking = (x: ActiveCondition) => x.per === 'round' && x.remaining !== undefined;
  for (const cond of conds) if (ticking(cond)) cond.remaining! -= 1;
  const expired = conds.filter((x) => ticking(x) && x.remaining! <= 0);
  for (const cond of expired) c.events.push({ type: 'unitCondition', unitId: u.id, condition: cond.id, on: false });
  setConditions(c, u, conds.filter((x) => !expired.includes(x)));
  return skip;
}

/** True once every hero who can still act has ended their turn. */
function heroesDone(cs: CombatState): boolean {
  return cs.units.every((u) => u.side !== 'hero' || u.done || u.down);
}

/** Run the enemy phase and the next round's start. Returns the outcome if the fight ended. */
function enemyPhase(c: CombatCtx, cs: CombatState): CombatOutcome {
  cs.phase = 'enemies';
  c.events.push({ type: 'enemyPhase' });
  for (const u of cs.units.filter((x) => x.side === 'enemy')) {
    if (u.dead) continue;
    const skip = beginTurn(c, cs, u);
    if (u.dead || skip) continue;
    enemyAct(c, cs, u);
    const out = outcome(c, cs);
    if (out) return out;
  }
  const out = outcome(c, cs, true);
  if (out) return out;
  startRound(c, cs);
  return outcome(c, cs);
}

export type CombatOutcome = 'victory' | 'defeat' | undefined;

function outcome(c: CombatCtx, cs: CombatState, roundOver = false): CombatOutcome {
  const heroes = cs.units.filter((u) => u.side === 'hero');
  if (heroes.every((u) => u.down)) return 'defeat';
  const enemies = cs.units.filter((u) => u.side === 'enemy');
  const o = cs.objective;
  switch (o.kind) {
    case 'defeatTarget':
      if (o.target && enemies.some((u) => u.enemyId === o.target) && enemies.filter((u) => u.enemyId === o.target).every((u) => u.dead)) return 'victory';
      break;
    case 'survive':
      if (roundOver && cs.round >= (o.rounds ?? 1)) return 'victory';
      break;
    case 'reachExit': {
      const exits = mapOf(c.index, cs.map).exits ?? [];
      if (heroes.some((u) => !u.down && exits.some((e) => same(e, u.pos)))) return 'victory';
      break;
    }
  }
  if (enemies.every((u) => u.dead) && !cs.waves.length) return 'victory';
  return undefined;
}

// ---------- hero actions ----------

export type CombatAction =
  | { type: 'move'; playerId: string; to: Point }
  | { type: 'useSkill'; playerId: string; skillId: string; target?: Point }
  | { type: 'useItem'; playerId: string; itemId: string; target?: Point }
  | { type: 'revive'; playerId: string; targetId: string }
  | { type: 'endTurn'; playerId: string };

export function combatAct(c: CombatCtx, action: CombatAction): CombatOutcome {
  const cs = c.s.combat;
  if (!cs) throw new CombatError('No combat is running');
  const u = cs.units.find((x) => x.id === action.playerId && x.side === 'hero');
  if (!u) throw new CombatError(`Unknown hero '${action.playerId}'`);
  if (u.down) throw new CombatError(`${u.name} is down`);
  if (u.done) throw new CombatError(`${u.name} has ended their turn`);

  switch (action.type) {
    case 'endTurn':
      break;
    case 'move': {
      need(u.actionsLeft >= 1, `${u.name} has no actions left`);
      need(!blockedFromMoving(c, u), `${u.name} can't move`);
      const path = pathTo(c, cs, u, toPoint(action.to));
      need(!!path, "Can't reach that square");
      u.actionsLeft -= 1;
      moveAlong(c, cs, u, path!);
      break;
    }
    case 'useSkill': {
      const skill = c.index.skills.get(action.skillId);
      need(!!skill && heroSkills(c, u).includes(action.skillId), `${u.name} doesn't know that skill`);
      const why = skillBlocked(c, cs, u, skill!);
      need(!why, why!);
      const target = resolveTarget(c, cs, u, skill!.targeting, action.target);
      useAbility(c, cs, u, skill!.cost ?? 1, skill!.targeting, target, { skill: skill! });
      u.cooldowns[skill!.id] = skill!.cooldown ?? 0;
      u.usesThisCombat[skill!.id] = (u.usesThisCombat[skill!.id] ?? 0) + 1;
      if (skill!.usesPerScenario) c.s.skillUses[`${u.id}:${skill!.id}`] = (c.s.skillUses[`${u.id}:${skill!.id}`] ?? 0) + 1;
      break;
    }
    case 'useItem': {
      const ch = heroOf(c, u);
      const item = c.index.items.get(action.itemId);
      need(!!item?.use && ch.inventory.includes(action.itemId), `${u.name} has no usable ${text(item?.name) || action.itemId}`);
      const cost = item!.use!.cost ?? 1;
      need(u.actionsLeft >= cost, `${u.name} has no actions left`);
      const target = resolveTarget(c, cs, u, item!.use!.targeting, action.target);
      ch.inventory.splice(ch.inventory.indexOf(action.itemId), 1);
      c.events.push({ type: 'itemUsed', unitId: u.id, itemId: action.itemId, name: text(item!.name) });
      useAbility(c, cs, u, cost, item!.use!.targeting, target, { item: item! });
      break;
    }
    case 'revive': {
      need(u.actionsLeft >= 1, `${u.name} has no actions left`);
      const t = cs.units.find((x) => x.id === action.targetId && x.side === 'hero');
      need(!!t?.down, 'Only a downed ally can be revived');
      need(dist(u.pos, t!.pos) <= 1, `Move next to ${t!.name} first`);
      u.actionsLeft -= 1;
      revive(c, cs, u, t!);
      break;
    }
  }
  if (action.type === 'endTurn' || u.actionsLeft <= 0) {
    u.done = true;
    u.actionsLeft = 0;
    c.events.push({ type: 'turnEnded', unitId: u.id });
  }
  const out = outcome(c, cs);
  if (out) return out;
  if (heroesDone(cs)) return enemyPhase(c, cs);
  return undefined;
}

function revive(c: CombatCtx, cs: CombatState, by: Unit, t: Unit): void {
  const rules = c.index.pack.rules?.downed;
  const check = rules?.reviveCheck ?? { stat: 'wis', dc: 10 };
  const stat = Array.isArray(check.stat) ? check.stat[0] : check.stat;
  const dc = evalInt(check.dc, partyScope(c), c.rng);
  const natural = c.rng.die(20);
  const total = natural + unitStat(c, by, stat);
  const success = natural !== 1 && (natural === 20 || total >= dc);
  c.events.push({ type: 'revived', unitId: t.id, byId: by.id, natural, total, dc, success });
  if (!success) return;
  const ch = heroOf(c, t);
  const scope = { ...characterScope(c.index, ch), maxHp: maxHp(c.index, ch) };
  heal(c, t, Math.max(1, evalInt(rules?.reviveHp ?? 1, scope, c.rng)));
}

function useAbility(c: CombatCtx, cs: CombatState, u: Unit, cost: number, targeting: Targeting | undefined, target: Point, src: { skill?: SkillDef; item?: ItemDef }): void {
  need(u.actionsLeft >= cost, `${u.name} has no actions left`);
  u.actionsLeft -= cost;
  // Acting breaks conditions like Hidden.
  dropConditions(c, u, 'act');
  const affected = affectedUnits(c, cs, u, targeting, target);
  const skill = src.skill;
  if (skill) {
    c.events.push({ type: 'skillUsed', unitId: u.id, skillId: skill.id, name: text(skill.name), target, targets: affected.map((x) => x.id) });
  }
  resolveEffects(c, cs, u, skill?.attack, skill?.effects ?? src.item?.use?.effects ?? [], skill?.onMiss, affected, target);
}

/** Roll to hit or to save per target, then apply the effects to those affected. */
function resolveEffects(c: CombatCtx, cs: CombatState, u: Unit, attack: SkillDef['attack'], effects: Effect[], onMiss: Effect[] | undefined, affected: Unit[], target: Point): void {
  // Self-moves (charge, dodge roll, blink) happen once, before the hit.
  const selfFirst = effects.filter((e) => e.target === 'self' && MOVES.has(e.type));
  for (const e of selfFirst) applyEffect(c, cs, u, e, [u], target, false);
  const rest = effects.filter((e) => !selfFirst.includes(e));
  const roll = attack ? (attack.roll ?? 'attack') : 'auto';
  if (roll === 'auto' || !affected.length) {
    applyEffects(c, cs, u, rest, affected, target, false);
    return;
  }
  for (const t of affected) {
    if (t.dead || (t.down && t.side === 'hero' && roll === 'attack')) continue;
    if (roll === 'attack') {
      const natural = c.rng.die(20);
      const bonus = unitStat(c, u, attack!.stat ?? 'str') + unitMod(c, u, 'attack') + (attack!.bonus !== undefined ? evalInt(attack!.bonus, unitScope(c, u), c.rng) : 0);
      const total = natural + bonus;
      const defense = unitDefense(c, cs, t);
      const critical = natural >= (c.index.pack.rules?.dice?.critOn ?? 20);
      const hit = critical || (natural > (c.index.pack.rules?.dice?.fumbleOn ?? 1) && total >= defense);
      c.events.push({ type: 'attackRolled', unitId: u.id, targetId: t.id, natural, total, defense, hit, critical });
      if (hit) applyEffects(c, cs, u, rest, [t], target, critical);
      else if (onMiss) applyEffects(c, cs, u, onMiss, [t], target, false);
    } else {
      const dc = spellDc(c, u);
      const natural = c.rng.die(20);
      const total = natural + unitStat(c, t, attack!.saveStat ?? 'dex');
      const saved = natural !== 1 && (natural === 20 || total >= dc);
      c.events.push({ type: 'saveRolled', unitId: t.id, natural, total, dc, saved });
      if (!saved) applyEffects(c, cs, u, rest, [t], target, false);
      else if (attack!.halfOnSave) applyEffects(c, cs, u, rest.filter((e) => e.type === 'damage'), [t], target, false, 0.5);
    }
  }
}

const MOVES = new Set<Effect['type']>(['move', 'teleport']);

// ---------- effects ----------

function applyEffects(c: CombatCtx, cs: CombatState, src: Unit, effects: Effect[], targets: Unit[], point: Point | undefined, critical: boolean, scale = 1): void {
  for (const e of effects) applyEffect(c, cs, src, e, targets, point, critical, scale);
}

function applyEffect(c: CombatCtx, cs: CombatState, src: Unit, e: Effect, targets: Unit[], point: Point | undefined, critical: boolean, scale = 1): void {
  const who = effectTargets(c, cs, src, e, targets);
  for (const t of who) {
    if (e.when && !evalWhen(e.when, unitWhen(c, cs, t))) continue;
    switch (e.type) {
      case 'damage': {
        const r = evalExpr(e.amount ?? 0, unitScope(c, src), c.rng);
        let amount = r.value;
        if (critical && (c.index.pack.rules?.dice?.critEffect ?? 'doubleDice') !== 'none') {
          for (const d of r.rolls) amount += c.index.pack.rules?.dice?.critEffect === 'maxDice' ? d.sides - d.value : c.rng.die(d.sides);
        }
        const resist = t.enemyId && e.damageType ? (enemyDef(c.index, t.enemyId).resist?.[e.damageType] ?? 1) : 1;
        damage(c, cs, t, Math.max(0, Math.floor(amount * resist * scale)), src, e.damageType);
        break;
      }
      case 'heal':
        heal(c, t, Math.max(0, evalInt(e.amount ?? 0, unitScope(c, src), c.rng)));
        break;
      case 'condition':
        addCondition(c, t, e.condition!, e.duration);
        break;
      case 'removeCondition': {
        const conds = conditionsOf(c, t);
        if (!conds.some((x) => x.id === e.condition)) break;
        setConditions(c, t, conds.filter((x) => x.id !== e.condition));
        c.events.push({ type: 'unitCondition', unitId: t.id, condition: e.condition!, on: false });
        break;
      }
      case 'push':
      case 'pull':
        shove(c, cs, t, src.pos, evalInt(e.distance ?? 1, unitScope(c, src), c.rng), e.type === 'pull');
        break;
      case 'move':
        if (point) moveToward(c, cs, t, point, evalInt(e.distance ?? 1, unitScope(c, src), c.rng));
        break;
      case 'teleport':
        if (point && isFree(c, cs, point)) {
          const from = t.pos;
          t.pos = point;
          c.events.push({ type: 'unitMoved', unitId: t.id, from, to: point, path: [point] });
        }
        break;
      case 'summon':
        spawn(c, cs, e.enemy!, evalInt(e.count ?? 1, unitScope(c, src), c.rng), undefined, src.pos);
        break;
      case 'resetCooldowns':
        t.cooldowns = {};
        break;
      case 'narrate':
        c.events.push({ type: 'narrate', text: text(e.text) });
        return;
    }
  }
}

function effectTargets(c: CombatCtx, cs: CombatState, src: Unit, e: Effect, targets: Unit[]): Unit[] {
  switch (e.target ?? 'targets') {
    case 'self':
      return [src];
    case 'party':
      return living(cs).filter((u) => u.side === src.side);
    case 'allEnemies':
      return living(cs).filter((u) => u.side !== src.side);
    case 'adjacent':
      return living(cs).filter((u) => u.side !== src.side && dist(u.pos, src.pos) === 1);
    case 'random': {
      const pool = living(cs).filter((u) => u.side !== src.side);
      return pool.length ? [pool[c.rng.int(pool.length)]] : [];
    }
    default:
      return targets;
  }
}

function damage(c: CombatCtx, cs: CombatState, t: Unit, amount: number, src: Unit | undefined, damageType?: string): void {
  if (t.dead || (t.side === 'hero' && t.down)) return;
  if (t.side === 'hero') {
    const ch = heroOf(c, t);
    ch.hp = Math.max(0, ch.hp - amount);
    t.hp = ch.hp;
  } else {
    t.hp = Math.max(0, t.hp - amount);
  }
  if (src && src.side === 'hero') cs.threat[src.id] = (cs.threat[src.id] ?? 0) + amount;
  c.events.push({ type: 'unitDamaged', unitId: t.id, amount, hp: t.hp, damageType });
  if (amount > 0) dropConditions(c, t, 'damaged');
  if (t.hp > 0) return;
  if (t.side === 'hero') {
    t.down = true;
    t.done = true;
    t.actionsLeft = 0;
    c.events.push({ type: 'unitDown', unitId: t.id });
  } else {
    t.dead = true;
    t.intent = undefined;
    c.events.push({ type: 'unitDied', unitId: t.id, killerId: src?.id });
    const def = enemyDef(c.index, t.enemyId!);
    if (src?.side === 'hero' && (def.xp || def.loot)) c.reward(src.id, def.xp ?? 0, def.loot);
  }
}

function heal(c: CombatCtx, t: Unit, amount: number): void {
  if (t.dead) return;
  let gained: number;
  if (t.side === 'hero') {
    const ch = heroOf(c, t);
    gained = Math.max(0, Math.min(maxHp(c.index, ch) - ch.hp, amount));
    ch.hp += gained;
    t.hp = ch.hp;
    if (t.down && ch.hp > 0) {
      // Back on their feet, but their turn is spent.
      t.down = false;
      t.done = true;
    }
  } else {
    gained = Math.max(0, Math.min(t.maxHp - t.hp, amount));
    t.hp += gained;
  }
  c.events.push({ type: 'unitHealed', unitId: t.id, amount: gained, hp: t.hp });
}

function addCondition(c: CombatCtx, t: Unit, id: string, duration?: number): void {
  if (t.dead) return;
  const def = c.index.conditions.get(id);
  const conds = conditionsOf(c, t);
  const existing = conds.find((x) => x.id === id);
  if (existing && def?.stacking === 'ignore') return;
  if (existing && def?.stacking !== 'stack') Object.assign(existing, { remaining: duration, per: 'round' });
  else conds.push({ id, remaining: duration, per: 'round' });
  setConditions(c, t, conds);
  c.events.push({ type: 'unitCondition', unitId: t.id, condition: id, on: true, duration });
}

function dropConditions(c: CombatCtx, u: Unit, trigger: NonNullable<ConditionDef['endsOn']>[number]): void {
  const conds = conditionsOf(c, u);
  const ending = conds.filter((x) => c.index.conditions.get(x.id)?.endsOn?.includes(trigger));
  if (!ending.length) return;
  setConditions(c, u, conds.filter((x) => !ending.includes(x)));
  for (const x of ending) c.events.push({ type: 'unitCondition', unitId: u.id, condition: x.id, on: false });
}

/** Clear combat-only state when the fight ends. */
export function endCombat(c: CombatCtx): void {
  // Round-based effects and anything that ends with the fight fall away.
  for (const ch of c.s.party) {
    ch.conditions = ch.conditions.filter((x) => !(x.per === 'round' && x.remaining !== undefined) && !c.index.conditions.get(x.id)?.endsOn?.includes('combatEnd'));
  }
  c.s.combat = undefined;
}

// ---------- enemy AI ----------

function planIntents(c: CombatCtx, cs: CombatState): void {
  for (const u of cs.units) {
    if (u.side !== 'enemy' || u.dead) continue;
    const def = enemyDef(c.index, u.enemyId!);
    const ctx = unitWhen(c, cs, u);
    const rule = (def.behavior ?? []).find((b) => evalWhen(b.when, ctx)) ?? { do: def.skills?.[0] ?? 'approach', target: 'nearest' as const };
    const targetRule = rule.target ?? 'nearest';
    const action = c.index.skills.has(rule.do) ? 'skill' : (rule.do as Intent['action']);
    const skill = action === 'skill' ? c.index.skills.get(rule.do) : undefined;
    const target = action === 'flee' || action === 'hold' ? undefined : pickTarget(c, cs, u, targetRule, skill?.targeting);
    u.intent = { action, skillId: skill?.id, targetId: target?.id, rule: targetRule };
  }
}

function pickTarget(c: CombatCtx, cs: CombatState, u: Unit, rule: EnemyTargetRule, targeting?: Targeting): Unit | undefined {
  const friendly = rule === 'self' || rule === 'weakestAlly' || targeting?.target === 'ally' || targeting?.target === 'self';
  if (rule === 'self' || targeting?.target === 'self') return u;
  const pool = living(cs).filter((x) => (friendly ? x.side === u.side : x.side !== u.side && !untargetable(c, x)));
  if (!pool.length) return undefined;
  const frac = (x: Unit) => x.hp / Math.max(1, x.maxHp);
  const by = (score: (x: Unit) => number) => pool.reduce((best, x) => (score(x) < score(best) ? x : best));
  switch (rule) {
    case 'lowestHp':
      return by((x) => x.hp * 1000 + dist(x.pos, u.pos));
    case 'highestHp':
      return by((x) => -x.hp * 1000 + dist(x.pos, u.pos));
    case 'highestThreat':
      return by((x) => -(cs.threat[x.id] ?? 0) * 1000 + dist(x.pos, u.pos));
    case 'weakestAlly':
      return by((x) => frac(x) * 1000 + dist(x.pos, u.pos));
    case 'random':
      return pool[c.rng.int(pool.length)];
    default:
      return by((x) => dist(x.pos, u.pos) * 1000 + x.hp);
  }
}

/** An enemy takes at most one move and one ability, following its intent. */
function enemyAct(c: CombatCtx, cs: CombatState, u: Unit): void {
  const def = enemyDef(c.index, u.enemyId!);
  const intent = u.intent;
  if (!intent || intent.action === 'hold') return;
  if (intent.action === 'flee') {
    const foes = living(cs).filter((x) => x.side !== u.side);
    if (!foes.length || blockedFromMoving(c, u)) return;
    const reach = reachable(c, cs, u, unitMove(c, u));
    let best: Point | undefined;
    let bestScore = Math.min(...foes.map((f) => dist(f.pos, u.pos)));
    for (const key of reach.keys()) {
      const p = fromKey(key);
      const score = Math.min(...foes.map((f) => dist(f.pos, p)));
      if (score > bestScore) [best, bestScore] = [p, score];
    }
    if (best) moveAlong(c, cs, u, pathTo(c, cs, u, best)!);
    return;
  }
  // Keep the target shown in the intent if it's still standing.
  let target = cs.units.find((x) => x.id === intent.targetId && !x.dead && !x.down && !untargetable(c, x));
  const skill = intent.skillId ? c.index.skills.get(intent.skillId) : undefined;
  if (!target) target = pickTarget(c, cs, u, intent.rule, skill?.targeting);
  if (!target) return;
  const attack = skill ?? c.index.skills.get(def.skills?.[0] ?? '');
  const inReach = (s: SkillDef | undefined) => !!s && validTargetPoints(c, cs, u, s.targeting).some((p) => same(p, target!.pos));
  if (!inReach(attack) && !blockedFromMoving(c, u)) {
    const range = attack?.targeting?.range ?? 1;
    const dest = bestApproach(c, cs, u, target, range);
    if (dest) moveAlong(c, cs, u, pathTo(c, cs, u, dest)!);
  }
  if (attack && (u.cooldowns[attack.id] ?? 0) === 0 && inReach(attack) && !u.dead) {
    u.actionsLeft = attack.cost ?? 1;
    useAbility(c, cs, u, attack.cost ?? 1, attack.targeting, target.pos, { skill: attack });
    u.cooldowns[attack.id] = attack.cooldown ?? 0;
  }
}

/** The reachable square closest to `range` of the target, preferring the shortest walk. */
function bestApproach(c: CombatCtx, cs: CombatState, u: Unit, target: Unit, range: number): Point | undefined {
  const reach = reachable(c, cs, u, unitMove(c, u));
  let best: Point | undefined;
  let bestScore = Infinity;
  for (const [key, cost] of reach) {
    const p = fromKey(key);
    const d = dist(p, target.pos);
    const score = Math.max(0, d - range) * 100 + cost;
    if (score < bestScore) [best, bestScore] = [p, score];
  }
  return best && !same(best, u.pos) ? best : undefined;
}

// ---------- targeting ----------

/** Squares a hero could aim a skill or item at right now. */
export function validTargetPoints(c: Reader, cs: CombatState, u: Unit, t?: Targeting): Point[] {
  const kind = t?.target ?? 'enemy';
  if (kind === 'self' || kind === 'allAllies' || kind === 'allEnemies') return [u.pos];
  const range = t?.range ?? 1;
  const map = mapOf(c.index, cs.map);
  const los = t?.lineOfSight ?? true;
  const ok = (p: Point) => dist(u.pos, p) <= range && (!los || lineOfSight(c, cs, u.pos, p));
  if (kind === 'tile') {
    const out: Point[] = [];
    for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) if (ok([x, y]) && passable(c, cs, [x, y])) out.push([x, y]);
    return out;
  }
  return cs.units
    .filter((x) => !x.dead)
    .filter((x) => {
      if (kind === 'enemy') return x.side !== u.side && !x.down && !untargetable(c, x);
      if (kind === 'ally') return x.side === u.side;
      return !x.down;
    })
    .map((x) => x.pos)
    .filter(ok);
}

function resolveTarget(c: CombatCtx, cs: CombatState, u: Unit, t: Targeting | undefined, target: Point | undefined): Point {
  const valid = validTargetPoints(c, cs, u, t);
  const kind = t?.target ?? 'enemy';
  if (kind === 'self' || kind === 'allAllies' || kind === 'allEnemies') return u.pos;
  need(!!target, 'Pick a target');
  const p = toPoint(target!);
  need(valid.some((v) => same(v, p)), 'That target is out of range or out of sight');
  return p;
}

/** Units an ability aimed at `point` would touch. */
export function affectedUnits(c: Reader, cs: CombatState, u: Unit, t: Targeting | undefined, point: Point): Unit[] {
  const kind = t?.target ?? 'enemy';
  const alive = cs.units.filter((x) => !x.dead);
  const foe = (x: Unit) => x.side !== u.side && !x.down;
  const ally = (x: Unit) => x.side === u.side;
  if (kind === 'allAllies') return alive.filter(ally);
  if (kind === 'allEnemies') return alive.filter(foe);
  // Who an area can hit: the side the ability is meant for, plus allies with friendly fire.
  const helpful = kind === 'self' || kind === 'ally';
  const eligible = (x: Unit) => kind === 'any' || (helpful ? ally(x) : foe(x) || (!!t?.friendlyFire && x.side === u.side));
  const shape = t?.area?.shape ?? 'single';
  const size = t?.area?.size ?? 0;
  let hit: Unit[];
  if (shape === 'single' || (shape === 'burst' && size === 0)) {
    hit = alive.filter((x) => same(x.pos, point) && (kind === 'tile' || kind === 'self' ? eligible(x) : true));
    if (kind === 'self' && !hit.length) hit = [u];
  } else if (shape === 'burst') {
    hit = alive.filter((x) => dist(x.pos, point) <= size && eligible(x));
  } else if (shape === 'ring') {
    hit = alive.filter((x) => dist(x.pos, point) === size && eligible(x));
  } else {
    const squares = shape === 'line' ? lineSquares(u.pos, point, size || dist(u.pos, point)) : coneSquares(u.pos, point, size);
    hit = alive.filter((x) => x !== u && squares.some((p) => same(p, x.pos)) && eligible(x));
    hit.sort((a, b) => dist(a.pos, u.pos) - dist(b.pos, u.pos));
  }
  if (t?.maxTargets) hit = hit.slice(0, t.maxTargets);
  return hit;
}

function lineSquares(from: Point, to: Point, length: number): Point[] {
  const dx = Math.sign(to[0] - from[0]);
  const dy = Math.sign(to[1] - from[1]);
  const out: Point[] = [];
  const ray = bresenham(from, [from[0] + (to[0] - from[0]) * 10, from[1] + (to[1] - from[1]) * 10]);
  for (const p of ray.slice(1, length + 1)) out.push(p);
  if (!out.length && (dx || dy)) out.push([from[0] + dx, from[1] + dy]);
  return out;
}

function coneSquares(from: Point, to: Point, size: number): Point[] {
  const dir: Point = [Math.sign(to[0] - from[0]), Math.sign(to[1] - from[1])];
  const out: Point[] = [];
  for (let y = from[1] - size; y <= from[1] + size; y++) {
    for (let x = from[0] - size; x <= from[0] + size; x++) {
      const v: Point = [x - from[0], y - from[1]];
      const d = Math.max(Math.abs(v[0]), Math.abs(v[1]));
      if (d === 0 || d > size) continue;
      // Within 45 degrees of the aim direction.
      const dot = v[0] * dir[0] + v[1] * dir[1];
      const len = Math.hypot(v[0], v[1]) * Math.hypot(dir[0], dir[1]);
      if (len && dot / len >= Math.SQRT1_2 - 1e-9) out.push([x, y]);
    }
  }
  return out;
}

// ---------- movement ----------

/** Squares a unit can end a move on, with the cost to get there. */
export function reachable(c: Reader, cs: CombatState, u: Unit, budget: number): Map<string, number> {
  const diag = c.index.pack.rules?.turn?.diagonalCost ?? 1;
  const best = new Map<string, number>([[key(u.pos), 0]]);
  const queue: [Point, number][] = [[u.pos, 0]];
  while (queue.length) {
    queue.sort((a, b) => a[1] - b[1]);
    const [p, cost] = queue.shift()!;
    if (cost > (best.get(key(p)) ?? Infinity)) continue;
    for (const [dx, dy] of NEIGHBORS) {
      const n: Point = [p[0] + dx, p[1] + dy];
      const step = moveCost(c, cs, n, u);
      if (step < 0) continue;
      const next = cost + step * (dx && dy ? diag : 1);
      if (next > budget || next >= (best.get(key(n)) ?? Infinity)) continue;
      best.set(key(n), next);
      queue.push([n, next]);
    }
  }
  // You can walk through allies but not stop on them.
  for (const k of [...best.keys()]) if (k !== key(u.pos) && occupant(cs, fromKey(k))) best.delete(k);
  best.delete(key(u.pos));
  return best;
}

function pathTo(c: Reader, cs: CombatState, u: Unit, to: Point): Point[] | undefined {
  const reach = reachable(c, cs, u, unitMove(c, u));
  if (!reach.has(key(to))) return undefined;
  // Walk back from the goal along cheapest neighbors.
  const diag = c.index.pack.rules?.turn?.diagonalCost ?? 1;
  const costs = new Map<string, number>([[key(u.pos), 0]]);
  const prev = new Map<string, string>();
  const queue: [Point, number][] = [[u.pos, 0]];
  while (queue.length) {
    queue.sort((a, b) => a[1] - b[1]);
    const [p, cost] = queue.shift()!;
    if (same(p, to)) break;
    for (const [dx, dy] of NEIGHBORS) {
      const n: Point = [p[0] + dx, p[1] + dy];
      const step = moveCost(c, cs, n, u);
      if (step < 0) continue;
      const next = cost + step * (dx && dy ? diag : 1);
      if (next >= (costs.get(key(n)) ?? Infinity)) continue;
      costs.set(key(n), next);
      prev.set(key(n), key(p));
      queue.push([n, next]);
    }
  }
  const path: Point[] = [];
  for (let k: string | undefined = key(to); k && k !== key(u.pos); k = prev.get(k)) path.unshift(fromKey(k));
  return path;
}

function moveAlong(c: CombatCtx, cs: CombatState, u: Unit, path: Point[]): void {
  if (!path.length) return;
  const from = u.pos;
  u.pos = path[path.length - 1];
  c.events.push({ type: 'unitMoved', unitId: u.id, from, to: u.pos, path });
  enterTerrain(c, cs, u);
}

/** Step toward a point (charge, dodge roll), stopping next to whoever stands there. */
function moveToward(c: CombatCtx, cs: CombatState, u: Unit, point: Point, distance: number): void {
  const path: Point[] = [];
  let at = u.pos;
  for (let i = 0; i < distance; i++) {
    const options = NEIGHBORS.map(([dx, dy]) => [at[0] + dx, at[1] + dy] as Point).filter((p) => isFree(c, cs, p) && dist(p, point) < dist(at, point));
    if (!options.length) break;
    at = options.reduce((a, b) => (dist(a, point) <= dist(b, point) ? a : b));
    path.push(at);
  }
  moveAlong(c, cs, u, path);
}

function shove(c: CombatCtx, cs: CombatState, t: Unit, from: Point, distance: number, toward: boolean): void {
  const path: Point[] = [];
  let at = t.pos;
  const dx = Math.sign(at[0] - from[0]) * (toward ? -1 : 1);
  const dy = Math.sign(at[1] - from[1]) * (toward ? -1 : 1);
  for (let i = 0; i < distance; i++) {
    const next: Point = [at[0] + dx, at[1] + dy];
    if (!isFree(c, cs, next)) break;
    at = next;
    path.push(at);
  }
  moveAlong(c, cs, t, path);
}

function enterTerrain(c: CombatCtx, cs: CombatState, u: Unit): void {
  const terrain = terrainAt(c, cs, u.pos);
  if (terrain?.onEnter) applyEffects(c, cs, u, terrain.onEnter, [u], u.pos, false);
}

const NEIGHBORS: Point[] = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

function moveCost(c: Reader, cs: CombatState, p: Point, mover: Unit): number {
  if (!inside(c, cs, p)) return -1;
  const cost = terrainAt(c, cs, p)?.moveCost ?? 1;
  if (cost < 0) return -1;
  const o = occupant(cs, p);
  if (o && o.side !== mover.side) return -1;
  return cost;
}

function passable(c: Reader, cs: CombatState, p: Point): boolean {
  return inside(c, cs, p) && (terrainAt(c, cs, p)?.moveCost ?? 1) >= 0;
}

function isFree(c: Reader, cs: CombatState, p: Point): boolean {
  return passable(c, cs, p) && !occupant(cs, p);
}

/** Nearest free passable square to `want`. */
function freeNear(c: Reader, cs: CombatState, want: Point): Point {
  const map = mapOf(c.index, cs.map);
  for (let r = 0; r < map.width + map.height; r++) {
    for (let y = want[1] - r; y <= want[1] + r; y++) {
      for (let x = want[0] - r; x <= want[0] + r; x++) {
        if (Math.max(Math.abs(x - want[0]), Math.abs(y - want[1])) !== r) continue;
        if (isFree(c, cs, [x, y])) return [x, y];
      }
    }
  }
  throw new CombatError(`Map '${map.id}' has no room left`);
}

function occupant(cs: CombatState, p: Point): Unit | undefined {
  return cs.units.find((u) => !u.dead && same(u.pos, p));
}

function inside(c: Reader, cs: CombatState, p: Point): boolean {
  const map = mapOf(c.index, cs.map);
  return p[0] >= 0 && p[1] >= 0 && p[0] < map.width && p[1] < map.height;
}

export function terrainAt(c: { index: PackIndex }, cs: CombatState, p: Point): TerrainDef | undefined {
  const symbol = mapOf(c.index, cs.map).tiles?.[p[1]]?.[p[0]] ?? '.';
  return (c.index.pack.terrain ?? []).find((t) => t.symbol === symbol);
}

function lineOfSight(c: Reader, cs: CombatState, a: Point, b: Point): boolean {
  const line = bresenham(a, b);
  return line.slice(1, -1).every((p) => !terrainAt(c, cs, p)?.blocksSight);
}

function bresenham(a: Point, b: Point): Point[] {
  const out: Point[] = [];
  let [x, y] = a;
  const dx = Math.abs(b[0] - x);
  const dy = -Math.abs(b[1] - y);
  const sx = x < b[0] ? 1 : -1;
  const sy = y < b[1] ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    out.push([x, y]);
    if (x === b[0] && y === b[1]) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
  return out;
}

// ---------- unit stats ----------

export function heroOf(c: { s: CombatCtx['s'] }, u: Unit): Character {
  return c.s.party.find((p) => p.id === u.id)!;
}

export function conditionsOf(c: { s: CombatCtx['s'] }, u: Unit): ActiveCondition[] {
  return u.side === 'hero' ? heroOf(c, u).conditions : u.conditions;
}

function setConditions(c: CombatCtx, u: Unit, list: ActiveCondition[]): void {
  if (u.side === 'hero') heroOf(c, u).conditions = list;
  else u.conditions = list;
}

function enemyMod(c: { index: PackIndex }, u: Unit, key: string): number {
  let sum = 0;
  for (const cond of u.conditions) {
    const m = c.index.conditions.get(cond.id)?.modifiers?.[key];
    if (m !== undefined) sum += evalInt(m, enemyDef(c.index, u.enemyId!).stats);
  }
  return sum;
}

export function unitMod(c: Reader, u: Unit, key: string): number {
  return u.side === 'hero' ? modifier(c.index, heroOf(c, u), key) : enemyMod(c, u, key);
}

export function unitStat(c: Reader, u: Unit, key: string): number {
  return u.side === 'hero' ? statOf(c.index, heroOf(c, u), key) : (enemyDef(c.index, u.enemyId!).stats[key] ?? 0) + enemyMod(c, u, key);
}

function unitScope(c: CombatCtx, u: Unit): Scope {
  if (u.side === 'hero') {
    const ch = heroOf(c, u);
    return characterScope(c.index, ch, { ...partyScope(c), hp: ch.hp, maxHp: maxHp(c.index, ch) });
  }
  const scope: Scope = { ...partyScope(c), level: partyScope(c).partyLevel, hp: u.hp, maxHp: u.maxHp, armor: enemyMod(c, u, 'armor') };
  for (const k of c.index.abilityStats) scope[k] = unitStat(c, u, k);
  return scope;
}

export function unitDefense(c: Reader, cs: CombatState, u: Unit): number {
  const cover = terrainAt(c, cs, u.pos)?.defenseBonus ?? 0;
  if (u.side === 'hero') {
    const ch = heroOf(c, u);
    const formula = c.index.pack.rules?.derived?.defense ?? '10 + dex + armor';
    return evalInt(formula, characterScope(c.index, ch)) + modifier(c.index, ch, 'defense') + cover;
  }
  const def = enemyDef(c.index, u.enemyId!);
  return evalInt(def.defense ?? 10, def.stats) + enemyMod(c, u, 'defense') + cover;
}

export function unitMove(c: Reader, u: Unit): number {
  if (u.side === 'hero') {
    const ch = heroOf(c, u);
    const formula = c.index.pack.rules?.derived?.move ?? 'classMove';
    return Math.max(0, evalInt(formula, characterScope(c.index, ch)) + Math.floor(modifier(c.index, ch, 'move')));
  }
  return Math.max(0, (enemyDef(c.index, u.enemyId!).move ?? 5) + Math.floor(enemyMod(c, u, 'move')));
}

function spellDc(c: CombatCtx, u: Unit): number {
  return evalInt(c.index.pack.rules?.derived?.spellDc ?? '10 + max(int, wis)', unitScope(c, u));
}

export function blockedFromMoving(c: Reader, u: Unit): boolean {
  return conditionsOf(c, u).some((x) => c.index.conditions.get(x.id)?.preventMove);
}

function untargetable(c: Reader, u: Unit): boolean {
  return conditionsOf(c, u).some((x) => c.index.conditions.get(x.id)?.untargetable);
}

function unitWhen(c: CombatCtx, cs: CombatState, u: Unit): WhenContext {
  return {
    flags: new Set([...c.s.flags, ...c.s.scenarioFlags]),
    partySize: c.s.party.length,
    level: partyScope(c).partyLevel,
    rng: c.rng,
    stat: (k) => unitStat(c, u, k),
    hpFraction: u.hp / Math.max(1, u.maxHp),
    adjacentToEnemy: living(cs).some((x) => x.side !== u.side && dist(x.pos, u.pos) === 1),
    round: cs.round,
    classId: u.side === 'hero' ? heroOf(c, u).classId : undefined,
  };
}

/** Skills a hero can use in combat: learned ones plus those granted by equipment. */
export function heroSkills(c: Reader, u: Unit): string[] {
  const ch = heroOf(c, u);
  const granted = Object.values(ch.equipment).flatMap((id) => c.index.items.get(id)?.grantsSkills ?? []);
  return [...new Set([...ch.skills, ...granted])].filter((id) => {
    const s = c.index.skills.get(id);
    return s && !s.passive && (s.targeting || s.effects?.length);
  });
}

/** Why a hero can't use a skill right now, or undefined if they can. */
export function skillBlocked(c: Reader, cs: CombatState, u: Unit, skill: SkillDef): string | undefined {
  if (u.actionsLeft < (skill.cost ?? 1)) return 'Not enough actions';
  if ((u.cooldowns[skill.id] ?? 0) > 0) return `Ready in ${u.cooldowns[skill.id]} round${u.cooldowns[skill.id] === 1 ? '' : 's'}`;
  if (skill.usesPerCombat && (u.usesThisCombat[skill.id] ?? 0) >= skill.usesPerCombat) return 'Used up this fight';
  if (skill.usesPerScenario && (c.s.skillUses[`${u.id}:${skill.id}`] ?? 0) >= skill.usesPerScenario) return 'Used up this scenario';
  if (!validTargetPoints(c, cs, u, skill.targeting).length) return 'No target in range';
  return undefined;
}

// ---------- small helpers ----------

function living(cs: CombatState): Unit[] {
  return cs.units.filter((u) => !u.dead && !u.down);
}

export function dist(a: Point, b: Point): number {
  return Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]));
}

function same(a: Point, b: Point): boolean {
  return a[0] === b[0] && a[1] === b[1];
}

const key = (p: Point) => `${p[0]},${p[1]}`;
export const fromKey = (k: string): Point => k.split(',').map(Number) as Point;

function toPoint(p: unknown): Point {
  if (!Array.isArray(p) || p.length !== 2 || !p.every((n) => Number.isInteger(n))) throw new CombatError('Bad square');
  return [p[0], p[1]];
}

function need(ok: boolean, message: string): void {
  if (!ok) throw new CombatError(message);
}

export function mapOf(index: PackIndex, id: string): MapDef {
  const m = index.pack.maps?.find((x) => x.id === id);
  if (!m) throw new CombatError(`Unknown map '${id}'`);
  return m;
}

export function enemyDef(index: PackIndex, id: string): EnemyDef {
  const e = index.pack.enemies?.find((x) => x.id === id);
  if (!e) throw new CombatError(`Unknown enemy '${id}'`);
  return e;
}

function partyScope(c: CombatCtx): { partySize: number; partyLevel: number } {
  const party = c.s.party;
  return { partySize: party.length, partyLevel: Math.floor(party.reduce((s, ch) => s + ch.level, 0) / party.length) };
}

function partyWhen(c: CombatCtx): WhenContext {
  return { flags: new Set([...c.s.flags, ...c.s.scenarioFlags]), partySize: c.s.party.length, level: partyScope(c).partyLevel, rng: c.rng };
}
