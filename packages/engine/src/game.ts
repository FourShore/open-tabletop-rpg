// The event-deck runner: a pure state machine. `act(index, state, action)`
// returns a new state plus the events that happened, so the same code can run
// on the server (authoritative) and in tests or a CLI.
//
// A combat card hands over to the grid fight in combat.ts until one side wins.
// Between cards, heroes can swap gear and use items or skills marked
// usableOutOfCombat; `nextScenario` carries the party on through a campaign.

import {
  characterScope,
  characterWhenContext,
  createCharacter,
  giveItem,
  levelForXp,
  maxHp,
  modifier,
  statOf,
  type ActiveCondition,
  type Character,
} from './character';
import { combatAct, CombatError, createCombat, endCombat, type CombatAction, type CombatCtx, type CombatEvent, type CombatState } from './combat';
import { evalExpr, evalInt, type Scope } from './expr';
import { applyTile, drawLevelUpTiles, type Tile } from './leveling';
import { text, type PackIndex } from './pack';
import { createRng, shuffle, type Rng } from './rng';
import type { Card, CheckSpec, CombatSpec, Effect, Targeting } from './types';
import { evalWhen, type WhenContext } from './when';
import { drawWeighted, pickWeighted } from './weighted';

export interface PlayerSpec {
  id: string;
  name: string;
  classId: string;
}

export type Prompt =
  | { kind: 'vote'; cardId: string; options: { label: string; enabled: boolean }[]; rule: 'majority' | 'leader' | 'unanimous'; votes: Record<string, number> }
  | { kind: 'chooseRoller'; check: CheckSpec; stats: string[]; branches: Branches; chooserId?: string }
  | { kind: 'combat'; cardId: string; map: string; enemies: { enemy: string; count: number; round?: number }[]; onVictory: Effect[]; onDefeat?: Effect[] }
  | { kind: 'shop'; cardId: string; stock: { itemId: string; price: number; qty: number }[] }
  | { kind: 'levelUp'; playerId: string; level: number; tiles: Tile[]; rerolls: number; freeRerolls: number; rerollCost?: number };

export interface Branches {
  onSuccess?: Effect[];
  onFailure?: Effect[];
  onCritical?: Effect[];
}

export interface GameState {
  packId: string;
  rngState: number;
  phase: 'lobby' | 'playing' | 'ended';
  result?: 'victory' | 'defeat';
  party: Character[];
  /** Campaign flags persist across scenarios; scenario flags are cleared at each start. */
  flags: string[];
  scenarioFlags: string[];
  unlocked: string[];
  scenarioId?: string;
  /** Index 0 is the top of the deck. */
  deck: string[];
  discard: string[];
  current?: string;
  pending: Prompt | null;
  cardsResolved: number;
  /** The fight in progress while the pending prompt is `combat`. */
  combat?: CombatState;
  /** `heroId:skillId` -> uses this scenario, for usesPerScenario. */
  skillUses: Record<string, number>;
  /** `heroId:skillId` used outside combat since the last card was turned. */
  usedThisCard?: string[];
}

export type GameEvent =
  | { type: 'scenarioStarted'; scenarioId: string; name: string; intro: string }
  | { type: 'cardRevealed'; cardId: string; cardType: Card['type']; title: string; text: string; image?: string }
  | { type: 'cardSkipped'; cardId: string }
  | { type: 'narrate'; text: string; image?: string }
  | { type: 'checkRolled'; playerId: string; stat: string; natural: number; total: number; dc: number; success: boolean; critical: boolean; fumble: boolean; secret: boolean }
  | { type: 'checkResolved'; success: boolean; mode: string }
  | { type: 'voteCast'; playerId: string; option: number }
  | { type: 'voteResolved'; option: number; label: string }
  | { type: 'voteSplit' }
  | { type: 'damaged'; playerId: string; amount: number; hp: number }
  | { type: 'healed'; playerId: string; amount: number; hp: number }
  | { type: 'conditionAdded'; playerId: string; condition: string; duration?: number }
  | { type: 'conditionRemoved'; playerId: string; condition: string }
  | { type: 'statChanged'; playerId: string; stat: string; amount: number }
  | { type: 'gained'; playerId: string; xp?: number; gold?: number; item?: string; skill?: string }
  | { type: 'lost'; playerId: string; gold?: number; item?: string }
  | { type: 'flagSet'; flag: string; on: boolean }
  | { type: 'deckChanged'; op: 'insert' | 'remove'; cardId: string }
  | { type: 'combatStarted'; map: string; enemies: { enemy: string; count: number }[] }
  | { type: 'combatEnded'; victory: boolean }
  | { type: 'bought'; playerId: string; itemId: string; price: number }
  | { type: 'levelUpOffered'; playerId: string; level: number; tiles: Tile[]; rerollCost?: number }
  | { type: 'tilesRerolled'; playerId: string; gold: number; tiles: Tile[]; rerollCost?: number }
  | { type: 'leveledUp'; playerId: string; level: number; tile: Tile; stat?: string }
  | { type: 'scenarioEnded'; result: 'victory' | 'defeat'; unlocked: string[] }
  | { type: 'abilityUsed'; playerId: string; name: string; targetIds: string[] }
  | { type: 'equipped'; playerId: string; itemId: string; slot: string }
  | { type: 'unequipped'; playerId: string; itemId: string; slot: string }
  | CombatEvent;

