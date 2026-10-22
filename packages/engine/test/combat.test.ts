import { describe, expect, it } from 'vitest';
import { dist } from '../src/combat';
import { act, GameError, newGame, startScenario, waitingOn, type Action, type GameState } from '../src/game';
import { indexPack, type PackIndex } from '../src/pack';
import { heroCombatOptions, suggestCombatAction } from '../src/tactics';
import type { Point } from '../src/types';
import { exampleIndex, PARTY } from './helpers';

const index: PackIndex = await exampleIndex();

/** Flip straight into a combat card. */
function fight(card: string, seed = 1, players = PARTY, flags: string[] = []): GameState {
  const s = startScenario(index, newGame(index, { seed, players }), 'hollow-road-1').state;
  return act(index, { ...s, deck: [card], scenarioFlags: flags }, { type: 'next' }).state;
}

const unit = (s: GameState, id: string) => s.combat!.units.find((u) => u.id === id)!;
const enemies = (s: GameState) => s.combat!.units.filter((u) => u.side === 'enemy');
const go = (s: GameState, a: Action) => act(index, s, a);

/** Move every enemy out of the way so a test controls who is in reach. */
function clearEnemies(s: GameState, keep: Point[] = []): GameState {
  const out = structuredClone(s);
  enemies(out).forEach((u, i) => {
    if (keep[i]) u.pos = keep[i];
    else u.dead = true;
  });
  return out;
}

describe('combat setup', () => {
  it('places heroes on the start squares and enemies on their spawn points', () => {
    const s = fight('goblin-ambush');
    expect(s.pending?.kind).toBe('combat');
    const cs = s.combat!;
    expect(cs.round).toBe(1);
    expect(cs.units.filter((u) => u.side === 'hero').map((u) => u.pos)).toEqual([[1, 7], [2, 7], [3, 7]]);
    // 1 + partySize goblins at the north spawn, one archer east.
    expect(enemies(s).map((u) => u.enemyId)).toEqual(['goblin', 'goblin', 'goblin', 'goblin', 'goblin-archer']);
    expect(enemies(s)[0].pos).toEqual([3, 0]);
    expect(new Set(cs.units.map((u) => u.pos.join())).size).toBe(cs.units.length);
  });

  it('shows each enemy intent with a target before the heroes act', () => {
    const s = fight('goblin-ambush');
    for (const e of enemies(s)) {
      expect(e.intent).toBeDefined();
      if (e.intent!.action !== 'flee') expect(s.party.map((p) => p.id)).toContain(e.intent!.targetId);
    }
  });

  it('gives every standing hero two actions and waits on all of them', () => {
    const s = fight('wolf-pack');
    expect(s.combat!.units.filter((u) => u.side === 'hero').map((u) => u.actionsLeft)).toEqual([2, 2, 2]);
    expect(waitingOn(s)).toEqual(['p1', 'p2', 'p3']);
  });

  it('caps a spawn, and stops when the map is full', () => {
    const tiny = { ...index.pack, maps: index.pack.maps!.map((m) => (m.id === 'forest-clearing' ? { ...m, width: 4, height: 4, tiles: undefined, heroStart: [[0, 3], [1, 3], [2, 3]] as Point[], spawnPoints: { north: [[0, 0]] as Point[], east: [[3, 0]] as Point[] } } : m)) };
    const flood = { ...tiny, cards: tiny.cards!.map((c) => (c.id === 'wolf-pack' ? { ...c, combat: { ...c.combat!, spawns: [{ enemy: 'wolf', count: '1000000', at: 'east' }] } } : c)) };
    const big = indexPack(flood);
    const s = startScenario(big, newGame(big, { seed: 1, players: PARTY }), 'hollow-road-1').state;
    const r = act(big, { ...s, deck: ['wolf-pack'], scenarioFlags: [] }, { type: 'next' });
    // 16 squares, 3 heroes: 13 wolves at most.
    expect(r.state.combat!.units.filter((u) => u.side === 'enemy')).toHaveLength(13);
  });

  it('holds reinforcements until their round', () => {
    const s = fight('bandit-camp', 1, PARTY, ['camp-alerted']);
    expect(s.combat!.waves).toEqual([{ enemy: 'goblin-archer', count: 2, at: 'guards', round: 3 }]);
    expect(enemies(s).some((u) => u.enemyId === 'goblin-archer')).toBe(false);
  });
});

