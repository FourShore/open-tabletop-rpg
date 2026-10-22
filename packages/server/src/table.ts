// One table: the seats, the lobby, and the running game. This is plain logic
// with no networking, so it is unit-tested directly; room.ts wires it to
// Colyseus.
//
// Each device holds a random token (kept in the browser's localStorage), so a
// phone that reloads or drops off wifi gets its seat and heroes back.
//
// A table runs a campaign: when a scenario ends the party is kept, and the next
// start carries it on. A save file holds that campaign, so a group can pick it
// up on another day or another server.

import {
  act,
  createCharacter,
  describeEvent,
  GameError,
  heroCombatOptions,
  heroUses,
  newGame,
  nextScenario,
  startScenario,
  text,
  waitingOn,
  type Action,
  type Character,
  type GameEvent,
  type GameState,
  type PackIndex,
} from '@otrpg/engine';
import { readSave, writeSave, type CampaignSave } from './save';
import { combatView, heroView, promptView, type LogLine, type View } from './view';

import { MAX_HEROES } from './limits';

export { MAX_HEROES };
const LOG_LIMIT = 100;

export class TableError extends Error {}

type Role = 'screen' | 'controller';

interface Seat {
  token: string;
  role: Role;
  /** Open connections; a phone can be open in two tabs. */
  connections: number;
}

interface LobbyHero {
  id: string;
  name: string;
  classId: string;
  /** Token of the phone that plays this hero; empty for a hero loaded from a save and not yet claimed. */
  owner: string;
}

interface LogEntry extends LogLine {
  /** Set for secret rolls: the hero whose phone may see `secretText`. */
  heroId?: string;
  secretText?: string;
}

export interface TableOptions {
  code: string;
  seed?: number;
  /** Absolute base URL for the pack's assets. Without it they are served from /pack. */
  assetBase?: string;
}

/** Actions any phone may send: they move the table along without speaking for a hero. */
const SHARED_ACTIONS = new Set<Action['type']>(['next', 'leaveShop']);
const HERO_ACTIONS = new Set<Action['type']>([
  'vote',
  'chooseRoller',
  'buy',
  'pickTile',
  'rerollTiles',
  'move',
  'useSkill',
  'useItem',
  'revive',
  'endTurn',
  'equip',
  'unequip',
]);

export class Table {
  readonly code: string;
  private seats = new Map<string, Seat>();
  private heroes: LobbyHero[] = [];
  private nextHero = 1;
  private state: GameState | null = null;
  /** The campaign as it stood when the last scenario ended (or a save was loaded). */
  private campaign: GameState | null = null;
  private scenarioId: string;
  private log: LogEntry[] = [];
  /** Combat unit names, so a fight's last lines still name the fallen. */
  private names = new Map<string, string>();
  /** The last card turned over. It stays on screen after it resolves, until the next one. */
  private shownCard?: string;
  private nextLog = 1;
  private seed: number;
  private assetBase?: string;

  constructor(
    readonly index: PackIndex,
    opts: TableOptions,
  ) {
    this.code = opts.code;
    this.seed = opts.seed ?? (Math.random() * 2 ** 32) >>> 0;
    this.assetBase = opts.assetBase;
    this.scenarioId = this.scenarios()[0]?.id ?? '';
  }

  get phase(): 'lobby' | 'playing' | 'ended' {
    return this.state?.phase === 'ended' && !this.state.pending ? 'ended' : this.state ? 'playing' : 'lobby';
  }

  // ---------- seats ----------

  connect(token: string, role: Role): void {
    if (!token || typeof token !== 'string' || token.length > 100) throw new TableError('Missing device token');
    const seat = this.seats.get(token);
    if (seat) {
      // A token keeps its first role, so a phone can't rejoin as a screen and lose its heroes.
      seat.connections += 1;
    } else {
      this.seats.set(token, { token, role, connections: 1 });
    }
  }