export type Action =
  | { type: 'next' }
  | { type: 'vote'; playerId: string; option: number }
  | { type: 'chooseRoller'; playerId: string; stat?: string }
  /** Ends the fight without playing it: for tests and a future game master. */
  | { type: 'resolveCombat'; victory: boolean }
  | CombatAction
  | { type: 'buy'; playerId: string; itemId: string }
  | { type: 'leaveShop' }
  | { type: 'pickTile'; playerId: string; index: number; stat?: string }
  | { type: 'rerollTiles'; playerId: string }
  | { type: 'equip'; playerId: string; itemId: string }
  | { type: 'unequip'; playerId: string; slot: string };

export interface StepResult {
  state: GameState;
  events: GameEvent[];
}

export class GameError extends Error {}

interface Ctx {
  index: PackIndex;
  s: GameState;
  rng: Rng;
  events: GameEvent[];
}

// ---------- public API ----------

export function newGame(index: PackIndex, opts: { seed: number; players: PlayerSpec[] }): GameState {
  if (!opts.players.length) throw new GameError('A game needs at least one player');
  return {
    packId: index.pack.id,
    rngState: opts.seed >>> 0,
    phase: 'lobby',
    party: opts.players.map((p) => createCharacter(index, p)),
    flags: [],
    scenarioFlags: [],
    unlocked: [...(index.pack.campaign?.startScenarios ?? [])],
    deck: [],
    discard: [],
    pending: null,
    cardsResolved: 0,
    skillUses: {},
    usedThisCard: [],
  };
}

export function startScenario(index: PackIndex, state: GameState, scenarioId: string): StepResult {
  return run(index, state, (c) => {
    const sc = index.scenarios.get(scenarioId);
    if (!sc) throw new GameError(`Unknown scenario '${scenarioId}'`);
    const s = c.s;
    Object.assign(s, { phase: 'playing', result: undefined, scenarioId, scenarioFlags: [], deck: [], discard: [], current: undefined, pending: null, combat: undefined, skillUses: {}, usedThisCard: [] });
    const ctx = partyWhen(c);
    for (const entry of sc.deck) {
      if ('card' in entry) {
        s.deck.push(entry.card);
      } else {
        const pool = (index.pools.get(entry.pool) ?? []).filter((e) => evalWhen(e.when, ctx));
        const n = evalInt(entry.draw ?? 1, partyScope(c), c.rng);
        const drawn = drawWeighted(pool, (e) => e.weight ?? 1, n, c.rng).map((e) => e.id);
        s.deck.push(...(entry.shuffle === false ? drawn : shuffle(drawn, c.rng)));
      }
    }
    c.events.push({ type: 'scenarioStarted', scenarioId, name: text(sc.name), intro: text(sc.intro) });
  });
}

export function act(index: PackIndex, state: GameState, action: Action): StepResult {
  return run(index, state, (c) => {
    const s = c.s;
    // Level-ups earned on the last card are still picked after the scenario ends, and gear can be swapped.
    const afterwards = new Set<Action['type']>(['pickTile', 'rerollTiles', 'equip', 'unequip']);
    if (s.phase !== 'playing' && !(s.phase === 'ended' && afterwards.has(action.type))) {
      throw new GameError('No scenario is running');
    }
    const p = s.pending;
    switch (action.type) {
      case 'next':
        if (p) throw new GameError(`Waiting on ${p.kind}`);
        drawNext(c);
        return;
      case 'vote':
        if (p?.kind !== 'vote') throw new GameError('No vote is open');
        return castVote(c, p, action.playerId, action.option);
      case 'chooseRoller': {
        if (p?.kind !== 'chooseRoller') throw new GameError('No check is waiting for a roller');
        const ch = player(c, action.playerId);
        if (ch.hp <= 0) throw new GameError(`${ch.name} is down and can't roll`);
        if (action.stat && !p.stats.includes(action.stat)) throw new GameError(`This check uses ${p.stats.join(' or ')}`);
        s.pending = null;
        rollAndBranch(c, p.check, p.branches, [ch], action.stat, p.chooserId);
        return finishCard(c);
      }
      case 'resolveCombat':
        if (p?.kind !== 'combat') throw new GameError('No combat is running');
        return finishCombat(c, p, action.victory);
      case 'useSkill':
      case 'useItem':
        if (p?.kind !== 'combat') return useOutOfCombat(c, action);
      // falls through
      case 'move':
      case 'revive':
      case 'endTurn': {
        if (p?.kind !== 'combat') throw new GameError('No combat is running');
        let result;
        try {
          result = combatAct(combatCtx(c), action);
        } catch (e) {
          if (e instanceof CombatError) throw new GameError(e.message);
          throw e;
        }
        if (result) finishCombat(c, p, result === 'victory');
        return;
      }
      case 'buy': {
        if (p?.kind !== 'shop') throw new GameError('No shop is open');
        const ch = player(c, action.playerId);
        const entry = p.stock.find((e) => e.itemId === action.itemId);
        if (!entry || entry.qty <= 0) throw new GameError(`'${action.itemId}' is not for sale`);
        if (ch.gold < entry.price) throw new GameError(`${ch.name} has ${ch.gold} gold, needs ${entry.price}`);
        ch.gold -= entry.price;
        entry.qty -= 1;
        giveItem(c.index, ch, entry.itemId);
        c.events.push({ type: 'bought', playerId: ch.id, itemId: entry.itemId, price: entry.price });
        return;
      }
      case 'leaveShop':
        if (p?.kind !== 'shop') throw new GameError('No shop is open');
        s.pending = null;
        return finishCard(c);
      case 'pickTile': {
        if (p?.kind !== 'levelUp' || p.playerId !== action.playerId) throw new GameError('No level-up is waiting for this player');
        const tile = p.tiles[action.index];
        if (!tile) throw new GameError(`No tile ${action.index}`);
        if (tile.kind === 'anyStat' && !(action.stat && c.index.abilityStats.includes(action.stat))) {
          throw new GameError(`Pick one of ${c.index.abilityStats.join(', ')} for the +${tile.amount} tile`);
        }
        const ch = player(c, action.playerId);
        applyTile(c.index, ch, tile, action.stat);
        s.pending = null;
        c.events.push({ type: 'leveledUp', playerId: ch.id, level: ch.level, tile, stat: action.stat });
        return offerLevelUps(c);
      }
      case 'equip':
      case 'unequip':
        if (p?.kind === 'combat') throw new GameError("Gear can't be changed mid-fight");
        return action.type === 'equip' ? equip(c, player(c, action.playerId), action.itemId) : unequip(c, player(c, action.playerId), action.slot);
      case 'rerollTiles': {
        if (p?.kind !== 'levelUp' || p.playerId !== action.playerId) throw new GameError('No level-up is waiting for this player');
        const ch = player(c, action.playerId);
        const free = p.freeRerolls > 0;
        if (!free && p.rerollCost === undefined) throw new GameError('No rerolls left');
        const price = free ? 0 : p.rerollCost!;
        if (ch.gold < price) throw new GameError(`${ch.name} has ${ch.gold} gold, needs ${price}`);
        ch.gold -= price;
        if (free) p.freeRerolls -= 1;
        else p.rerolls += 1;
        p.tiles = drawLevelUpTiles(c.index, ch, p.level, c.rng, allFlags(s), s.party.length);
        p.rerollCost = rerollCost(c, p.level, p.rerolls);
        c.events.push({ type: 'tilesRerolled', playerId: ch.id, gold: price, tiles: p.tiles, rerollCost: p.rerollCost });
        return;
      }
    }
  });
}

