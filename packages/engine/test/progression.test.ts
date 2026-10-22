import { describe, expect, it } from 'vitest';
import { maxHp } from '../src/character';
import { act, GameError, heroUses, newGame, nextScenario, startScenario, type GameState } from '../src/game';
import { indexPack, type PackIndex } from '../src/pack';
import { autoPlay, exampleIndex, PARTY, playOut } from './helpers';

const index: PackIndex = await exampleIndex();
const hero = (s: GameState, id: string) => s.party.find((p) => p.id === id)!;

/** A finished first chapter, won. */
function wonChapterOne(): GameState {
  for (let seed = 1; seed < 40; seed++) {
    const { state } = autoPlay(index, seed);
    if (state.result === 'victory') return state;
  }
  throw new Error('no winning seed');
}

/** Between two cards of a fresh scenario. */
function between(players = PARTY): GameState {
  const s = startScenario(index, newGame(index, { seed: 3, players }), 'hollow-road-1').state;
  return act(index, { ...s, deck: ['road-begins', 'campfire-rest', 'road-begins'] }, { type: 'next' }).state;
}

describe('campaign', () => {
  it('unlocks chapter 2 and carries XP, gold and items into it, healed and clear of conditions', () => {
    const end = structuredClone(wonChapterOne());
    expect(end.unlocked).toEqual(['hollow-road-1', 'hollow-road-2']);
    const ana = hero(end, 'p1');
    ana.hp = 1;
    ana.gold = 77;
    ana.inventory.push('healing-potion');
    ana.conditions.push({ id: 'weakened', remaining: 3 });
    end.flags.push('novice-spared');
    end.scenarioFlags.push('camp-alerted');

    const r = nextScenario(index, end, 'hollow-road-2');
    const s = r.state;
    const after = hero(s, 'p1');
    expect(r.events[0]).toMatchObject({ type: 'scenarioStarted', scenarioId: 'hollow-road-2' });
    expect(s.phase).toBe('playing');
    expect(after).toMatchObject({ xp: ana.xp, level: ana.level, gold: 77, skills: ana.skills, equipment: ana.equipment, inventory: ana.inventory, conditions: [] });
    expect(after.hp).toBe(maxHp(index, after));
    expect(s.flags).toContain('novice-spared');
    expect(s.scenarioFlags).toEqual([]);
    expect(s.unlocked).toContain('hollow-road-2');
  });

  it('resets whatever the pack does not persist', () => {
    const strict = indexPack({ ...index.pack, campaign: { ...index.pack.campaign, persistBetweenScenarios: ['hp'] } });
    const end = structuredClone(wonChapterOne());
    hero(end, 'p1').hp = 3;
    const s = nextScenario(strict, end, 'hollow-road-2').state;
    expect(hero(s, 'p1')).toMatchObject({ level: 1, xp: 0, gold: 10, inventory: [], equipment: { weapon: 'longsword', armor: 'chain-mail' }, hp: 3 });
  });

  it("won't move on while a scenario is running", () => {
    expect(() => nextScenario(index, between(), 'hollow-road-2')).toThrow(GameError);
  });

  it('plays chapter 2 through on autopilot without stalling', () => {
    let wins = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const { state: end } = autoPlay(index, seed);
      const { state } = playOut(index, nextScenario(index, end, 'hollow-road-2').state, seed);
      expect(state.phase).toBe('ended');
      expect(state.pending).toBeNull();
      if (state.result === 'victory') wins++;
    }
    expect(wins).toBeGreaterThan(0);
  });
});