describe('hero actions', () => {
  it('spends an action to move, only to squares in reach', () => {
    const s = clearEnemies(fight('wolf-pack'), [[11, 0]]);
    const o = heroCombatOptions(index, s, 'p1')!;
    expect(o.moveSquares.length).toBeGreaterThan(5);
    // Boulders are impassable and the stream costs double.
    expect(o.moveSquares).not.toContainEqual([1, 6]);
    const to = o.moveSquares.find((p) => p[1] === 5)!;
    const r = go(s, { type: 'move', playerId: 'p1', to });
    expect(unit(r.state, 'p1').pos).toEqual(to);
    expect(unit(r.state, 'p1').actionsLeft).toBe(1);
    expect(() => go(s, { type: 'move', playerId: 'p1', to: [11, 0] })).toThrow(/reach/);
    expect(() => go(s, { type: 'move', playerId: 'p1', to: [2, 7] })).toThrow(/reach/);
  });

  it('attacks only targets in range, then puts the skill on cooldown', () => {
    let s = clearEnemies(fight('wolf-pack'), [[1, 6]]);
    const wolf = enemies(s)[0];
    expect(() => go(s, { type: 'useSkill', playerId: 'p2', skillId: 'arcane-bolt', target: [9, 0] })).toThrow(/range/);
    expect(() => go(s, { type: 'useSkill', playerId: 'p1', skillId: 'fireball', target: wolf.pos })).toThrow(/doesn't know/);
    const r = go(s, { type: 'useSkill', playerId: 'p2', skillId: 'firebolt', target: wolf.pos });
    expect(r.events.map((e) => e.type)).toContain('attackRolled');
    s = r.state;
    expect(unit(s, 'p2').cooldowns.firebolt).toBe(1);
    expect(() => go(s, { type: 'useSkill', playerId: 'p2', skillId: 'firebolt', target: wolf.pos })).toThrow(/Ready in 1 round/);
  });

  it('runs the enemy phase once every hero has ended their turn', () => {
    let s = fight('wolf-pack');
    s = go(s, { type: 'endTurn', playerId: 'p1' }).state;
    s = go(s, { type: 'endTurn', playerId: 'p2' }).state;
    expect(s.combat!.round).toBe(1);
    const r = go(s, { type: 'endTurn', playerId: 'p3' });
    expect(r.events.map((e) => e.type)).toContain('enemyPhase');
    expect(r.state.combat?.round ?? 2).toBe(2);
    expect(() => go(r.state, { type: 'endTurn', playerId: 'p3' })).not.toThrow(/ended their turn/);
  });

  it('rejects actions from a hero who is done or down', () => {
    let s = fight('wolf-pack');
    s = go(s, { type: 'endTurn', playerId: 'p1' }).state;
    expect(() => go(s, { type: 'endTurn', playerId: 'p1' })).toThrow(GameError);
    const down = structuredClone(s);
    down.party[1].hp = 0;
    unit(down, 'p2').down = true;
    expect(() => go(down, { type: 'endTurn', playerId: 'p2' })).toThrow(/down/);
  });

  it('heals a downed ally back onto their feet, or revives them with a check', () => {
    const s = clearEnemies(fight('wolf-pack', 4), [[11, 0]]);
    s.party[0].hp = 0;
    unit(s, 'p1').down = true;
    const heal = go(s, { type: 'useSkill', playerId: 'p3', skillId: 'healing-word', target: unit(s, 'p1').pos }).state;
    expect(heal.party[0].hp).toBeGreaterThan(0);
    expect(unit(heal, 'p1').down).toBe(false);

    const o = heroCombatOptions(index, s, 'p2')!;
    expect(o.revive).toEqual(['p1']);
    const r = go(s, { type: 'revive', playerId: 'p2', targetId: 'p1' });
    expect(r.events.find((e) => e.type === 'revived')).toBeDefined();
  });

  it('keeps out-of-combat blessings counting cards, not rounds', () => {
    const s = fight('wolf-pack');
    s.party[0].conditions.push({ id: 'blessed', remaining: 6 });
    let r = go(s, { type: 'endTurn', playerId: 'p1' });
    r = go(r.state, { type: 'endTurn', playerId: 'p2' });
    r = go(r.state, { type: 'endTurn', playerId: 'p3' });
    expect(r.state.party[0].conditions).toContainEqual({ id: 'blessed', remaining: 6 });
  });
});

describe('enemies', () => {
  it('close in and attack the target they showed', () => {
    let s = fight('wolf-pack', 2);
    const before = Object.fromEntries(enemies(s).map((u) => [u.id, u.pos]));
    for (const id of ['p1', 'p2', 'p3']) s = go(s, { type: 'endTurn', playerId: id }).state;
    for (const e of enemies(s)) expect(dist(e.pos, before[e.id])).toBeGreaterThan(0);
  });

  it('never target a downed hero', () => {
    let s = fight('wolf-pack', 5);
    s.party[1].hp = 0;
    unit(s, 'p2').down = true;
    for (const id of ['p1', 'p3']) s = go(s, { type: 'endTurn', playerId: id }).state;
    for (const e of enemies(s)) expect(e.intent?.targetId).not.toBe('p2');
  });
});

describe('ending a fight', () => {
  it('wins when the last enemy falls, granting kill and card rewards', () => {
    let s = clearEnemies(fight('wolf-pack'), [[1, 6]]);
    const wolf = enemies(s)[0];
    s.combat!.units.find((u) => u.id === wolf.id)!.hp = 1;
    const xpBefore = s.party[0].xp;
    // Swing until it lands.
    for (let i = 0; i < 20 && s.combat; i++) {
      const r = go(s, { type: 'useSkill', playerId: 'p1', skillId: 'strike', target: [1, 6] });
      s = r.state;
      if (!s.combat) {
        expect(r.events.map((e) => e.type)).toEqual(expect.arrayContaining(['unitDied', 'combatEnded']));
        break;
      }
      if (unit(s, 'p1').done) for (const id of ['p2', 'p3']) if (s.combat && !unit(s, id).done) s = go(s, { type: 'endTurn', playerId: id }).state;
      if (s.combat) s.combat.units.find((u) => u.id === wolf.id)!.pos = [1, 6];
    }
    expect(s.combat).toBeUndefined();
    expect(s.pending?.kind).not.toBe('combat');
    // 3 XP for the kill plus 5 from the card.
    expect(s.party[0].xp).toBe(xpBefore + 8);
  });

  it('loses when every hero is down', () => {
    const s = fight('goblin-ambush');
    for (const p of s.party) p.hp = 1;
    let state = s;
    for (let i = 0; i < 200 && state.combat; i++) state = go(state, { type: 'endTurn', playerId: waitingOn(state)[0] }).state;
    expect(state.combat).toBeUndefined();
    expect(state.result).toBe('defeat');
  });

  it('plays a whole fight on autopilot, the same way every time', () => {
    const run = (seed: number) => {
      let s = fight('goblin-ambush', seed);
      const log: string[] = [];
      for (let i = 0; i < 500 && s.combat; i++) {
        const r = go(s, suggestCombatAction(index, s, waitingOn(s)[0]));
        log.push(...r.events.map((e) => e.type));
        s = r.state;
      }
      return { s, log };
    };
    const a = run(9);
    expect(a.s.combat).toBeUndefined();
    expect(run(9).log).toEqual(a.log);
  });
});

