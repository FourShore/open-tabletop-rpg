// HTTP + WebSocket server: Colyseus for the tables, express for the web app
// and the pack's asset files.

import { existsSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { indexPack, validatePack } from '@otrpg/engine';
import { loadPackFromDisk, resolvePackPath } from '@otrpg/engine/node';
import express from 'express';
import { GameRoom } from './room';

export { GameRoom } from './room';
export { MAX_HEROES, Table, TableError } from './table';
export { readSave, SAVE_FORMAT, writeSave, type CampaignSave } from './save';
export type * from './view';

export interface ServerConfig {
  /** Path to the pack manifest (pack.json). */
  pack: string;
  port: number;
  /** Built web app to serve; skipped when missing (e.g. in development, where Vite serves it). */
  webDir?: string;
  /** Fixed RNG seed for every table, for tests. */
  seed?: number;
}

export async function createGameServer(config: ServerConfig) {
  const pack = await loadPackFromDisk(config.pack);
  const issues = validatePack(pack);
  if (issues.length) throw new Error(`Pack has ${issues.length} problem(s):\n${issues.map((i) => `  ${i.path}: ${i.message}`).join('\n')}`);
  GameRoom.index = indexPack(pack);
  GameRoom.seed = config.seed;

  const app = express();
  app.get('/healthz', (_req, res) => {
    res.json({ ok: true, pack: pack.id });
  });
  // The campaign so far, as a file to keep. Anyone with the table code can join it, so they can save it too.
  app.get('/save/:code', (req, res) => {
    const save = GameRoom.tables.get(req.params.code.toUpperCase())?.save();
    if (!save) {
      res.status(404).json({ error: 'Nothing to save yet' });
      return;
    }
    const name = `${pack.id}-${save.savedAt.slice(0, 10)}.json`.replace(/[^\w.-]/g, '-');
    res.setHeader('Cache-Control', 'no-store');
    if ('download' in req.query) res.attachment(name);
    res.json(save);
  });
  app.use('/pack', express.static(path.dirname(resolvePackPath(config.pack))), (_req, res) => {
    // Packs often reference art that isn't drawn yet; the client hides missing images.
    res.status(404).end();
  });
  if (config.webDir && existsSync(config.webDir)) {
    const webDir = path.resolve(config.webDir);
    app.use(express.static(webDir));
    // Client-side routes (/screen/ABCD, /play/ABCD) all load the app.
    app.get(/^\/(?!matchmake\/).*/, (_req, res) => res.sendFile(path.join(webDir, 'index.html')));
  }

  const httpServer = http.createServer(app);
  const gameServer = new Server({ transport: new WebSocketTransport({ server: httpServer }), greet: false, gracefullyShutdown: false });
  gameServer.define('table', GameRoom);
  await gameServer.listen(config.port);
  const address = httpServer.address();
  const port = typeof address === 'object' && address ? address.port : config.port;
  return {
    port,
    close: () => gameServer.gracefullyShutdown(false),
  };
}
