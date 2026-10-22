import { indexPack, suggestCombatAction, type GameState, type PackIndex } from '@otrpg/engine';
import { loadPackFromDisk } from '@otrpg/engine/node';
import { beforeAll, describe, expect, it } from 'vitest';
import { Table, type ControllerView } from '../src/index';

const EXAMPLE_PACK = new URL('../../../spec/example-pack/pack.json', import.meta.url).pathname;
let index: PackIndex;

beforeAll(async () => {
  index = indexPack(await loadPackFromDisk(EXAMPLE_PACK));
});

function table(seed = 7) {
  const t = new Table(index, { code: 'ABCD', seed });
  t.connect('screen', 'screen');
  t.connect('ana', 'controller');
  t.connect('ben', 'controller');
  return t;
}

/** Play the table to the end with legal moves, each sent by the phone that owns the hero. */
function playOut(t: Table, owners: Record<string, string>, onStep?: () => void, stop?: () => boolean) {
  for (let guard = 0; t.phase === 'playing' && guard < 3000; guard++) {
    if (stop?.()) return;
    const v = t.viewFor('screen');
    const p = v.prompt;
    const first = Object.values(owners)[0];
    if (!p) t.act(first, { type: 'next' });
    else if (p.kind === 'vote') {
      const hero = v.heroes.find((h) => !p.options.some((o) => o.voters.includes(h.id)))!;
      t.act(owners[hero.id], { type: 'vote', playerId: hero.id, option: p.options.findIndex((o) => o.enabled) });
    } else if (p.kind === 'chooseRoller') {
      const hero = v.heroes.find((h) => h.hp > 0)!;
      t.act(owners[hero.id], { type: 'chooseRoller', playerId: hero.id });
    } else if (p.kind === 'combat') {
      const heroId = v.waitingOn[0];
      t.act(owners[heroId], suggestCombatAction(t.index, (t as unknown as { state: GameState }).state, heroId));
    }
    else if (p.kind === 'shop') t.act(first, { type: 'leaveShop' });
    else if (p.kind === 'levelUp') {
      const stat = p.tiles[0].anyStat ? 'str' : undefined;
      t.act(owners[p.heroId], { type: 'pickTile', playerId: p.heroId, index: 0, stat });
    }
    onStep?.();
  }
}

describe('lobby', () => {
  it('adds heroes for the phone that made them and shows them on the screen', () => {
    const t = table();
    const a = t.addHero('ana', 'Ana', 'knight');
    t.addHero('ben', 'Ben', 'wizard');
    const screen = t.viewFor('screen');
    expect(screen.role).toBe('screen');
    expect(screen.heroes.map((h) => h.name)).toEqual(['Ana', 'Ben']);
    expect(screen.heroes[0].maxHp).toBeGreaterThan(0);
    expect((t.viewFor('ana') as ControllerView).mine).toEqual([a]);
  });

  it('rejects screens, bad classes, duplicate names and a seventh hero', () => {
    const t = table();
    expect(() => t.addHero('screen', 'Tv', 'knight')).toThrow(/phones/);
    expect(() => t.addHero('ana', 'Ana', 'dragon')).toThrow(/class/);
    expect(() => t.addHero('ana', '   ', 'knight')).toThrow(/name/);
    t.addHero('ana', 'Ana', 'knight');
    expect(() => t.addHero('ben', 'ana', 'wizard')).toThrow(/already/);
    for (const n of ['B', 'C', 'D', 'E', 'F']) t.addHero('ben', n, 'cleric');
    expect(() => t.addHero('ben', 'G', 'cleric')).toThrow(/full/);
  });

  it("only lets a phone remove its own heroes", () => {
    const t = table();
    const a = t.addHero('ana', 'Ana', 'knight');
    expect(() => t.removeHero('ben', a)).toThrow(/not yours/);
    t.removeHero('ana', a);
    expect(t.viewFor('screen').heroes).toEqual([]);
  });

  it('needs a hero to start, and locks the lobby once started', () => {
    const t = table();
    expect(() => t.start('ana')).toThrow(/at least one/);
    t.addHero('ana', 'Ana', 'knight');
    t.start('ana');
    expect(t.phase).toBe('playing');
    expect(() => t.addHero('ben', 'Ben', 'wizard')).toThrow(/started/);
    expect(t.viewFor('screen').log[0].text).toMatch(/begins/);
  });

  it('keeps a token on its first role when it reconnects', () => {
    const t = table();
    const a = t.addHero('ana', 'Ana', 'knight');
    t.disconnect('ana');
    expect(t.viewFor('screen').heroes[0].online).toBe(false);
    t.connect('ana', 'screen');
    expect(t.roleOf('ana')).toBe('controller');
    expect((t.viewFor('ana') as ControllerView).mine).toEqual([a]);
    expect(t.viewFor('screen').heroes[0].online).toBe(true);
  });
});