  disconnect(token: string): void {
    const seat = this.seats.get(token);
    if (seat) seat.connections = Math.max(0, seat.connections - 1);
  }

  roleOf(token: string): Role | undefined {
    return this.seats.get(token)?.role;
  }

  /** True when no device is connected, so the room can be cleaned up. */
  get empty(): boolean {
    return [...this.seats.values()].every((s) => s.connections === 0);
  }

  // ---------- lobby ----------

  addHero(token: string, name: unknown, classId: unknown): string {
    this.controller(token);
    if (this.state) throw new TableError('The game has started');
    if (this.heroes.length >= MAX_HEROES) throw new TableError(`The party is full (${MAX_HEROES} heroes)`);
    const clean = typeof name === 'string' ? name.trim().slice(0, 24) : '';
    if (!clean) throw new TableError('Give your hero a name');
    if (typeof classId !== 'string' || !this.index.classes.has(classId)) throw new TableError('Pick a class');
    if (this.heroes.some((h) => h.name.toLowerCase() === clean.toLowerCase())) throw new TableError(`There is already a hero called ${clean}`);
    const id = `h${this.nextHero++}`;
    this.heroes.push({ id, name: clean, classId, owner: token });
    return id;
  }

  /** Take over a hero nobody is playing: one loaded from a save, or one whose phone has gone. */
  claimHero(token: string, heroId: unknown): void {
    this.controller(token);
    const hero = this.heroes.find((h) => h.id === heroId);
    if (!hero) throw new TableError('No such hero');
    if (hero.owner === token) return;
    if (hero.owner && this.seats.get(hero.owner)?.connections) throw new TableError(`${hero.name} is already being played`);
    hero.owner = token;
  }

  removeHero(token: string, heroId: unknown): void {
    this.controller(token);
    if (this.state) throw new TableError('The game has started');
    const at = this.heroes.findIndex((h) => h.id === heroId && h.owner === token);
    if (at < 0) throw new TableError('That hero is not yours');
    this.heroes.splice(at, 1);
  }

  chooseScenario(token: string, scenarioId: unknown): void {
    this.controller(token);
    if (this.phase === 'playing') throw new TableError('A scenario is running');
    if (!this.scenarios().some((s) => s.id === scenarioId)) throw new TableError('Unknown scenario');
    this.scenarioId = scenarioId as string;
  }

  /**
   * Start the chosen scenario. On a campaign the party carries on from the last
   * scenario (as the pack's rules allow); heroes who joined since start fresh.
   */
  start(token: string): void {
    this.controller(token);
    if (this.phase === 'playing') throw new TableError('A scenario is running');
    if (!this.heroes.length) throw new TableError('Add at least one hero first');
    const players = this.heroes.map(({ id, name, classId }) => ({ id, name, classId }));
    this.log = [];
    const base = this.campaign;
    const r = base
      ? nextScenario(this.index, { ...base, party: this.lobbyParty() }, this.scenarioId)
      : startScenario(this.index, newGame(this.index, { seed: this.seed, players }), this.scenarioId);
    this.apply(r.state, r.events);
  }

  /** Back to the lobby with the same heroes, so players can join, leave or change class. */
  toLobby(token: string): void {
    this.controller(token);
    if (this.phase !== 'ended') throw new TableError('Finish the scenario first');
    this.state = null;
    this.shownCard = undefined;
    this.log = [];
  }

  /** Drop the campaign's progress: the heroes in the lobby start again from scratch. */
  newCampaign(token: string): void {
    this.controller(token);
    if (this.phase !== 'lobby') throw new TableError('Go back to the lobby first');
    this.campaign = null;
    this.seed = (this.seed + 0x9e3779b9) >>> 0;
    this.scenarioId = this.scenarios()[0]?.id ?? '';
  }

  // ---------- saves ----------

  /** The campaign so far, or undefined before any scenario has ended. */
  save(): CampaignSave | undefined {
    if (!this.campaign) return undefined;
    return writeSave(this.index, { ...this.campaign, party: this.lobbyParty() }, this.scenarioId);
  }