/** What the current prompt is waiting for, as player ids (empty = anyone may continue). */
export function waitingOn(state: GameState): string[] {
  const p = state.pending;
  if (!p) return [];
  if (p.kind === 'levelUp') return [p.playerId];
  if (p.kind === 'combat') return state.combat?.phase === 'heroes' ? state.combat.units.filter((u) => u.side === 'hero' && !u.done && !u.down).map((u) => u.id) : [];
  if (p.kind === 'vote') {
    const alive = state.party.map((ch) => ch.id);
    return p.rule === 'leader' ? [state.party[0].id] : alive.filter((id) => !(id in p.votes));
  }
  return [];
}

/**
 * Start the next scenario of a campaign with the same party. What carries over
 * follows the pack's `campaign.persistBetweenScenarios`; anything not listed
 * goes back to how a new hero of that class starts. Flags and unlocks always carry.
 */
export function nextScenario(index: PackIndex, state: GameState, scenarioId: string): StepResult {
  if (state.phase === 'playing' || state.pending) throw new GameError('Finish the scenario first');
  const keep = new Set(index.pack.campaign?.persistBetweenScenarios ?? ['items', 'gold', 'xp']);
  const s = structuredClone(state);
  s.party = s.party.map((ch) => {
    const fresh = createCharacter(index, { id: ch.id, name: ch.name, classId: ch.classId });
    const next: Character = keep.has('xp') ? ch : { ...fresh };
    if (!keep.has('items')) Object.assign(next, { equipment: fresh.equipment, inventory: fresh.inventory });
    else Object.assign(next, { equipment: ch.equipment, inventory: ch.inventory });
    next.gold = keep.has('gold') ? ch.gold : fresh.gold;
    next.conditions = keep.has('conditions') ? ch.conditions : [];
    next.hp = keep.has('hp') ? Math.min(ch.hp, maxHp(index, next)) : maxHp(index, next);
    return next;
  });
  return startScenario(index, s, scenarioId);
}

/** Something a hero can use between cards: an item in their pack or a skill marked usableOutOfCombat. */
export interface HeroUse {
  kind: 'item' | 'skill';
  id: string;
  name: string;
  description?: string;
  /** 'self' and 'party' need no aim; 'ally' needs a hero picked. */
  aim: 'self' | 'ally' | 'party';
  /** Why it can't be used right now. */
  blocked?: string;
}

/** What a hero could use outside a fight. Empty in combat, which has its own options. */
export function heroUses(index: PackIndex, state: GameState, heroId: string): HeroUse[] {
  const ch = state.party.find((p) => p.id === heroId);
  if (!ch || state.combat) return [];
  const open = state.phase === 'playing' && (!state.pending || state.pending.kind === 'shop');
  const why = (extra?: string) => (!open ? 'Not right now' : ch.hp <= 0 ? `${ch.name} is down` : extra);
  const out: HeroUse[] = [];
  for (const id of new Set(ch.inventory)) {
    const item = index.items.get(id);
    const aim = item?.use?.effects?.length ? aimOf(item.use.targeting) : undefined;
    if (!item || !aim) continue;
    out.push({ kind: 'item', id, name: text(item.name) || id, description: text(item.description) || undefined, aim, blocked: why() });
  }
  const granted = Object.values(ch.equipment).flatMap((id) => index.items.get(id)?.grantsSkills ?? []);
  for (const id of new Set([...ch.skills, ...granted])) {
    const skill = index.skills.get(id);
    const aim = skill?.usableOutOfCombat && skill.effects?.length ? aimOf(skill.targeting) : undefined;
    if (!skill || !aim) continue;
    const used = (state.skillUses[`${ch.id}:${id}`] ?? 0) >= (skill.usesPerScenario ?? Infinity);
    const again = state.usedThisCard?.includes(`${ch.id}:${id}`);
    out.push({
      kind: 'skill',
      id,
      name: text(skill.name) || id,
      description: text(skill.description) || undefined,
      aim,
      blocked: why(used ? 'Used up this scenario' : again ? 'Once per card' : undefined),
    });
  }
  return out;
}