describe('play', () => {
  it('plays a scenario to the end with each phone acting only for its heroes', () => {
    const t = table();
    const a = t.addHero('ana', 'Ana', 'knight');
    const b = t.addHero('ben', 'Ben', 'wizard');
    t.start('ana');
    playOut(t, { [a]: 'ana', [b]: 'ben' });
    expect(t.phase).toBe('ended');
    expect(t.viewFor('screen').result).toBeDefined();
  });

  it("refuses actions for another phone's hero", () => {
    const t = table(3);
    const a = t.addHero('ana', 'Ana', 'knight');
    const b = t.addHero('ben', 'Ben', 'wizard');
    t.start('ana');
    const waitingForHero = () => ['vote', 'chooseRoller'].includes(t.viewFor('screen').prompt?.kind ?? '');
    playOut(t, { [a]: 'ana', [b]: 'ben' }, undefined, waitingForHero);
    const p = t.viewFor('screen').prompt!;
    if (p.kind === 'vote') expect(() => t.act('ana', { type: 'vote', playerId: b, option: 0 })).toThrow(/not yours/);
    else expect(() => t.act('ben', { type: 'chooseRoller', playerId: a })).toThrow(/not yours/);
  });

  it("lets any phone act for a hero whose phone is offline", () => {
    const t = table(3);
    const a = t.addHero('ana', 'Ana', 'knight');
    const b = t.addHero('ben', 'Ben', 'wizard');
    t.start('ana');
    playOut(t, { [a]: 'ana', [b]: 'ben' }, undefined, () => t.viewFor('screen').prompt?.kind === 'vote');
    t.disconnect('ben');
    expect(t.viewFor('screen').waitingOn).toContain(b);
    t.act('ana', { type: 'vote', playerId: b, option: 0 });
    expect(t.viewFor('screen').waitingOn).not.toContain(b);
  });

  it('shows the fight on every device and gives each phone options for its own hero', () => {
    const t = table(2);
    const a = t.addHero('ana', 'Ana', 'knight');
    const b = t.addHero('ben', 'Ben', 'wizard');
    t.start('ana');
    playOut(t, { [a]: 'ana', [b]: 'ben' }, undefined, () => t.viewFor('screen').prompt?.kind === 'combat');
    const screen = t.viewFor('screen');
    expect(screen.combat?.round).toBe(1);
    expect(screen.combat?.units.filter((u) => u.side === 'hero').map((u) => u.name)).toEqual(['Ana', 'Ben']);
    expect(screen.combat?.units.some((u) => u.side === 'enemy' && u.intent?.label)).toBe(true);
    expect(screen.role === 'screen' && 'combatOptions' in screen).toBe(false);
    const phone = t.viewFor('ana') as ControllerView;
    expect(phone.combatOptions?.map((o) => o.heroId)).toEqual([a]);
    expect(phone.combatOptions?.[0].skills.map((x) => x.id)).toContain('strike');
    expect(() => t.act('ana', { type: 'endTurn', playerId: b })).toThrow(/not yours/);
  });

  it('shows votes on the screen as they come in', () => {
    let seen = false;
    // Not every run draws a majority vote, so try a few seeds.
    for (let seed = 1; seed < 30 && !seen; seed++) {
      const t = table(seed);
      const a = t.addHero('ana', 'Ana', 'knight');
      const b = t.addHero('ben', 'Ben', 'wizard');
      t.start('ana');
      playOut(t, { [a]: 'ana', [b]: 'ben' }, () => {
        const p = t.viewFor('screen').prompt;
        if (p?.kind === 'vote' && p.options.some((o) => o.voters.includes(a))) seen = true;
      });
    }
    expect(seen).toBe(true);
  });

  it('turns engine errors into table errors and rejects junk', () => {
    const t = table();
    t.addHero('ana', 'Ana', 'knight');
    expect(() => t.act('ana', { type: 'next' })).toThrow(/not started/);
    t.start('ana');
    expect(() => t.act('ana', null)).toThrow(/Bad action/);
    expect(() => t.act('ana', { type: 'cheat' })).toThrow(/Unknown action/);
    expect(() => t.act('ana', { type: 'resolveCombat', victory: true })).toThrow(/Unknown action/);
    expect(() => t.act('screen', { type: 'next' })).toThrow(/phones/);
    expect(() => t.act('ana', { type: 'leaveShop' })).toThrow(/No shop/);
  });

  it('shows a secret roll only to the phone that owns the roller', () => {
    const t = table();
    const a = t.addHero('ana', 'Ana', 'knight');
    t.addHero('ben', 'Ben', 'wizard');
    t.start('ana');
    // Feed a secret roll through the same path the game's events take.
    const priv = t as unknown as { apply: (s: unknown, e: unknown[]) => void; state: unknown };
    priv.apply(priv.state, [{ type: 'checkRolled', playerId: a, stat: 'wis', natural: 12, total: 14, dc: 12, success: true, critical: false, fumble: false, secret: true }]);
    const last = (token: string) => t.viewFor(token).log.at(-1)!.text;
    expect(last('screen')).toMatch(/in secret/);
    expect(last('ben')).toMatch(/in secret/);
    expect(last('ana')).toMatch(/14 vs DC 12/);
  });

  it('lets a phone swap gear and drink a potion between cards', () => {
    const t = table();
    const a = t.addHero('ana', 'Ana', 'knight');
    t.start('ana');
    const st = (t as unknown as { state: GameState }).state;
    st.party[0].inventory.push('healing-potion', 'captains-sabre');
    st.party[0].hp = 3;
    let hero = t.viewFor('ana').heroes[0];
    expect(hero.inventory.map((i) => [i.name, i.equippable])).toEqual([['Healing Potion', false], ["Captain's Sabre", true]]);
    expect(hero.equipment.find((e) => e.slot === 'weapon')?.details).toBe('Weapon · +1 attack');
    expect(hero.uses.map((u) => u.name)).toEqual(['Healing Potion']);
    expect(() => t.act('ben', { type: 'equip', playerId: a, itemId: 'captains-sabre' })).toThrow(/not yours/);
    t.act('ana', { type: 'equip', playerId: a, itemId: 'captains-sabre' });
    t.act('ana', { type: 'useItem', playerId: a, itemId: 'healing-potion' });
    hero = t.viewFor('ana').heroes[0];
    expect(hero.equipment.find((e) => e.slot === 'weapon')?.name).toBe("Captain's Sabre");
    expect(hero.hp).toBeGreaterThan(3);
    expect(t.viewFor('screen').log.at(-2)?.text).toBe('Ana uses Healing Potion.');
  });
});