  /** Replace the lobby with a saved campaign. Its heroes wait for phones to claim them. */
  loadSave(token: string, data: unknown): void {
    if (!this.seats.has(token)) throw new TableError('Missing device token');
    if (this.phase !== 'lobby') throw new TableError('Load a save from the lobby');
    let loaded;
    try {
      loaded = readSave(this.index, data);
    } catch (e) {
      throw new TableError(e instanceof Error ? e.message : 'That save could not be read');
    }
    const ids = new Map<string, string>();
    const party: Character[] = loaded.party.map((ch) => {
      const id = `h${this.nextHero++}`;
      ids.set(ch.id, id);
      return { ...ch, id };
    });
    this.heroes = party.map((ch) => ({ id: ch.id, name: ch.name, classId: ch.classId, owner: '' }));
    const fresh = newGame(this.index, { seed: loaded.rngState, players: party });
    this.campaign = { ...fresh, phase: 'ended', party, flags: loaded.flags, unlocked: loaded.unlocked };
    const open = this.scenarios();
    this.scenarioId = open.find((x) => x.id === loaded.scenarioId)?.id ?? open[0]?.id ?? '';
  }

  // ---------- play ----------

  act(token: string, action: unknown): void {
    this.controller(token);
    if (!this.state) throw new TableError('The game has not started');
    if (!isRecord(action) || typeof action.type !== 'string') throw new TableError('Bad action');
    const type = action.type as Action['type'];
    if (!SHARED_ACTIONS.has(type) && !HERO_ACTIONS.has(type)) throw new TableError(`Unknown action '${type}'`);
    if (HERO_ACTIONS.has(type) && !this.owns(token, action.playerId)) throw new TableError('That hero is not yours');
    try {
      const r = act(this.index, this.state, action as Action);
      this.apply(r.state, r.events);
    } catch (e) {
      if (e instanceof GameError) throw new TableError(e.message);
      throw e;
    }
  }

  private apply(state: GameState, events: GameEvent[]): void {
    this.state = state;
    for (const e of events) {
      if (e.type === 'scenarioStarted') this.shownCard = undefined;
      // After a win, the next scenario to play is the one it opened.
      if (e.type === 'scenarioEnded' && e.result === 'victory' && e.unlocked.length) this.scenarioId = e.unlocked[0];
      if (e.type === 'cardRevealed') this.shownCard = e.cardId;
      if (e.type === 'unitSpawned') this.names.set(e.unitId, e.name);
      const line = describeEvent(this.index, state, e, { names: this.names });
      if (!line) continue;
      const entry: LogEntry = { id: this.nextLog++, text: line };
      if (e.type === 'checkRolled' && e.secret) {
        entry.heroId = e.playerId;
        entry.secretText = describeEvent(this.index, state, e, { revealSecret: true, names: this.names }) ?? undefined;
      }
      this.log.push(entry);
    }
    if (this.log.length > LOG_LIMIT) this.log.splice(0, this.log.length - LOG_LIMIT);
    // Level-ups are picked before the campaign moves on.
    if (state.phase === 'ended' && !state.pending) this.campaign = state;
  }

  // ---------- views ----------

