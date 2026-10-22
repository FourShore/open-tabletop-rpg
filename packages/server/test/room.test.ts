// Real server, real WebSockets: a screen and two phones over colyseus.js.

import { Client, type Room } from 'colyseus.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createGameServer, type View } from '../src/index';

const EXAMPLE_PACK = new URL('../../../spec/example-pack/pack.json', import.meta.url).pathname;
let server: Awaited<ReturnType<typeof createGameServer>>;
let client: Client;

beforeAll(async () => {
  server = await createGameServer({ pack: EXAMPLE_PACK, port: 0, seed: 11 });
  client = new Client(`ws://localhost:${server.port}`);
});

afterAll(async () => {
  await server.close();
});

/** Track the latest view and errors a device has been sent. */
function watch(room: Room) {
  const d = { room, view: undefined as View | undefined, errors: [] as string[] };
  room.onMessage('view', (v: View) => (d.view = v));
  room.onMessage('error', (e: { message: string }) => d.errors.push(e.message));
  return d;
}

async function until(check: () => boolean, ms = 3000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('Timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe('game room', () => {
  it('serves the pack assets and a health check', async () => {
    const health = await fetch(`http://localhost:${server.port}/healthz`).then((r) => r.json());
    expect(health).toEqual({ ok: true, pack: 'core.hollow-road' });
    const manifest = await fetch(`http://localhost:${server.port}/pack/pack.json`).then((r) => r.json());
    expect(manifest.id).toBe('core.hollow-road');
  });

  it('creates a table with a 4-letter code that phones and a screen join', async () => {
    const screen = watch(await client.create('table', { token: 'tv', role: 'screen' }));
    const code = screen.room.roomId;
    expect(code).toMatch(/^[A-Z]{4}$/);
    const ana = watch(await client.joinById(code, { token: 'ana', role: 'controller' }));
    const ben = watch(await client.joinById(code, { token: 'ben', role: 'controller' }));

    ana.room.send('addHero', { name: 'Ana', classId: 'knight' });
    ben.room.send('addHero', { name: 'Ben', classId: 'wizard' });
    await until(() => screen.view?.heroes.length === 2);
    expect(screen.view!.devices).toEqual({ controllers: 2, screens: 1 });

    screen.room.send('start');
    await until(() => screen.errors.length > 0);
    expect(screen.errors[0]).toMatch(/phones/);

    ana.room.send('start');
    await until(() => screen.view?.phase === 'playing');
    ana.room.send('act', { action: { type: 'next' } });
    await until(() => screen.view!.card !== undefined);
    expect(ben.view!.card).toEqual(screen.view!.card);

    // A phone that drops and comes back with its token keeps its hero.
    const benHero = () => screen.view!.heroes.find((h) => h.name === 'Ben')!;
    await ben.room.leave();
    await until(() => benHero().online === false);
    const back = watch(await client.joinById(code, { token: 'ben', role: 'controller' }));
    await until(() => back.view !== undefined);
    expect(back.view!.role === 'controller' && back.view!.mine).toEqual([benHero().id]);
    await until(() => benHero().online);

    for (const d of [screen, ana, back]) await d.room.leave();
  });

  it('rejects joining a code that does not exist', async () => {
    await expect(client.joinById('ZZZZ', { token: 'x' })).rejects.toThrow();
  });
});