function aimOf(t: Targeting | undefined): HeroUse['aim'] | undefined {
  switch (t?.target ?? 'self') {
    case 'self':
      return 'self';
    case 'ally':
    case 'any':
      return 'ally';
    case 'allAllies':
      return 'party';
    default:
      return undefined;
  }
}

function useOutOfCombat(c: Ctx, action: Extract<Action, { type: 'useItem' | 'useSkill' }>): void {
  const { s, index } = c;
  const ch = player(c, action.playerId);
  const id = action.type === 'useItem' ? action.itemId : action.skillId;
  const use = heroUses(index, s, ch.id).find((u) => u.kind === (action.type === 'useItem' ? 'item' : 'skill') && u.id === id);
  if (!use) throw new GameError(`${ch.name} can't use that outside a fight`);
  if (use.blocked) throw new GameError(use.blocked);
  const targets = use.aim === 'party' ? s.party : use.aim === 'self' ? [ch] : [player(c, action.targetId ?? ch.id)];
  const effects = action.type === 'useItem' ? index.items.get(id)!.use!.effects! : index.skills.get(id)!.effects!;
  if (action.type === 'useItem') ch.inventory.splice(ch.inventory.indexOf(id), 1);
  else {
    (s.usedThisCard ??= []).push(`${ch.id}:${id}`);
    if (index.skills.get(id)!.usesPerScenario) s.skillUses[`${ch.id}:${id}`] = (s.skillUses[`${ch.id}:${id}`] ?? 0) + 1;
  }
  c.events.push({ type: 'abilityUsed', playerId: ch.id, name: use.name, targetIds: targets.map((t) => t.id) });
  applyEffects(c, effects, { chooser: ch, rollers: targets, source: ch });
}

function equip(c: Ctx, ch: Character, itemId: string): void {
  const item = c.index.items.get(itemId);
  if (!ch.inventory.includes(itemId) || item?.kind !== 'equipment' || !item.slot) throw new GameError(`${ch.name} has no ${text(item?.name) || itemId} to equip`);
  if (item.classes && !item.classes.includes(ch.classId)) throw new GameError(`A ${text(c.index.classes.get(ch.classId)?.name)} can't use ${text(item.name)}`);
  ch.inventory.splice(ch.inventory.indexOf(itemId), 1);
  const old = ch.equipment[item.slot];
  if (old) {
    ch.inventory.push(old);
    c.events.push({ type: 'unequipped', playerId: ch.id, itemId: old, slot: item.slot });
  }
  ch.equipment[item.slot] = itemId;
  ch.hp = Math.min(ch.hp, maxHp(c.index, ch));
  c.events.push({ type: 'equipped', playerId: ch.id, itemId, slot: item.slot });
}

function unequip(c: Ctx, ch: Character, slot: string): void {
  const itemId = ch.equipment[slot];
  if (!itemId) throw new GameError(`${ch.name} has nothing in that slot`);
  delete ch.equipment[slot];
  ch.inventory.push(itemId);
  ch.hp = Math.min(ch.hp, maxHp(c.index, ch));
  c.events.push({ type: 'unequipped', playerId: ch.id, itemId, slot });
}

// ---------- engine internals ----------

function run(index: PackIndex, state: GameState, body: (c: Ctx) => void): StepResult {
  const s = structuredClone(state);
  const rng = createRng(s.rngState);
  const c: Ctx = { index, s, rng, events: [] };
  body(c);
  s.rngState = rng.state;
  return { state: s, events: c.events };
}

function player(c: Ctx, id: string): Character {
  const ch = c.s.party.find((p) => p.id === id);
  if (!ch) throw new GameError(`Unknown player '${id}'`);
  return ch;
}

const allFlags = (s: GameState) => new Set([...s.flags, ...s.scenarioFlags]);

function partyLevel(s: GameState): number {
  return Math.floor(s.party.reduce((sum, ch) => sum + ch.level, 0) / s.party.length);
}

function partyWhen(c: Ctx): WhenContext {
  return { flags: allFlags(c.s), partySize: c.s.party.length, level: partyLevel(c.s), rng: c.rng };
}

function partyScope(c: Ctx): Scope {
  const { index, s } = c;
  return {
    partySize: s.party.length,
    partyLevel: partyLevel(s),
    partyCha: Math.max(...s.party.map((ch) => statOf(index, ch, 'cha'))),
  };
}

function targetScope(c: Ctx, ch: Character): Scope {
  return characterScope(c.index, ch, { ...partyScope(c), maxHp: maxHp(c.index, ch), hp: ch.hp });
}

