// Start the server: `npm start -w @otrpg/server`.
//   PORT     port to listen on (default 2567)
//   PACK     path to a pack.json (default: the example pack)
//   WEB_DIR  built web app to serve (default: packages/web/dist)

import { fileURLToPath } from 'node:url';
import { createGameServer } from './index';

const here = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));
const server = await createGameServer({
  port: Number(process.env.PORT ?? 2567),
  pack: process.env.PACK ?? here('../../../spec/example-pack/pack.json'),
  webDir: process.env.WEB_DIR ?? here('../../web/dist'),
  seed: process.env.SEED ? Number(process.env.SEED) : undefined,
});
console.log(`Open Tabletop RPG server on http://localhost:${server.port}`);
