import { act, newGame, startScenario, waitingOn, type Action, type GameEvent, type GameState, type PlayerSpec } from '../src/game';
import { suggestCombatAction } from '../src/tactics';
import { loadPackFromDisk } from '../src/node';
import { indexPack, type PackIndex } from '../src/pack';
import { createRng } from '../src/rng';

export const EXAMPLE_PACK = new URL('../../../spec/example-pack/pack.json', import.meta.url).pathname;

export async function exampleIndex(): Promise<PackIndex> {
  return indexPack(await loadPackFromDisk(EXAMPLE_PACK));
}

export const PARTY: PlayerSpec[] = [
  { id: 'p1', name: 'Ana', classId: 'knight' },
  { id: 'p2', name: 'Ben', classId: 'wizard' },
  { id: 'p3', name: 'Cy', classId: 'cleric' },
];

/** Play a scenario to the end, making random but legal choices. */
export function autoPlay(index: PackIndex, seed: number, players = PARTY, scenario = 'hollow-road-1') {
  const r = startScenario(index, newGame(index, { seed, players }), scenario);
  const out = playOut(index, r.state, seed);
  return { state: out.state, log: [...r.events, ...out.log] };
}

/** Play an already started scenario to the end, making random but legal choices. */
export function playOut(index: PackIndex, start: GameState, seed: number) {
  const pick = createRng(seed + 1);
  let state = start;
  const log: GameEvent[] = [];
  for (let guard = 0; (state.phase === 'playing' || state.pending) && guard < 3000; guard++) {
    const r = act(index, state, chooseAction(index, state, pick.next.bind(pick)));
    state = r.state;
    log.push(...r.events);
  }
  return { state, log };
}

export function chooseAction(index: PackIndex, s: GameState, rand: () => number): Action {
  const p = s.pending;
  if (!p) return { type: 'next' };
  switch (p.kind) {
    case 'vote': {
      const voter = s.party.find((m) => !(m.id in p.votes))!;
      const enabled = p.options.map((o, i) => (o.enabled ? i : -1)).filter((i) => i >= 0);
      return { type: 'vote', playerId: voter.id, option: enabled[Math.floor(rand() * enabled.length)] };
    }
    case 'chooseRoller':
      return { type: 'chooseRoller', playerId: s.party.find((m) => m.hp > 0)!.id };
    case 'combat':
      return suggestCombatAction(index, s, waitingOn(s)[0] ?? s.party[0].id);
    case 'shop':
      return { type: 'leaveShop' };
    case 'levelUp': {
      const i = Math.floor(rand() * p.tiles.length);
      return { type: 'pickTile', playerId: p.playerId, index: i, stat: p.tiles[i].kind === 'anyStat' ? 'str' : undefined };
    }
  }
}
