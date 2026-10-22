// What the server sends to each device. The screen gets the public view; a
// phone gets the same plus which heroes it controls and its own secret rolls.
// The web client imports these types, so keep them plain JSON.

import { describeTile, mapOf, maxHp, statOf, text, xpForLevel, type Character, type GameState, type HeroCombatOptions, type PackIndex, type Point, type Prompt } from '@otrpg/engine';

export type { AbilityOption, HeroCombatOptions, Point } from '@otrpg/engine';

export interface HeroView {
  id: string;
  name: string;
  classId: string;
  className: string;
  /** False while the phone that controls this hero is disconnected. */
  online: boolean;
  level: number;
  xp: number;
  xpNext?: number;
  hp: number;
  maxHp: number;
  gold: number;
  stats: Record<string, number>;
  conditions: string[];
  skills: string[];
  items: string[];
}

export type PromptView =
  | { kind: 'vote'; rule: string; options: { label: string; enabled: boolean; voters: string[] }[] }
  | { kind: 'chooseRoller'; stats: string[]; dc: string }
  | { kind: 'combat'; enemies: { name: string; count: number }[] }
  | { kind: 'shop'; stock: { itemId: string; name: string; price: number; qty: number }[] }
  | { kind: 'levelUp'; heroId: string; level: number; tiles: { label: string; anyStat: boolean }[]; freeRerolls: number; rerollCost?: number };

export interface UnitView {
  id: string;
  side: 'hero' | 'enemy';
  name: string;
  pos: Point;
  hp: number;
  maxHp: number;
  down: boolean;
  conditions: string[];
  token?: string;
  /** Enemies: what they will do this round, when the pack shows intents. */
  intent?: { label: string; targetId?: string };
  actionsLeft: number;
  done: boolean;
}

export interface CombatView {
  round: number;
  phase: 'heroes' | 'enemies';
  objective: string;
  map: {
    name: string;
    width: number;
    height: number;
    background?: string;
    /** One string per row of terrain symbols. */
    tiles: string[];
    terrain: { symbol: string; name: string; moveCost: number; defenseBonus: number; blocksSight: boolean; hazard: boolean }[];
    exits: Point[];
  };
  /** Living units; fallen enemies are left out. */
  units: UnitView[];
  /** Enemies still to arrive, by round. */
  reinforcements: { name: string; count: number; round: number }[];
}

export interface LogLine {
  id: number;
  text: string;
}

export interface PublicView {
  code: string;
  packName: string;
  phase: 'lobby' | 'playing' | 'ended';
  result?: 'victory' | 'defeat';
  maxHeroes: number;
  classes: { id: string; name: string; role?: string }[];
  scenarios: { id: string; name: string }[];
  scenarioId?: string;
  scenarioName?: string;
  stats: string[];
  heroes: HeroView[];
  card?: { title: string; text: string; type: string; image?: string };
  cardsLeft: number;
  prompt?: PromptView;
  /** Heroes the game is waiting on; empty means anyone can continue. */
  waitingOn: string[];
  log: LogLine[];
  combat?: CombatView;
  /** Phones and screens currently connected. */
  devices: { controllers: number; screens: number };
}

export interface ControllerView extends PublicView {
  role: 'controller';
  /** Heroes this phone controls. It may also act for heroes whose phone is offline. */
  mine: string[];
  /** In a fight: what each hero this phone can play may do right now. */
  combatOptions?: HeroCombatOptions[];
}

export interface ScreenView extends PublicView {
  role: 'screen';
}

export type View = ControllerView | ScreenView;

export function heroView(index: PackIndex, ch: Character, online: boolean): HeroView {
  const maxLevel = index.pack.rules?.leveling?.maxLevel ?? 20;
  return {
    id: ch.id,
    name: ch.name,
    classId: ch.classId,
    className: text(index.classes.get(ch.classId)?.name) || ch.classId,
    online,
    level: ch.level,
    xp: ch.xp,
    xpNext: ch.level < maxLevel ? xpForLevel(index, ch.level + 1) : undefined,
    hp: ch.hp,
    maxHp: maxHp(index, ch),
    gold: ch.gold,
    stats: Object.fromEntries(index.abilityStats.map((k) => [k, statOf(index, ch, k)])),
    conditions: ch.conditions.map((c) => text(index.conditions.get(c.id)?.name) || c.id),
    skills: ch.skills.map((s) => text(index.skills.get(s)?.name) || s),
    items: [...Object.values(ch.equipment), ...ch.inventory].map((i) => text(index.items.get(i)?.name) || i),
  };
}