describe('gear', () => {
  it('equips from the pack, putting the old item back', () => {
    const s = between();
    hero(s, 'p1').inventory.push('captains-sabre');
    const r = act(index, s, { type: 'equip', playerId: 'p1', itemId: 'captains-sabre' });
    expect(hero(r.state, 'p1').equipment.weapon).toBe('captains-sabre');
    expect(hero(r.state, 'p1').inventory).toEqual(['longsword']);
    const back = act(index, r.state, { type: 'unequip', playerId: 'p1', slot: 'weapon' }).state;
    expect(hero(back, 'p1').equipment.weapon).toBeUndefined();
    expect(hero(back, 'p1').inventory).toEqual(['longsword', 'captains-sabre']);
  });

  it('keeps class-only items to their class and gear out of fights', () => {
    const s = between();
    hero(s, 'p1').inventory.push('lute');
    expect(() => act(index, s, { type: 'equip', playerId: 'p1', itemId: 'lute' })).toThrow(/can't use Lute/);
    expect(() => act(index, s, { type: 'equip', playerId: 'p1', itemId: 'ring-of-warding' })).toThrow(/no Ring/);
    const fight = act(index, { ...s, deck: ['wolf-pack'] }, { type: 'next' }).state;
    expect(() => act(index, fight, { type: 'unequip', playerId: 'p1', slot: 'weapon' })).toThrow(/mid-fight/);
  });

  it('lets heroes swap gear after the scenario ends', () => {
    const end = wonChapterOne();
    expect(() => act(index, end, { type: 'unequip', playerId: 'p1', slot: 'armor' })).not.toThrow();
  });
});

describe('between cards', () => {
  it('drinks a potion and uses it up', () => {
    const s = between();
    const ana = hero(s, 'p1');
    ana.hp = 2;
    ana.inventory.push('healing-potion');
    expect(heroUses(index, s, 'p1')).toEqual([expect.objectContaining({ kind: 'item', id: 'healing-potion', aim: 'self', blocked: undefined })]);
    const r = act(index, s, { type: 'useItem', playerId: 'p1', itemId: 'healing-potion' });
    expect(hero(r.state, 'p1').hp).toBeGreaterThan(2);
    expect(hero(r.state, 'p1').inventory).not.toContain('healing-potion');
    expect(r.events[0]).toMatchObject({ type: 'abilityUsed', playerId: 'p1', name: 'Healing Potion' });
  });

  it('casts a skill marked usableOutOfCombat on an ally, once per card', () => {
    let s = between();
    hero(s, 'p1').hp = 1;
    expect(heroUses(index, s, 'p3').map((u) => u.id)).toEqual(['healing-word']);
    // Attack skills stay in combat.
    expect(heroUses(index, s, 'p2')).toEqual([]);
    s = act(index, s, { type: 'useSkill', playerId: 'p3', skillId: 'healing-word', targetId: 'p1' }).state;
    expect(hero(s, 'p1').hp).toBeGreaterThan(1);
    expect(() => act(index, s, { type: 'useSkill', playerId: 'p3', skillId: 'healing-word', targetId: 'p1' })).toThrow(/Once per card/);
    // The rest card resets it; so would any new card.
    s = act(index, s, { type: 'next' }).state;
    expect(heroUses(index, s, 'p3')[0].blocked).toBeUndefined();
  });

  it('heals with the caster’s stats, not the target’s', () => {
    const s = between();
    hero(s, 'p1').hp = 1;
    hero(s, 'p3').stats.wis = 40;
    const r = act(index, s, { type: 'useSkill', playerId: 'p3', skillId: 'healing-word', targetId: 'p1' });
    expect(hero(r.state, 'p1').hp).toBe(maxHp(index, hero(r.state, 'p1')));
  });

  it('waits while a vote or a check is open, and for downed heroes', () => {
    const s = between();
    hero(s, 'p1').inventory.push('healing-potion');
    const vote = act(index, { ...s, deck: ['roadside-shrine'] }, { type: 'next' }).state;
    expect(() => act(index, vote, { type: 'useItem', playerId: 'p1', itemId: 'healing-potion' })).toThrow(/Not right now/);
    hero(s, 'p1').hp = 0;
    expect(() => act(index, s, { type: 'useItem', playerId: 'p1', itemId: 'healing-potion' })).toThrow(/down/);
  });
});