function drawNext(c: Ctx): void {
  const { s, index } = c;
  s.usedThisCard = [];
  for (;;) {
    const id = s.deck.shift();
    if (id === undefined) {
      const sc = index.scenarios.get(s.scenarioId!)!;
      applyEffects(c, sc.onDeckEmpty ?? [{ type: 'endScenario', result: 'victory' }], {});
      return;
    }
    const card = index.cards.get(id);
    if (!card) throw new GameError(`Deck holds unknown card '${id}'`);
    if (!evalWhen(card.requires, partyWhen(c))) {
      s.discard.push(id);
      c.events.push({ type: 'cardSkipped', cardId: id });
      continue;
    }
    s.current = id;
    c.events.push({ type: 'cardRevealed', cardId: id, cardType: card.type, title: text(card.title), text: text(card.text), image: card.image });
    return resolveCard(c, card);
  }
}

function resolveCard(c: Ctx, card: Card): void {
  const { s, index } = c;
  switch (card.type) {
    case 'story':
    case 'rest':
      applyEffects(c, card.outcomes ?? [], {});
      return finishCard(c);
    case 'check':
      if (runCheck(c, card.check!, card)) finishCard(c);
      return;
    case 'choice': {
      const ctx = partyWhen(c);
      s.pending = {
        kind: 'vote',
        cardId: card.id,
        rule: card.vote ?? 'majority',
        votes: {},
        options: (card.options ?? []).map((o) => ({ label: text(o.label), enabled: evalWhen(o.requires, ctx) })),
      };
      return;
    }
    case 'combat':
      return startCombat(c, card.combat!, card.onVictory ?? [], card.onDefeat);
    case 'shop': {
      const scope = partyScope(c);
      const mod = card.priceModifier === undefined ? 1 : evalExpr(card.priceModifier, scope).value;
      const ctx = partyWhen(c);
      const stock = (card.stock ?? [])
        .filter((e) => evalWhen(e.when, ctx))
        // A weight under 1 is the chance the item is in stock today.
        .filter((e) => (e.weight ?? 1) >= 1 || c.rng.next() < (e.weight ?? 1))
        .map((e) => ({
          itemId: e.id,
          price: Math.max(0, Math.round((index.items.get(e.id)?.price ?? 0) * mod)),
          qty: evalInt(e.count ?? 1, scope, c.rng),
        }));
      s.pending = { kind: 'shop', cardId: card.id, stock };
      return;
    }
  }
}

function startCombat(c: Ctx, spec: CombatSpec, onVictory: Effect[], onDefeat?: Effect[]): void {
  const cardId = c.s.current ?? '';
  c.s.pending = { kind: 'combat', cardId, map: spec.map, enemies: [], onVictory, onDefeat };
  const cs = createCombat(combatCtx(c), cardId, spec);
  const counts = new Map<string, number>();
  for (const u of cs.units) if (u.enemyId) counts.set(u.enemyId, (counts.get(u.enemyId) ?? 0) + 1);
  for (const w of cs.waves) counts.set(w.enemy, (counts.get(w.enemy) ?? 0) + w.count);
  const enemies = [...counts].map(([enemy, count]) => ({ enemy, count }));
  c.s.pending.enemies = enemies;
  // Spawn events come before this in the log, so announce the fight first.
  const at = c.events.findIndex((e) => e.type === 'roundStarted' || e.type === 'unitSpawned');
  c.events.splice(at < 0 ? c.events.length : at, 0, { type: 'combatStarted', map: spec.map, enemies });
}

function combatCtx(c: Ctx): CombatCtx {
  return {
    index: c.index,
    s: c.s,
    rng: c.rng,
    events: c.events,
    reward: (heroId, xp, loot) => {
      const ch = player(c, heroId);
      if (xp) {
        ch.xp += xp;
        c.events.push({ type: 'gained', playerId: ch.id, xp });
      }
      if (loot) rollLoot(c, loot, ch);
    },
  };
}

function finishCombat(c: Ctx, p: Extract<Prompt, { kind: 'combat' }>, victory: boolean): void {
  const s = c.s;
  s.pending = null;
  endCombat(combatCtx(c));
  c.events.push({ type: 'combatEnded', victory });
  if (victory) {
    // Downed heroes get back up after a won fight.
    for (const ch of s.party) if (ch.hp <= 0) ch.hp = 1;
    applyEffects(c, p.onVictory, {});
  } else {
    applyEffects(c, p.onDefeat ?? [{ type: 'endScenario', result: 'defeat' }], {});
  }
  finishCard(c);
}

/** Close out the current card, then offer any level-ups. */
function finishCard(c: Ctx): void {
  const { s, index } = c;
  if (s.pending) return;
  if (s.current) {
    s.discard.push(s.current);
    s.current = undefined;
    s.cardsResolved += 1;
    // Out of combat, condition durations count cards.
    for (const ch of s.party) {
      const ticking = (x: ActiveCondition) => x.per !== 'round' && x.remaining !== undefined;
      for (const cond of ch.conditions) if (ticking(cond)) cond.remaining! -= 1;
      const expired = ch.conditions.filter((x) => ticking(x) && x.remaining! <= 0);
      for (const cond of expired) c.events.push({ type: 'conditionRemoved', playerId: ch.id, condition: cond.id });
      ch.conditions = ch.conditions.filter((x) => !expired.includes(x));
      ch.hp = Math.min(ch.hp, maxHp(index, ch));
    }
  }
  if (s.phase === 'playing' && s.party.every((ch) => ch.hp <= 0)) endScenario(c, 'defeat', []);
  offerLevelUps(c);
}

