// Campaign save files. There are no accounts, so a campaign lives in a small
// JSON file the group keeps (the main screen also remembers the latest one).
// A save is untrusted input: everything in it is checked against the pack and
// anything the pack doesn't know is dropped.

import { createCharacter, levelForXp, maxHp, type Character, type GameState, type PackIndex } from '@otrpg/engine';
import { MAX_HEROES } from './limits';

export const SAVE_FORMAT = 'otrpg-save';
export const SAVE_VERSION = 1;

export interface CampaignSave {
  format: typeof SAVE_FORMAT;
  version: typeof SAVE_VERSION;
  pack: { id: string; version: string };
  savedAt: string;
  /** The scenario the group was about to play. */
  scenarioId: string;
  campaign: {
    party: Character[];
    flags: string[];
    unlocked: string[];
    rngState: number;
  };
}

export interface LoadedCampaign {
  party: Character[];
  flags: string[];
  unlocked: string[];
  rngState: number;
  scenarioId?: string;
}

export function writeSave(index: PackIndex, state: GameState, scenarioId: string): CampaignSave {
  return {
    format: SAVE_FORMAT,
    version: SAVE_VERSION,
    pack: { id: index.pack.id, version: index.pack.version },
    savedAt: new Date().toISOString(),
    scenarioId,
    campaign: {
      // Conditions and HP are left as they are; the next scenario applies the pack's rules.
      party: structuredClone(state.party),
      flags: [...state.flags],
      unlocked: [...state.unlocked],
      rngState: state.rngState,
    },
  };
}

/** Check a save against the pack. Throws an Error with a message for players when it can't be used. */
export function readSave(index: PackIndex, data: unknown): LoadedCampaign {
  if (!isRecord(data) || data.format !== SAVE_FORMAT) throw new Error("That file isn't a campaign save");
  if (data.version !== SAVE_VERSION) throw new Error(`This save is from a newer version (${String(data.version)})`);
  const pack = isRecord(data.pack) ? data.pack : {};
  if (pack.id !== index.pack.id) throw new Error(`This save is for the pack '${String(pack.id)}', not '${index.pack.id}'`);
  const c = isRecord(data.campaign) ? data.campaign : {};
  if (!Array.isArray(c.party) || !c.party.length) throw new Error('The save has no heroes');
  if (c.party.length > MAX_HEROES) throw new Error(`The save has more than ${MAX_HEROES} heroes`);
  const party = c.party.map((raw, i) => readCharacter(index, raw, i));
  const names = new Set(party.map((ch) => ch.name.toLowerCase()));
  if (names.size !== party.length) throw new Error('Two heroes in the save share a name');
  const scenarios = new Set((index.pack.scenarios ?? []).map((s) => s.id));
  const unlocked = strings(c.unlocked).filter((id) => scenarios.has(id));
  return {
    party,
    flags: strings(c.flags),
    unlocked: unlocked.length ? unlocked : [...(index.pack.campaign?.startScenarios ?? [])],
    rngState: typeof c.rngState === 'number' && Number.isFinite(c.rngState) ? c.rngState >>> 0 : 1,
    scenarioId: typeof data.scenarioId === 'string' ? data.scenarioId : undefined,
  };
}

function readCharacter(index: PackIndex, raw: unknown, i: number): Character {
  if (!isRecord(raw)) throw new Error(`Hero ${i + 1} in the save is broken`);
  const name = typeof raw.name === 'string' ? raw.name.trim().slice(0, 24) : '';
  if (!name) throw new Error(`Hero ${i + 1} in the save has no name`);
  if (typeof raw.classId !== 'string' || !index.classes.has(raw.classId)) throw new Error(`${name}'s class isn't in this pack`);
  // Start from a new hero of the class, then lay the saved progress over it.
  const ch = createCharacter(index, { id: `save${i}`, name, classId: raw.classId });
  const maxLevel = index.pack.rules?.leveling?.maxLevel ?? 20;
  ch.xp = count(raw.xp, ch.xp);
  // A level can't run ahead of the XP that earns it.
  const earned = Math.max(levelForXp(index, ch.xp), index.pack.campaign?.startingLevel ?? 1);
  ch.level = Math.max(1, Math.min(count(raw.level, ch.level), earned, maxLevel));
  ch.gold = count(raw.gold, ch.gold);
  ch.hpBonus = int(raw.hpBonus, 0);
  if (isRecord(raw.stats)) for (const k of index.abilityStats) ch.stats[k] = int(raw.stats[k], ch.stats[k]);
  if (Array.isArray(raw.skills)) ch.skills = [...new Set(strings(raw.skills).filter((id) => index.skills.has(id)))];
  if (Array.isArray(raw.inventory)) ch.inventory = strings(raw.inventory).filter((id) => index.items.has(id));
  if (isRecord(raw.equipment)) {
    ch.equipment = {};
    for (const [slot, id] of Object.entries(raw.equipment)) {
      const item = typeof id === 'string' ? index.items.get(id) : undefined;
      if (item?.kind === 'equipment' && item.slot === slot && (!item.classes || item.classes.includes(ch.classId))) ch.equipment[slot] = item.id;
    }
  }
  if (Array.isArray(raw.conditions)) {
    ch.conditions = raw.conditions
      .filter((x): x is Record<string, unknown> => isRecord(x) && typeof x.id === 'string' && index.conditions.has(x.id))
      .map((x) => ({ id: x.id as string, remaining: typeof x.remaining === 'number' ? count(x.remaining, 1) : undefined, per: x.per === 'round' ? 'round' : undefined }));
  }
  ch.hp = Math.min(maxHp(index, ch), count(raw.hp, maxHp(index, ch)));
  return ch;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length <= 100) : [];
}

function int(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : fallback;
}

/** A whole number of at least 0. */
function count(v: unknown, fallback: number): number {
  return Math.max(0, int(v, fallback));
}
