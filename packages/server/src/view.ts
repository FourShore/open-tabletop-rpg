// What the server sends to each device. The screen gets the public view; a
// phone gets the same plus which heroes it controls and its own secret rolls.
// The web client imports these types, so keep them plain JSON.

import { describeTile, maxHp, statOf, text, xpForLevel, type Character, type PackIndex, type Prompt } from '@otrpg/engine';

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
  /** Phones and screens currently connected. */
  devices: { controllers: number; screens: number };
}

export interface ControllerView extends PublicView {
  role: 'controller';
  /** Heroes this phone controls. It may also act for heroes whose phone is offline. */
  mine: string[];
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