export function promptView(index: PackIndex, p: Prompt): PromptView {
  switch (p.kind) {
    case 'vote':
      return {
        kind: 'vote',
        rule: p.rule,
        options: p.options.map((o, i) => ({
          label: o.label,
          enabled: o.enabled,
          voters: Object.entries(p.votes).filter(([, v]) => v === i).map(([id]) => id),
        })),
      };
    case 'chooseRoller':
      return { kind: 'chooseRoller', stats: p.stats, dc: String(p.check.dc) };
    case 'combat':
      return {
        kind: 'combat',
        enemies: p.enemies.map((e) => ({ name: text(index.pack.enemies?.find((en) => en.id === e.enemy)?.name) || e.enemy, count: e.count })),
      };
    case 'shop':
      return { kind: 'shop', stock: p.stock.map((e) => ({ ...e, name: text(index.items.get(e.itemId)?.name) || e.itemId })) };
    case 'levelUp':
      return {
        kind: 'levelUp',
        heroId: p.playerId,
        level: p.level,
        tiles: p.tiles.map((t) => ({ label: describeTile(index, t), anyStat: t.kind === 'anyStat' })),
        freeRerolls: p.freeRerolls,
        rerollCost: p.rerollCost,
      };
  }
}

export function combatView(index: PackIndex, state: GameState, asset: (key?: string) => string | undefined): CombatView | undefined {
  const cs = state.combat;
  if (!cs) return undefined;
  const map = mapOf(index, cs.map);
  const showIntents = index.pack.rules?.turn?.showEnemyIntents ?? true;
  const nameOf = (id?: string) => cs.units.find((u) => u.id === id)?.name;
  const o = cs.objective;
  const target = o.target ? text(index.pack.enemies?.find((e) => e.id === o.target)?.name) || o.target : '';
  const objective =
    o.kind === 'defeatTarget' ? `Defeat ${target}` : o.kind === 'survive' ? `Survive ${o.rounds ?? 1} rounds` : o.kind === 'reachExit' ? 'Reach the exit' : 'Defeat every enemy';
  const terrain = (index.pack.terrain ?? []).filter((t) => t.symbol);
  return {
    round: cs.round,
    phase: cs.phase,
    objective,
    map: {
      name: text(map.name) || map.id,
      width: map.width,
      height: map.height,
      background: asset(map.background),
      tiles: map.tiles ?? Array.from({ length: map.height }, () => '.'.repeat(map.width)),
      terrain: terrain.map((t) => ({ symbol: t.symbol!, name: text(t.name) || t.id, moveCost: t.moveCost ?? 1, defenseBonus: t.defenseBonus ?? 0, blocksSight: !!t.blocksSight, hazard: !!t.onEnter?.length })),
      exits: map.exits ?? [],
    },
    units: cs.units
      .filter((u) => !u.dead)
      .map((u) => {
        const ch = u.side === 'hero' ? state.party.find((p) => p.id === u.id) : undefined;
        const def = u.enemyId ? index.pack.enemies?.find((e) => e.id === u.enemyId) : undefined;
        const conds = ch ? ch.conditions : u.conditions;
        const intent =
          showIntents && u.intent
            ? {
                label:
                  u.intent.action === 'skill'
                    ? `${text(index.skills.get(u.intent.skillId!)?.name)} ${u.intent.targetId === u.id ? 'self' : `→ ${nameOf(u.intent.targetId) ?? '?'}`}`
                    : u.intent.action === 'approach'
                      ? `Approach ${nameOf(u.intent.targetId) ?? ''}`.trim()
                      : u.intent.action === 'flee'
                        ? 'Flee'
                        : 'Hold',
                targetId: u.intent.targetId,
              }
            : undefined;
        return {
          id: u.id,
          side: u.side,
          name: u.name,
          pos: u.pos,
          hp: ch ? ch.hp : u.hp,
          maxHp: ch ? maxHp(index, ch) : u.maxHp,
          down: !!u.down,
          conditions: conds.map((c) => text(index.conditions.get(c.id)?.name) || c.id),
          token: asset(ch ? index.classes.get(ch.classId)?.token : def?.token),
          intent,
          actionsLeft: u.actionsLeft,
          done: u.done,
        };
      }),
    reinforcements: cs.waves.map((w) => ({ name: text(index.pack.enemies?.find((e) => e.id === w.enemy)?.name) || w.enemy, count: w.count, round: w.round })),
  };
}