function offerLevelUps(c: Ctx): void {
  const { s, index } = c;
  if (s.pending) return;
  const maxLevel = index.pack.rules?.leveling?.maxLevel ?? 20;
  const ch = s.party.find((p) => p.level < maxLevel && levelForXp(index, p.xp) > p.level);
  if (!ch) return;
  const level = ch.level + 1;
  const tiles = drawLevelUpTiles(index, ch, level, c.rng, allFlags(s), s.party.length);
  const cost = rerollCost(c, level, 0);
  const freeRerolls = index.pack.rules?.leveling?.rerollsPerLevel ?? 0;
  s.pending = { kind: 'levelUp', playerId: ch.id, level, tiles, rerolls: 0, freeRerolls, rerollCost: cost };
  c.events.push({ type: 'levelUpOffered', playerId: ch.id, level, tiles, rerollCost: cost });
}

/** Gold for the next paid reroll, or undefined when paid rerolls are off or used up. */
function rerollCost(c: Ctx, level: number, rerolls: number): number | undefined {
  const r = c.index.pack.rules?.leveling?.reroll;
  if (!r || (r.max !== undefined && rerolls >= r.max)) return undefined;
  return Math.max(0, evalInt(r.cost, { level, rerolls }));
}

function endScenario(c: Ctx, result: 'victory' | 'defeat', unlock: string[]): void {
  const s = c.s;
  s.phase = 'ended';
  s.result = result;
  s.pending = null;
  for (const id of unlock) if (!s.unlocked.includes(id)) s.unlocked.push(id);
  c.events.push({ type: 'scenarioEnded', result, unlocked: unlock });
}

// ---------- votes ----------

