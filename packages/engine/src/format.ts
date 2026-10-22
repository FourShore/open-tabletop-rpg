// Human-readable lines for game events, shared by the CLI and the server's
// log. Returns null for events that aren't worth a line of their own.

import type { GameEvent, GameState } from './game';
import { describeTile } from './leveling';
import { text, type PackIndex } from './pack';

export interface FormatOptions {
  /** Show the numbers of secret checks (only for the roller's own controller). */
  revealSecret?: boolean;
}

export function describeEvent(index: PackIndex, state: GameState, e: GameEvent, opts: FormatOptions = {}): string | null {
  const who = 'playerId' in e ? (state.party.find((p) => p.id === e.playerId)?.name ?? e.playerId) : '';
  const itemName = (id: string) => text(index.items.get(id)?.name) || id;
  switch (e.type) {
    case 'scenarioStarted':
      return `${e.name} begins.`;
    case 'cardRevealed':
      return `Card: ${e.title}`;
    case 'cardSkipped':
      return null;
    case 'narrate':
      return e.text;
    case 'checkRolled':
      if (e.secret && !opts.revealSecret) return `${who} rolls ${e.stat.toUpperCase()} in secret.`;
      return `${who} rolls ${e.stat.toUpperCase()}: ${e.natural} on the die, ${e.total} vs DC ${e.dc}. ${e.critical ? 'Critical success!' : e.fumble ? 'Fumble!' : e.success ? 'Success.' : 'Failure.'}`;
    case 'checkResolved':
      return e.mode === 'group' ? `The group check ${e.success ? 'succeeds' : 'fails'}.` : null;
    case 'voteCast':
      return null;
    case 'voteResolved':
      return `The party chooses: ${e.label}`;
    case 'voteSplit':
      return 'The vote is split. Vote again.';
    case 'damaged':
      return `${who} takes ${e.amount} damage (${e.hp} HP left).`;
    case 'healed':
      return e.amount ? `${who} heals ${e.amount} (${e.hp} HP).` : null;
    case 'conditionAdded':
      return `${who} is ${e.condition}${e.duration ? ` for ${e.duration} cards` : ''}.`;
    case 'conditionRemoved':
      return `${who} is no longer ${e.condition}.`;
    case 'statChanged':
      return `${who} ${e.amount >= 0 ? 'gains' : 'loses'} ${Math.abs(e.amount)} ${e.stat.toUpperCase()}.`;
    case 'gained': {
      const parts = [e.xp && `${e.xp} XP`, e.gold && `${e.gold} gold`, e.item && itemName(e.item), e.skill && (text(index.skills.get(e.skill)?.name) || e.skill)].filter(Boolean);
      return parts.length ? `${who} gains ${parts.join(', ')}.` : null;
    }
    case 'lost': {
      const parts = [e.gold && `${e.gold} gold`, e.item && itemName(e.item)].filter(Boolean);
      return parts.length ? `${who} loses ${parts.join(', ')}.` : null;
    }
    case 'flagSet':
    case 'deckChanged':
      return null;
    case 'combatStarted':
      return `Combat! ${e.enemies.map((x) => `${x.count} ${text(index.pack.enemies?.find((en) => en.id === x.enemy)?.name) || x.enemy}`).join(', ')}.`;
    case 'combatEnded':
      return e.victory ? 'Victory!' : 'Defeat...';
    case 'bought':
      return `${who} buys ${itemName(e.itemId)} for ${e.price} gold.`;
    case 'levelUpOffered':
      return `${who} reaches level ${e.level}!`;
    case 'tilesRerolled':
      return `${who} ${e.gold ? `pays ${e.gold} gold to reroll` : 'rerolls'} the level-up tiles.`;
    case 'leveledUp':
      return `${who} is now level ${e.level}: ${describeTile(index, e.tile)}${e.stat ? ` (${e.stat.toUpperCase()})` : ''}.`;
    case 'scenarioEnded':
      return e.result === 'victory' ? `Scenario complete!${e.unlocked.length ? ` Unlocked: ${e.unlocked.map((id) => text(index.scenarios.get(id)?.name) || id).join(', ')}.` : ''}` : 'The party has fallen. Scenario failed.';
  }
}
