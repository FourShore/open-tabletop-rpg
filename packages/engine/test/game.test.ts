import { describe, expect, it } from 'vitest';
import { act, GameError, newGame, startScenario, waitingOn, type GameState } from '../src/game';
import type { PackIndex } from '../src/pack';
import { autoPlay, exampleIndex, PARTY } from './helpers';

const index: PackIndex = await exampleIndex();

/** Start a scenario whose deck is just the given cards. */
function withDeck(cards: string[], seed = 1, players = PARTY): GameState {
  const state = startScenario(index, newGame(index, { seed, players }), 'hollow-road-1').state;
  return { ...state, deck: cards };
}

describe('game runner', () => {
  it('plays the example scenario to an end on many seeds', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const { state, log } = autoPlay(index, seed);
      expect(state.phase).toBe('ended');
      expect(state.pending).toBeNull();
      expect(log.filter((e) => e.type === 'scenarioEnded')).toHaveLength(1);
    }
  });

  it('is deterministic for a seed', () => {
    expect(autoPlay(index, 1234).log).toEqual(autoPlay(index, 1234).log);
    expect(autoPlay(index, 1234).log).not.toEqual(autoPlay(index, 4321).log);
  });

  it('does not mutate the state it is given', () => {
    const state = withDeck(['road-begins']);
    const before = structuredClone(state);
    act(index, state, { type: 'next' });
    expect(state).toEqual(before);
  });

  it('builds the deck from fixed cards and pool draws', () => {
    const s = startScenario(index, newGame(index, { seed: 3, players: PARTY }), 'hollow-road-1').state;
    expect(s.deck[0]).toBe('road-begins');
    expect(s.deck.slice(-3)).toEqual(['bandit-scout', 'campfire-rest', 'bandit-camp']);
    expect(s.deck).toHaveLength(7);
  });

  it('resolves an "each" check per player', () => {
    const r = act(index, withDeck(['rickety-bridge']), { type: 'next' });
    expect(r.events.filter((e) => e.type === 'checkRolled')).toHaveLength(3);
    for (const e of r.events.filter((e) => e.type === 'checkRolled')) {
      if (e.type !== 'checkRolled') continue;
      const follow = r.events.find((x) => 'playerId' in x && x.playerId === e.playerId && (x.type === 'gained' || x.type === 'damaged'));
      expect(follow?.type).toBe(e.success ? 'gained' : 'damaged');
    }
  });

  it('runs a majority vote and then the chosen option', () => {
    let s = act(index, withDeck(['roadside-shrine']), { type: 'next' }).state;
    expect(s.pending?.kind).toBe('vote');
    expect(waitingOn(s)).toEqual(['p1', 'p2', 'p3']);
    s = act(index, s, { type: 'vote', playerId: 'p1', option: 0 }).state;
    s = act(index, s, { type: 'vote', playerId: 'p2', option: 1 }).state;
    expect(() => act(index, s, { type: 'next' })).toThrow(GameError);
    const r = act(index, s, { type: 'vote', playerId: 'p3', option: 0 });
    expect(r.events).toContainEqual({ type: 'voteResolved', option: 0, label: 'Leave an offering (5 gold each)' });
    for (const ch of r.state.party) {
      expect(ch.gold).toBe(5);
      expect(ch.conditions.map((x) => x.id)).toContain('blessed');
    }
  });

  it('lets the leader decide on a leader vote, then asks who rolls', () => {
    let s = act(index, withDeck(['bandit-scout']), { type: 'next' }).state;
    expect(waitingOn(s)).toEqual(['p1']);
    s = act(index, s, { type: 'vote', playerId: 'p1', option: 0 }).state;
    expect(s.pending?.kind).toBe('chooseRoller');
    const r = act(index, s, { type: 'chooseRoller', playerId: 'p2' });
    const roll = r.events.find((e) => e.type === 'checkRolled');
    expect(roll).toMatchObject({ playerId: 'p2', stat: 'cha' });
    expect(r.state.pending).toBeNull();
  });

  it('applies combat outcomes and flags change later spawns', () => {
    let s = act(index, withDeck(['goblin-ambush']), { type: 'next' }).state;
    expect(s.pending).toMatchObject({ kind: 'combat', enemies: [{ enemy: 'goblin', count: 4 }, { enemy: 'goblin-archer', count: 1 }] });
    s = act(index, s, { type: 'resolveCombat', victory: true }).state;
    expect(s.flags).toContain('fought-goblins');
    expect(s.party.every((ch) => ch.xp === 6)).toBe(true);

    const turned = { ...withDeck(['bandit-camp']), flags: ['scout-turned'] };
    const camp = act(index, turned, { type: 'next' }).state;
    expect(camp.pending).toMatchObject({ enemies: [{ enemy: 'bandit-captain', count: 1 }, { enemy: 'goblin', count: 1 }] });
  });

  it('ends in defeat when a combat is lost and still offers earned level-ups', () => {
    let s = act(index, withDeck(['goblin-ambush']), { type: 'next' }).state;
    s = act(index, s, { type: 'resolveCombat', victory: false }).state;
    expect(s.phase).toBe('ended');
    expect(s.result).toBe('defeat');

    let w = withDeck(['bandit-camp']);
    w = { ...w, party: w.party.map((ch) => ({ ...ch, xp: 0 })) };
    w = act(index, w, { type: 'next' }).state;
    const r = act(index, w, { type: 'resolveCombat', victory: true });
    expect(r.state.phase).toBe('ended');
    expect(r.state.pending).toMatchObject({ kind: 'levelUp', playerId: 'p1', level: 2 });
    const tiles = (r.state.pending as { tiles: unknown[] }).tiles;
    const picked = act(index, r.state, { type: 'pickTile', playerId: 'p1', index: tiles.length - 1, stat: 'wis' });
    expect(picked.state.party[0]).toMatchObject({ level: 2, stats: expect.objectContaining({ wis: 3 }) });
    expect(picked.state.pending).toMatchObject({ kind: 'levelUp', playerId: 'p2' });
  });

  it('skips cards whose requirements are not met', () => {
    const s = { ...withDeck(['wolf-pack', 'road-begins']), flags: ['fed-wolves'] };
    const r = act(index, s, { type: 'next' });
    expect(r.events[0]).toEqual({ type: 'cardSkipped', cardId: 'wolf-pack' });
    expect(r.events[1]).toMatchObject({ type: 'cardRevealed', cardId: 'road-begins' });
  });

  it('runs a shop with prices from charisma', () => {
    let s = act(index, withDeck(['peddler']), { type: 'next' }).state;
    expect(s.pending?.kind).toBe('shop');
    const potion = (s.pending as { stock: { itemId: string; price: number }[] }).stock.find((x) => x.itemId === 'healing-potion')!;
    expect(potion.price).toBe(20); // best CHA in the party is 2, so no discount
    s = { ...s, party: s.party.map((ch, i) => (i === 0 ? { ...ch, gold: 50 } : ch)) };
    s = act(index, s, { type: 'buy', playerId: 'p1', itemId: 'healing-potion' }).state;
    expect(s.party[0].gold).toBe(30);
    expect(s.party[0].inventory).toContain('healing-potion');
    expect(() => act(index, s, { type: 'buy', playerId: 'p2', itemId: 'healing-potion' })).toThrow(/needs 20/);
    s = act(index, s, { type: 'leaveShop' }).state;
    expect(s.pending).toBeNull();
  });

  it('counts condition durations in cards', () => {
    let s = withDeck(['roadside-shrine', 'road-begins', 'road-begins']);
    s = act(index, s, { type: 'next' }).state;
    for (const p of ['p1', 'p2', 'p3']) s = act(index, s, { type: 'vote', playerId: p, option: 0 }).state;
    expect(s.party[0].conditions).toEqual([{ id: 'blessed', remaining: 5 }]);
    s = act(index, s, { type: 'next' }).state;
    expect(s.party[0].conditions).toEqual([{ id: 'blessed', remaining: 4 }]);
  });

  it('rejects illegal actions', () => {
    const s = withDeck(['road-begins']);
    expect(() => act(index, s, { type: 'vote', playerId: 'p1', option: 0 })).toThrow(/No vote/);
    expect(() => act(index, s, { type: 'resolveCombat', victory: true })).toThrow(/No combat/);
    expect(() => newGame(index, { seed: 1, players: [] })).toThrow(GameError);
    expect(() => newGame(index, { seed: 1, players: [{ id: 'x', name: 'X', classId: 'pirate' }] })).toThrow(/Unknown class/);
  });
});