/** Play until a win, starting fresh each time it ends in defeat. */
function winChapterOne(t: Table, owners: Record<string, string>) {
  for (let i = 0; i < 20; i++) {
    playOut(t, owners);
    if (t.viewFor('screen').result === 'victory') return;
    t.toLobby(Object.values(owners)[0]);
    t.newCampaign(Object.values(owners)[0]);
    t.start(Object.values(owners)[0]);
  }
  throw new Error('never won');
}

describe('campaign', () => {
  it('carries the party into the scenario a win unlocks, via the lobby', () => {
    const t = table(3);
    const a = t.addHero('ana', 'Ana', 'knight');
    t.start('ana');
    expect(t.viewFor('screen').campaign).toEqual({ started: false, canSave: false });
    winChapterOne(t, { [a]: 'ana' });
    const after = t.viewFor('screen');
    expect(after.campaign).toEqual({ started: true, canSave: true });
    expect(after.nextScenario).toEqual({ id: 'hollow-road-2', name: 'Chapter 2: The Grey Abbey' });
    expect(after.scenarios.map((s) => s.id)).toEqual(['hollow-road-1', 'hollow-road-2']);
    const { xp, gold } = after.heroes[0];

    t.toLobby('ana');
    const b = t.addHero('ben', 'Ben', 'wizard');
    const lobby = t.viewFor('screen');
    expect(lobby.heroes.map((h) => [h.name, h.xp])).toEqual([['Ana', xp], ['Ben', 0]]);
    t.start('ana');
    const v = t.viewFor('screen');
    expect(v.scenarioName).toBe('Chapter 2: The Grey Abbey');
    expect(v.heroes.find((h) => h.id === a)).toMatchObject({ xp, gold });
    expect(v.heroes.find((h) => h.id === b)?.level).toBe(1);
  });

  it('starts over on a new campaign', () => {
    const t = table(3);
    const a = t.addHero('ana', 'Ana', 'knight');
    t.start('ana');
    winChapterOne(t, { [a]: 'ana' });
    expect(() => t.newCampaign('ana')).toThrow(/lobby/);
    t.toLobby('ana');
    t.newCampaign('ana');
    const v = t.viewFor('screen');
    expect(v.campaign.started).toBe(false);
    expect(v.scenarios.map((s) => s.id)).toEqual(['hollow-road-1']);
    expect(v.heroes[0].xp).toBe(0);
  });

  it('saves the campaign and loads it at another table, where phones claim the heroes', () => {
    const t = table(3);
    const a = t.addHero('ana', 'Ana', 'knight');
    t.addHero('ben', 'Ben', 'cleric');
    expect(t.save()).toBeUndefined();
    t.start('ana');
    const owners = Object.fromEntries(t.viewFor('screen').heroes.map((h) => [h.id, h.id === a ? 'ana' : 'ben']));
    winChapterOne(t, owners);
    const save = JSON.parse(JSON.stringify(t.save()));
    expect(save).toMatchObject({ format: 'otrpg-save', version: 1, pack: { id: 'core.hollow-road' }, scenarioId: 'hollow-road-2' });
    const before = t.viewFor('screen').heroes;

    const u = table(9);
    expect(() => t.loadSave('ana', save)).toThrow(/lobby/);
    u.loadSave('screen', save);
    const v = u.viewFor('ana') as ControllerView;
    expect(v.mine).toEqual([]);
    expect(v.campaign.started).toBe(true);
    expect(v.scenarioId).toBe('hollow-road-2');
    expect(v.heroes.map((h) => [h.name, h.level, h.xp, h.gold, h.items, h.claimable])).toEqual(before.map((h) => [h.name, h.level, h.xp, h.gold, h.items, true]));
    u.claimHero('ana', v.heroes[0].id);
    expect(() => u.claimHero('ben', v.heroes[0].id)).toThrow(/already/);
    u.claimHero('ben', v.heroes[1].id);
    expect((u.viewFor('ana') as ControllerView).mine).toEqual([v.heroes[0].id]);
    u.start('ana');
    expect(u.viewFor('screen').scenarioName).toBe('Chapter 2: The Grey Abbey');
  });

  it('turns away saves for other packs and drops what the pack does not know', () => {
    const t = table();
    const hero = { name: 'Zed', classId: 'rogue', level: 9, xp: 5, gold: -4, stats: { dex: 30 }, skills: ['stab', 'nope'], inventory: ['dagger', 'laser'], equipment: { weapon: 'lute' } };
    const save = { format: 'otrpg-save', version: 1, pack: { id: 'core.hollow-road' }, campaign: { party: [hero], flags: ['f'], unlocked: ['hollow-road-2', 'moon'], rngState: 5 } };
    expect(() => t.loadSave('ana', { ...save, pack: { id: 'other' } })).toThrow(/other/);
    expect(() => t.loadSave('ana', { hello: 1 })).toThrow(/isn't a campaign save/);
    expect(() => t.loadSave('ana', { ...save, campaign: { party: [{ ...hero, classId: 'dragon' }] } })).toThrow(/class/);
    expect(() => t.loadSave('nobody', save)).toThrow(/token/);
    t.loadSave('ana', save);
    const [zed] = t.viewFor('screen').heroes;
    expect(zed).toMatchObject({ level: 1, gold: 0, skills: ['Stab'], items: ['Dagger'] });
    expect(zed.stats.dex).toBe(30);
    expect(t.viewFor('screen').scenarios.map((s) => s.id)).toEqual(['hollow-road-2']);
  });

  it('lets a new phone take over a hero whose phone is gone', () => {
    const t = table();
    const a = t.addHero('ana', 'Ana', 'knight');
    expect(() => t.claimHero('ben', a)).toThrow(/already/);
    t.disconnect('ana');
    t.claimHero('ben', a);
    expect((t.viewFor('ben') as ControllerView).mine).toEqual([a]);
  });
});
