import { act, newGame, startScenario, type Action, type GameEvent, type GameState, type PlayerSpec } from '../src/game';
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
  const pick = createRng(seed + 1);
  let state = newGame(index, { seed, players });
  const log: GameEvent[] = [];
  let r = startScenario(index, state, scenario);
  state = r.state;
  log.push(...r.events);
  for (let guard = 0; (state.phase === 'playing' || state.pending) && guard < 500; guard++) {
    r = act(index, state, chooseAction(state, pick.next.bind(pick)));
    state = r.state;
    log.push(...r.events);
  }
  return { state, log };
}

export function chooseAction(s: GameState, rand: () => number): Action {
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
      return { type: 'resolveCombat', victory: rand() < 0.8 };
    case 'shop':
      return { type: 'leaveShop' };
    case 'levelUp': {
      const i = Math.floor(rand() * p.tiles.length);
      return { type: 'pickTile', playerId: p.playerId, index: i, stat: p.tiles[i].kind === 'anyStat' ? 'str' : undefined };
    }
  }
}
