// Text playthrough of a scenario. Interactive by default; --auto plays itself.
//
//   npm run play -- --players "Ana:knight,Ben:wizard,Cy:cleric" --seed 7
//   npm run play -- --auto --seed 42
//   npm run play -- --pack path/to/pack.json --scenario some-scenario

import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { act, GameError, newGame, startScenario, type Action, type GameEvent, type GameState, type PlayerSpec } from '../game';
import { describeEvent } from '../format';
import { describeTile } from '../leveling';
import { loadPackFromDisk } from '../node';
import { indexPack, text } from '../pack';
import { createRng, seedFromString } from '../rng';
import { maxHp } from '../character';
import { validatePack } from '../validate';

const args = parseArgs(process.argv.slice(2));
const defaultPack = fileURLToPath(new URL('../../../../spec/example-pack/pack.json', import.meta.url));
const pack = await loadPackFromDisk(String(args.pack ?? defaultPack));
const issues = validatePack(pack);
if (issues.length) {
  for (const i of issues) console.error(`${i.kind} ${i.path}: ${i.message}`);
  process.exit(1);
}
const index = indexPack(pack);
const seed = args.seed !== undefined ? (Number(args.seed) || seedFromString(String(args.seed))) : Date.now() >>> 0;
const auto = Boolean(args.auto);
const autoRng = createRng(seed ^ 0x5eed);
const players: PlayerSpec[] = String(args.players ?? 'Ana:knight,Ben:wizard,Cy:cleric')
  .split(',')
  .map((p, i) => {
    const [name, classId] = p.split(':').map((x) => x.trim());
    return { id: `p${i + 1}`, name, classId: classId ?? 'knight' };
  });
const scenarioId = String(args.scenario ?? pack.campaign?.startScenarios?.[0] ?? pack.scenarios?.[0]?.id);

const rl = auto ? null : createInterface({ input: process.stdin, output: process.stdout });

let state = newGame(index, { seed, players });
console.log(`\n${pack.name} - seed ${seed}${auto ? ' (auto)' : ''}`);
let step = startScenario(index, state, scenarioId);
state = step.state;
print(step.events, state);

while (state.phase === 'playing' || state.pending) {
  const action = await decide(state);
  try {
    step = act(index, state, action);
    state = step.state;
    print(step.events, state);
  } catch (e) {
    if (!(e instanceof GameError) || auto) throw e;
    console.log(`  ! ${e.message}`);
  }
}
printParty(state);
rl?.close();

// ---------- decisions ----------

async function decide(s: GameState): Promise<Action> {
  const p = s.pending;
  if (!p) {
    if (!auto) await rl!.question('\n[enter] flip the next card ');
    return { type: 'next' };
  }
  switch (p.kind) {
    case 'vote': {
      const voter = s.party.find((m) => !(m.id in p.votes))!;
      const enabled = p.options.map((o, i) => ({ ...o, i })).filter((o) => o.enabled);
      const option = await choose(`${voter.name}, vote:`, enabled.map((o) => o.label), (n) => enabled[n].i);
      return { type: 'vote', playerId: voter.id, option };
    }
    case 'chooseRoller': {
      const alive = s.party.filter((m) => m.hp > 0);
      const playerId = await choose(`Who rolls ${p.stats.join('/')} vs DC ${p.check.dc}?`, alive.map((m) => `${m.name} (${m.classId})`), (n) => alive[n].id);
      return { type: 'chooseRoller', playerId };
    }
    case 'combat': {
      const desc = p.enemies.map((e) => `${e.count} x ${e.enemy}${e.round ? ` (round ${e.round})` : ''}`).join(', ');
      console.log(`  Grid combat isn't built yet. Enemies: ${desc}`);
      const victory = await choose('How did the fight go?', ['Victory', 'Defeat'], (n) => n === 0, 0.9);
      return { type: 'resolveCombat', victory };
    }
    case 'shop': {
      const items = p.stock.filter((e) => e.qty > 0);
      const labels = [...items.map((e) => `${text(index.items.get(e.itemId)?.name)} - ${e.price} gold (${e.qty} left)`), 'Leave'];
      const pick = await choose('Shop:', labels, (n) => n);
      if (pick === items.length) return { type: 'leaveShop' };
      const buyer = s.party.reduce((a, b) => (b.gold > a.gold ? b : a));
      if (buyer.gold < items[pick].price) return { type: 'leaveShop' };
      return { type: 'buy', playerId: buyer.id, itemId: items[pick].itemId };
    }
    case 'levelUp': {
      const ch = s.party.find((m) => m.id === p.playerId)!;
      const labels = p.tiles.map((t) => describeTile(index, t));
      const price = p.freeRerolls > 0 ? 0 : p.rerollCost;
      const canReroll = price !== undefined && ch.gold >= price;
      if (canReroll) labels.push(price ? `Reroll for ${price} gold (you have ${ch.gold})` : 'Reroll (free)');
      const idx = await choose(`${ch.name} reaches level ${p.level}. Pick a tile:`, labels, (n) => n);
      if (idx === p.tiles.length) return { type: 'rerollTiles', playerId: ch.id };
      const tile = p.tiles[idx];
      let stat: string | undefined;
      if (tile.kind === 'anyStat') stat = await choose('Which stat?', index.abilityStats, (n) => index.abilityStats[n]);
      return { type: 'pickTile', playerId: p.playerId, index: idx, stat };
    }
  }
}

/** Ask for a numbered choice, or pick one at random in --auto mode. */
async function choose<T>(prompt: string, labels: string[], map: (n: number) => T, firstBias?: number): Promise<T> {
  if (auto) {
    const n = firstBias !== undefined ? (autoRng.next() < firstBias ? 0 : 1) : autoRng.int(labels.length);
    console.log(`  ${prompt} -> ${labels[n]}`);
    return map(n);
  }
  labels.forEach((l, i) => console.log(`    ${i + 1}. ${l}`));
  for (;;) {
    const n = Number(await rl!.question(`  ${prompt} `)) - 1;
    if (Number.isInteger(n) && n >= 0 && n < labels.length) return map(n);
  }
}

// ---------- output ----------

function print(events: GameEvent[], s: GameState) {
  for (const e of events) {
    if (e.type === 'scenarioStarted') {
      console.log(`\n== ${e.name} ==\n${e.intro}`);
      printParty(s);
    } else if (e.type === 'cardRevealed') {
      console.log(`\n--- ${e.title} [${e.cardType}] ---${e.text ? `\n${e.text}` : ''}`);
    } else if (e.type === 'scenarioEnded') {
      console.log(`\n== ${describeEvent(index, s, e)} ==`);
    } else {
      // The CLI is one shared screen, so secret rolls are shown.
      const line = describeEvent(index, s, e, { revealSecret: true });
      if (line) console.log(`  ${line}`);
    }
  }
}

function printParty(s: GameState) {
  for (const ch of s.party) {
    const stats = index.abilityStats.map((k) => `${k.toUpperCase()} ${ch.stats[k]}`).join(' ');
    console.log(`  ${ch.name} the ${ch.classId}, lv ${ch.level}, ${ch.hp}/${maxHp(index, ch)} HP, ${ch.xp} XP, ${ch.gold} gold | ${stats}`);
  }
}

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[a.slice(2)] = true;
    else out[a.slice(2)] = argv[++i];
  }
  return out;
}