function castVote(c: Ctx, p: Extract<Prompt, { kind: 'vote' }>, playerId: string, option: number): void {
  const s = c.s;
  const ch = player(c, playerId);
  const opt = p.options[option];
  if (!opt) throw new GameError(`No option ${option}`);
  if (!opt.enabled) throw new GameError(`'${opt.label}' isn't available`);
  p.votes[ch.id] = option;
  c.events.push({ type: 'voteCast', playerId: ch.id, option });

  let winner: number | undefined;
  if (p.rule === 'leader') {
    if (ch.id === s.party[0].id) winner = option;
  } else if (s.party.every((m) => m.id in p.votes)) {
    const tally = new Map<number, number>();
    for (const v of Object.values(p.votes)) tally.set(v, (tally.get(v) ?? 0) + 1);
    if (p.rule === 'unanimous' && tally.size > 1) {
      p.votes = {};
      c.events.push({ type: 'voteSplit' });
      return;
    }
    // Most votes wins; ties go to the earlier option.
    winner = [...tally.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
  }
  if (winner === undefined) return;

  s.pending = null;
  const card = c.index.cards.get(p.cardId)!;
  const choice = card.options![winner];
  c.events.push({ type: 'voteResolved', option: winner, label: text(choice.label) });
  // "chosen" effects land on the first player who voted for the winning option.
  const chooserId = Object.entries(p.votes).find(([, v]) => v === winner)?.[0];
  const chooser = chooserId ? player(c, chooserId) : s.party[0];
  applyEffects(c, choice.outcomes ?? [], { chooser });
  if (choice.check && s.phase === 'playing' && !runCheck(c, choice.check, choice, chooser.id)) return;
  finishCard(c);
}

// ---------- checks ----------

/** Resolve a check now, or open a chooseRoller prompt. Returns true if it resolved. */
function runCheck(c: Ctx, check: CheckSpec, branches: Branches, chooserId?: string, interactive = true): boolean {
  const { s, index } = c;
  const mode = check.mode ?? 'individual';
  const stats = Array.isArray(check.stat) ? check.stat : [check.stat];
  const alive = s.party.filter((ch) => ch.hp > 0);
  if (!alive.length) return true;

  if (mode === 'each' || mode === 'group') {
    rollAndBranch(c, check, branches, alive, undefined, chooserId);
    return true;
  }
  const who = check.who ?? 'volunteer';
  if (who === 'volunteer' && interactive && alive.length > 1) {
    s.pending = { kind: 'chooseRoller', check, stats, branches, chooserId };
    return false;
  }
  let roller: Character;
  if (who === 'random') roller = alive[c.rng.int(alive.length)];
  else if (who === 'leader') roller = alive[0];
  else roller = alive.reduce((best, ch) => (bestStat(index, ch, stats) > bestStat(index, best, stats) ? ch : best));
  rollAndBranch(c, check, branches, [roller], undefined, chooserId);
  return true;
}

function bestStat(index: PackIndex, ch: Character, stats: string[]): number {
  return Math.max(...stats.map((k) => statOf(index, ch, k)));
}

function rollAndBranch(c: Ctx, check: CheckSpec, branches: Branches, rollers: Character[], stat: string | undefined, chooserId?: string): void {
  const { s, index } = c;
  const mode = check.mode ?? 'individual';
  const dc = evalInt(check.dc, partyScope(c), c.rng);
  const helpers = mode === 'best' && (check.allowHelp ?? true) ? s.party.filter((ch) => ch.hp > 0 && !rollers.includes(ch)).length : 0;
  const help = helpers > 0 ? (index.pack.rules?.helpBonus ?? 2) : 0;
  const chooser = chooserId ? player(c, chooserId) : undefined;

  const results = rollers.map((ch) => ({ ch, ...rollCheck(c, ch, check, dc, stat, help) }));

  if (mode === 'each') {
    for (const r of results) applyEffects(c, pickBranch(branches, r.success, r.critical), { rollers: [r.ch], chooser });
    c.events.push({ type: 'checkResolved', success: results.every((r) => r.success), mode });
    return;
  }
  let success: boolean;
  let critical = false;
  if (mode === 'group') {
    const threshold = check.threshold ?? index.pack.rules?.groupCheckThreshold ?? 0.5;
    success = results.filter((r) => r.success).length / results.length >= threshold;
  } else {
    success = results[0].success;
    critical = results[0].critical;
  }
  c.events.push({ type: 'checkResolved', success, mode });
  applyEffects(c, pickBranch(branches, success, critical), { rollers, chooser });
}

function pickBranch(b: Branches, success: boolean, critical: boolean): Effect[] {
  if (critical && b.onCritical) return b.onCritical;
  return (success ? b.onSuccess : b.onFailure) ?? [];
}

function rollCheck(c: Ctx, ch: Character, check: CheckSpec, dc: number, stat: string | undefined, help: number) {
  const { index } = c;
  const stats = Array.isArray(check.stat) ? check.stat : [check.stat];
  const used = stat ?? stats.reduce((best, k) => (statOf(index, ch, k) > statOf(index, ch, best) ? k : best));
  const dice = index.pack.rules?.dice ?? {};
  const roll = evalExpr(dice.check ?? 'd20', {}, c.rng);
  const natural = roll.rolls[0]?.value ?? roll.value;
  let bonus = statOf(index, ch, used) + help + modifier(index, ch, 'checks');
  for (const skillId of ch.skills) {
    const s = index.skills.get(skillId);
    if (!s?.passive || !s.checkBonus) continue;
    for (const key of [used, ...(check.tags ?? [])]) bonus += s.checkBonus[key] ?? 0;
  }
  const total = roll.value + bonus;
  const critical = natural >= (dice.critOn ?? 20);
  const fumble = natural <= (dice.fumbleOn ?? 1);
  const success = critical || (!fumble && total >= dc);
  c.events.push({ type: 'checkRolled', playerId: ch.id, stat: used, natural, total, dc, success, critical, fumble, secret: check.secret ?? false });
  return { success, critical };
}

// ---------- effects ----------

interface EffectCtx {
  rollers?: Character[];
  chooser?: Character;
  /** Whose stats amounts use, for a hero's skill or item. Defaults to each target. */
  source?: Character;
}

function amountScope(c: Ctx, ch: Character, ec: EffectCtx): Scope {
  return ec.source ? { ...targetScope(c, ec.source), maxHp: maxHp(c.index, ch), hp: ch.hp } : targetScope(c, ch);
}

function targetsOf(c: Ctx, e: Effect, ec: EffectCtx): Character[] {
  const party = c.s.party;
  switch (e.target ?? 'targets') {
    case 'party':
    case 'allEnemies':
    case 'adjacent':
      return party;
    case 'roller':
      return ec.rollers ?? [ec.chooser ?? party[0]];
    case 'chosen':
    case 'self':
      return [ec.chooser ?? ec.rollers?.[0] ?? party[0]];
    case 'random':
      return [party[c.rng.int(party.length)]];
    case 'targets':
      return ec.rollers ?? (ec.chooser ? [ec.chooser] : party);
  }
}

function applyEffects(c: Ctx, effects: Effect[], ec: EffectCtx): void {
  for (const e of effects) {
    if (c.s.phase !== 'playing') return;
    if (!evalWhen(e.when, partyWhen(c))) continue;
    applyEffect(c, e, ec);
  }
}

function applyEffect(c: Ctx, e: Effect, ec: EffectCtx): void {
  const { s, index } = c;
  const flagList = () => (e.scope === 'scenario' ? s.scenarioFlags : s.flags);
  switch (e.type) {
    case 'damage':
      for (const ch of targetsOf(c, e, ec)) {
        const amount = Math.max(0, evalInt(e.amount ?? 0, amountScope(c, ch, ec), c.rng));
        ch.hp = Math.max(0, ch.hp - amount);
        c.events.push({ type: 'damaged', playerId: ch.id, amount, hp: ch.hp });
      }
      return;
    case 'heal':
      for (const ch of targetsOf(c, e, ec)) {
        const max = maxHp(index, ch);
        const amount = Math.max(0, Math.min(max - ch.hp, evalInt(e.amount ?? 0, amountScope(c, ch, ec), c.rng)));
        ch.hp += amount;
        c.events.push({ type: 'healed', playerId: ch.id, amount, hp: ch.hp });
      }
      return;
    case 'condition':
      for (const ch of targetsOf(c, e, ec)) {
        const def = index.conditions.get(e.condition!);
        const existing = ch.conditions.find((x) => x.id === e.condition);
        if (existing && def?.stacking === 'ignore') continue;
        if (existing && def?.stacking !== 'stack') existing.remaining = e.duration;
        else ch.conditions.push({ id: e.condition!, remaining: e.duration });
        c.events.push({ type: 'conditionAdded', playerId: ch.id, condition: e.condition!, duration: e.duration });
      }
      return;
    case 'removeCondition':
      for (const ch of targetsOf(c, e, ec)) {
        if (!ch.conditions.some((x) => x.id === e.condition)) continue;
        ch.conditions = ch.conditions.filter((x) => x.id !== e.condition);
        c.events.push({ type: 'conditionRemoved', playerId: ch.id, condition: e.condition! });
      }
      return;
    case 'modifyStat':
      // Timed stat changes only exist in combat; out of combat they are permanent.
      for (const ch of targetsOf(c, e, ec)) {
        const amount = evalInt(e.amount ?? 0, targetScope(c, ch), c.rng);
        if (e.stat === 'hp') ch.hpBonus += amount;
        else ch.stats[e.stat!] = (ch.stats[e.stat!] ?? 0) + amount;
        c.events.push({ type: 'statChanged', playerId: ch.id, stat: e.stat!, amount });
      }
      return;
    case 'grant':
    case 'take':
      return grantOrTake(c, e, targetsOf(c, e, ec));
    case 'setFlag':
    case 'clearFlag': {
      const list = flagList();
      const at = list.indexOf(e.flag!);
      if (e.type === 'setFlag' && at < 0) list.push(e.flag!);
      if (e.type === 'clearFlag' && at >= 0) list.splice(at, 1);
      c.events.push({ type: 'flagSet', flag: e.flag!, on: e.type === 'setFlag' });
      return;
    }
    case 'insertCard':
    case 'goto':
    case 'shuffleIn': {
      const pos = e.type === 'shuffleIn' ? 'random' : e.type === 'goto' ? 'top' : (e.position ?? 'top');
      const at = pos === 'top' ? 0 : pos === 'bottom' ? s.deck.length : c.rng.int(s.deck.length + 1);
      s.deck.splice(at, 0, e.card!);
      c.events.push({ type: 'deckChanged', op: 'insert', cardId: e.card! });
      return;
    }
    case 'removeCard':
      if (s.deck.includes(e.card!)) {
        s.deck = s.deck.filter((id) => id !== e.card);
        c.events.push({ type: 'deckChanged', op: 'remove', cardId: e.card! });
      }
      return;
    case 'startCombat':
      return startCombat(c, e.combat!, [], undefined);
    case 'startCheck':
      runCheck(c, e.check!, { onSuccess: [], onFailure: [] }, ec.chooser?.id, false);
      return;
    case 'endScenario':
      return endScenario(c, e.result!, e.unlock ?? []);
    case 'narrate':
      c.events.push({ type: 'narrate', text: text(e.text), image: e.image });
      return;
    case 'random': {
      const pick = pickWeighted(e.options ?? [], (o) => o.weight ?? 1, c.rng);
      if (pick) applyEffects(c, pick.effects, ec);
      return;
    }
    case 'resetCooldowns':
      // In combat, cooldowns reset with the fight; out of it, so do once-per-card skills.
      s.usedThisCard = (s.usedThisCard ?? []).filter((k) => !targetsOf(c, e, ec).some((ch) => k.startsWith(`${ch.id}:`)));
      return;
    default:
      // Movement and summons need the grid (milestone 3).
      return;
  }
}

function grantOrTake(c: Ctx, e: Effect, targets: Character[]): void {
  const { index } = c;
  const scope = partyScope(c);
  const split = e.split ?? 'each';
  const share = (expr: number | string | undefined) => {
    if (expr === undefined) return 0;
    const total = evalInt(expr, scope, c.rng);
    return split === 'shared' ? Math.floor(total / targets.length) : total;
  };
  const xp = share(e.xp);
  const gold = share(e.gold);
  for (const ch of targets) {
    if (e.type === 'take') {
      const lostGold = Math.min(ch.gold, gold);
      ch.gold -= lostGold;
      if (e.item) {
        const at = ch.inventory.indexOf(e.item);
        if (at >= 0) ch.inventory.splice(at, 1);
        for (const [slot, id] of Object.entries(ch.equipment)) if (id === e.item && at < 0) delete ch.equipment[slot];
      }
      if (lostGold || e.item) c.events.push({ type: 'lost', playerId: ch.id, gold: lostGold || undefined, item: e.item });
      continue;
    }
    ch.xp += xp;
    ch.gold += gold;
    if (e.skill && !ch.skills.includes(e.skill)) ch.skills.push(e.skill);
    if (xp || gold || e.skill) c.events.push({ type: 'gained', playerId: ch.id, xp: xp || undefined, gold: gold || undefined, skill: e.skill });
  }
  // Items and loot go to one character: the first target.
  if (e.type === 'grant' && targets.length) {
    const ch = targets[0];
    if (e.item) {
      giveItem(index, ch, e.item);
      c.events.push({ type: 'gained', playerId: ch.id, item: e.item });
    }
    if (e.loot) rollLoot(c, e.loot, ch);
  }
}

function rollLoot(c: Ctx, tableId: string, ch: Character): void {
  const table = c.index.loot.get(tableId);
  if (!table) return;
  const scope = partyScope(c);
  const ctx = characterWhenContext(c.index, ch, { flags: allFlags(c.s), partySize: c.s.party.length, rng: c.rng });
  const entries = table.entries.filter((en) => evalWhen(en.when, ctx));
  const rolls = evalInt(table.rolls ?? 1, scope, c.rng);
  const picks = table.unique === false
    ? Array.from({ length: rolls }, () => pickWeighted(entries, (en) => en.weight ?? 1, c.rng)).filter((x) => x !== undefined)
    : drawWeighted(entries, (en) => en.weight ?? 1, rolls, c.rng);
  for (const en of picks) {
    const n = evalInt(en.count ?? 1, scope, c.rng);
    if (en.id === 'gold') ch.gold += n;
    else if (en.id === 'xp') ch.xp += n;
    else for (let i = 0; i < n; i++) giveItem(c.index, ch, en.id);
    c.events.push({ type: 'gained', playerId: ch.id, ...(en.id === 'gold' ? { gold: n } : en.id === 'xp' ? { xp: n } : { item: en.id }) });
  }
}