  viewFor(token: string): View {
    const seat = this.seats.get(token);
    const role = seat?.role ?? 'screen';
    const mine = role === 'controller' ? this.heroes.filter((h) => h.owner === token).map((h) => h.id) : [];
    const online = (heroId: string) => {
      const owner = this.heroes.find((h) => h.id === heroId)?.owner;
      return (owner && this.seats.get(owner)?.connections) ? true : false;
    };
    const s = this.state;
    const card = s && this.shownCard ? this.index.cards.get(this.shownCard) : undefined;
    const sc = this.index.scenarios.get(s?.scenarioId ?? this.scenarioId);
    const seats = [...this.seats.values()].filter((x) => x.connections > 0);
    const base = {
      code: this.code,
      packId: this.index.pack.id,
      packName: text(this.index.pack.name),
      phase: this.phase,
      result: s?.result,
      maxHeroes: MAX_HEROES,
      classes: (this.index.pack.classes ?? []).map((c) => ({ id: c.id, name: text(c.name), role: c.role })),
      scenarios: this.scenarios(),
      scenarioId: s?.scenarioId ?? this.scenarioId,
      scenarioName: sc ? text(sc.name) : undefined,
      nextScenario: this.phase === 'ended' ? this.scenarios().find((x) => x.id === this.scenarioId) : undefined,
      stats: this.index.abilityStats,
      // In the lobby, heroes are shown as they will start.
      heroes: (s?.party ?? this.lobbyParty()).map((ch) =>
        heroView(this.index, ch, online(ch.id), s ? heroUses(this.index, s, ch.id) : [], !this.heroes.find((h) => h.id === ch.id)?.owner || !online(ch.id)),
      ),
      campaign: { started: !!this.campaign, canSave: !!this.campaign && this.phase !== 'playing' },
      card: card ? { title: text(card.title), text: text(card.text), type: card.type, image: this.asset(card.image) } : undefined,
      cardsLeft: s?.deck.length ?? 0,
      prompt: s?.pending ? promptView(this.index, s.pending) : undefined,
      waitingOn: s ? waitingOn(s) : [],
      log: this.log.map((e) => ({ id: e.id, text: e.heroId && mine.includes(e.heroId) && e.secretText ? e.secretText : e.text })),
      combat: s ? combatView(this.index, s, (k) => this.asset(k)) : undefined,
      devices: { controllers: seats.filter((x) => x.role === 'controller').length, screens: seats.filter((x) => x.role === 'screen').length },
    };
    if (role !== 'controller') return { ...base, role: 'screen' };
    // A phone also plays heroes whose phone is offline (see `owns`).
    const playable = s?.combat ? s.party.filter((p) => mine.includes(p.id) || !online(p.id)).map((p) => p.id) : [];
    const combatOptions = playable.map((id) => heroCombatOptions(this.index, s!, id)).filter((o) => o !== undefined);
    return { ...base, role, mine, combatOptions: s?.combat ? combatOptions : undefined };
  }

  /** Every token that should get a view update. */
  tokens(): string[] {
    return [...this.seats.keys()];
  }

  // ---------- helpers ----------

  private controller(token: string): void {
    if (this.seats.get(token)?.role !== 'controller') throw new TableError('Only phones can do that');
  }

  /** A phone acts for its own heroes, and for any hero whose phone is offline so the table never stalls. */
  private owns(token: string, heroId: unknown): boolean {
    const hero = this.heroes.find((h) => h.id === heroId);
    return !!hero && (hero.owner === token || !this.seats.get(hero.owner)?.connections);
  }

  /** The lobby's heroes as they stand in the campaign; newcomers as new characters. */
  private lobbyParty(): Character[] {
    return this.heroes.map((h) => this.campaign?.party.find((p) => p.id === h.id) ?? createCharacter(this.index, h));
  }

  private scenarios(): { id: string; name: string }[] {
    const all = this.index.pack.scenarios ?? [];
    const start = (this.state ?? this.campaign)?.unlocked ?? this.index.pack.campaign?.startScenarios;
    const open = start?.length ? all.filter((s) => start.includes(s.id)) : all;
    return open.map((s) => ({ id: s.id, name: text(s.name) }));
  }

  /** Map an asset key from the pack to a URL the browser can load. */
  private asset(key: string | undefined): string | undefined {
    const a = key ? this.index.pack.assets?.[key] : undefined;
    if (!a) return undefined;
    if (!this.assetBase) return `/pack/${a.path}`;
    try {
      const url = new URL(a.path, this.assetBase);
      return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : undefined;
    } catch {
      return undefined;
    }
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
