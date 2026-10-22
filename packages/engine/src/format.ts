// Human-readable lines for game events, shared by the CLI and the server's
// log. Returns null for events that aren't worth a line of their own.

import type { GameEvent, GameState } from './game';
import { describeTile } from './leveling';
import { text, type PackIndex } from './pack';

export interface FormatOptions {
  /** Show the numbers of secret checks (only for the roller's own controller). */
  revealSecret?: boolean;
  /**
   * Names of combat units seen so far (from `unitSpawned` events). The fight is
   * gone from the state by the time its last events are described.
   */
  names?: Map<string, string>;
}

export function describeEvent(index: PackIndex, state: GameState, e: GameEvent, opts: FormatOptions = {}): string | null {
  const nameOf = (id: string) =>
    state.party.find((p) => p.id === id)?.name ?? state.combat?.units.find((u) => u.id === id)?.name ?? opts.names?.get(id) ?? id;
  const who = 'playerId' in e ? nameOf(e.playerId) : 'unitId' in e ? nameOf(e.unitId) : '';
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
    case 'roundStarted':
      return `Round ${e.round}. Heroes, your move.`;
    case 'enemyPhase':
      return 'The enemies act.';
    case 'unitSpawned':
      return state.combat && state.combat.round > 1 ? `${e.name} joins the fight!` : null;
    case 'unitMoved':
      return null;
    case 'skillUsed':
      return `${who} uses ${e.name}${e.targets.length === 1 && e.targets[0] !== e.unitId ? ` on ${nameOf(e.targets[0])}` : e.targets.length > 1 ? ` (${e.targets.length} targets)` : ''}.`;
    case 'itemUsed':
      return `${who} uses ${e.name}.`;
    case 'attackRolled':
      return `${who} attacks ${nameOf(e.targetId)}: ${e.natural} on the die, ${e.total} vs defense ${e.defense}. ${e.critical ? 'Critical hit!' : e.hit ? 'Hit.' : 'Miss.'}`;
    case 'saveRolled':
      return `${who} saves: ${e.total} vs DC ${e.dc}. ${e.saved ? 'Saved.' : 'Failed.'}`;
    case 'unitDamaged':
      return `${who} takes ${e.amount}${e.damageType ? ` ${e.damageType}` : ''} damage (${e.hp} HP left).`;
    case 'unitHealed':
      return e.amount ? `${who} heals ${e.amount} (${e.hp} HP).` : null;
    case 'unitCondition':
      return e.on ? `${who} is ${e.condition}${e.duration ? ` for ${e.duration} round${e.duration === 1 ? '' : 's'}` : ''}.` : `${who} is no longer ${e.condition}.`;
    case 'unitDown':
      return `${who} is down!`;
    case 'unitDied':
      return `${who} is defeated.`;
    case 'revived':
      return e.success ? `${nameOf(e.byId)} gets ${who} back on their feet (${e.total} vs DC ${e.dc}).` : `${nameOf(e.byId)} fails to revive ${who} (${e.total} vs DC ${e.dc}).`;
    case 'turnEnded':
      return null;
    case 'turnSkipped':
      return `${who} loses their turn.`;
    case 'scenarioEnded':
      return e.result === 'victory' ? `Scenario complete!${e.unlocked.length ? ` Unlocked: ${e.unlocked.map((id) => text(index.scenarios.get(id)?.name) || id).join(', ')}.` : ''}` : 'The party has fallen. Scenario failed.';
  }
}
