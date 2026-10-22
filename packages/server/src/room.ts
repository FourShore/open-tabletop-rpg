// A Colyseus room per table. The room's id is the 4-letter code players type
// in, so joining is `client.joinById(code, { token, role })`.
//
// There is no synced schema state: after every change the room sends each
// device its own view, since phones see secrets the screen must not.

import { Room, type Client } from '@colyseus/core';
import type { PackIndex } from '@otrpg/engine';
import { Table, TableError } from './table';

/** Letters that are hard to misread on a TV across the room. */
const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const activeCodes = new Set<string>();

/** How long an empty table waits for someone to come back before it closes. */
const EMPTY_TIMEOUT_MS = 15 * 60 * 1000;

export interface JoinOptions {
  token: string;
  role?: 'screen' | 'controller';
}

export class GameRoom extends Room {
  /** Set once at startup by createGameServer. */
  static index: PackIndex;
  static seed?: number;
  /** Open tables by code, for the save download. */
  static tables = new Map<string, Table>();

  maxClients = 32;
  autoDispose = false;
  private table!: Table;
  private tokenOf = new Map<string, string>();
  private emptyTimer?: { clear(): void };

  onCreate() {
    let code: string;
    do code = Array.from({ length: 4 }, () => CODE_LETTERS[Math.floor(Math.random() * CODE_LETTERS.length)]).join('');
    while (activeCodes.has(code));
    activeCodes.add(code);
    this.roomId = code;
    this.table = new Table(GameRoom.index, { code, seed: GameRoom.seed });
    GameRoom.tables.set(code, this.table);

    const handle = (type: string, fn: (token: string, msg: Record<string, unknown>) => void) =>
      this.onMessage(type, (client, msg) => {
        const token = this.tokenOf.get(client.sessionId)!;
        try {
          fn(token, typeof msg === 'object' && msg !== null ? msg : {});
          this.sync();
        } catch (e) {
          if (!(e instanceof TableError)) console.error(`[${code}] ${type} failed`, e);
          client.send('error', { message: e instanceof TableError ? e.message : 'Something went wrong on the server' });
        }
      });

    handle('addHero', (t, m) => this.table.addHero(t, m.name, m.classId));
    handle('removeHero', (t, m) => this.table.removeHero(t, m.heroId));
    handle('claimHero', (t, m) => this.table.claimHero(t, m.heroId));
    handle('newCampaign', (t) => this.table.newCampaign(t));
    handle('loadSave', (t, m) => this.table.loadSave(t, m.save));
    handle('scenario', (t, m) => this.table.chooseScenario(t, m.scenarioId));
    handle('start', (t) => this.table.start(t));
    handle('lobby', (t) => this.table.toLobby(t));
    handle('act', (t, m) => this.table.act(t, m.action));
  }

  onJoin(client: Client, options: JoinOptions) {
    const role = options?.role === 'screen' ? 'screen' : 'controller';
    this.table.connect(options?.token, role);
    this.tokenOf.set(client.sessionId, options.token);
    this.emptyTimer?.clear();
    this.emptyTimer = undefined;
    this.sync();
  }

  onLeave(client: Client) {
    const token = this.tokenOf.get(client.sessionId);
    this.tokenOf.delete(client.sessionId);
    if (token) this.table.disconnect(token);
    if (this.table.empty) this.emptyTimer = this.clock.setTimeout(() => this.disconnect(), EMPTY_TIMEOUT_MS);
    this.sync();
  }

  onDispose() {
    activeCodes.delete(this.roomId);
    GameRoom.tables.delete(this.roomId);
  }

  /** Send every connected device its own view. */
  private sync() {
    for (const client of this.clients) {
      const token = this.tokenOf.get(client.sessionId);
      if (token) client.send('view', this.table.viewFor(token));
    }
  }
}
