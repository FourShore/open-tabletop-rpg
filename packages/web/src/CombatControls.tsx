// A phone's turn in a fight: pick Move or an ability, then tap a lit square.

import type { AbilityOption, ControllerView, Point } from '@otrpg/server/view';
import { useState } from 'react';
import { squareName } from './board';
import { GridSvg } from './GridSvg';

type Mode = { kind: 'move' } | { kind: 'skill' | 'item'; id: string } | undefined;

export function CombatControls({ view, act }: { view: ControllerView; act: (a: Record<string, unknown>) => void }) {
  const combat = view.combat!;
  const options = view.combatOptions ?? [];
  const [picked, setPicked] = useState<string>();
  const [mode, setMode] = useState<Mode>();
  // Default to the first hero who still has a move to make.
  const hero = options.find((o) => o.heroId === picked) ?? options.find((o) => !o.done && !o.down) ?? options[0];
  const unit = (id: string) => combat.units.find((u) => u.id === id);

  if (!hero) {
    return (
      <>
        <GridSvg view={combat} showIntents />
        <p className="muted">You're watching this fight.</p>
      </>
    );
  }
  const me = unit(hero.heroId);
  const ability: AbilityOption | undefined =
    mode?.kind === 'skill' ? hero.skills.find((s) => s.id === mode.id) : mode?.kind === 'item' ? hero.items.find((s) => s.id === mode.id) : undefined;
  const highlights = mode?.kind === 'move' ? hero.moveSquares : (ability?.targets ?? []);

  const send = (a: Record<string, unknown>) => {
    setMode(undefined);
    act({ playerId: hero.heroId, ...a });
  };
  const tap = (p: Point) => {
    if (mode?.kind === 'move') send({ type: 'move', to: p });
    else if (mode?.kind === 'skill') send({ type: 'useSkill', skillId: mode.id, target: p });
    else if (mode?.kind === 'item') send({ type: 'useItem', itemId: mode.id, target: p });
  };
  const choose = (kind: 'skill' | 'item', a: AbilityOption) => {
    // Abilities with no aim (self, everyone) go off right away.
    if (!a.targets.length) send(kind === 'skill' ? { type: 'useSkill', skillId: a.id } : { type: 'useItem', itemId: a.id });
    else setMode({ kind, id: a.id });
  };
  const active = combat.phase === 'heroes' && !hero.done && !hero.down;

  return (
    <div className="combat-controls">
      {options.length > 1 && (
        <div className="hero-tabs" role="tablist">
          {options.map((o) => (
            <button
              key={o.heroId}
              role="tab"
              aria-selected={o.heroId === hero.heroId}
              className={o.heroId === hero.heroId ? 'selected' : ''}
              onClick={() => (setPicked(o.heroId), setMode(undefined))}
            >
              {unit(o.heroId)?.name}
              <span className="muted small">{o.down ? ' down' : o.done ? ' done' : ` ${o.actionsLeft}`}</span>
            </button>
          ))}
        </div>
      )}
      <div className="combat-status">
        <b>{me?.name}</b>{' '}
        {combat.phase === 'enemies'
          ? 'The enemies are acting…'
          : hero.down
            ? 'is down. An ally can heal or revive you.'
            : hero.done
              ? 'has ended their turn. Waiting for the others.'
              : `· ${hero.actionsLeft} action${hero.actionsLeft === 1 ? '' : 's'} left`}
        <span className="muted small"> · Round {combat.round}</span>
      </div>
      <GridSvg
        view={combat}
        highlights={active ? highlights : []}
        highlightKind={mode?.kind === 'move' ? 'move' : ability?.heals ? 'heal' : 'target'}
        focus={[hero.heroId]}
        onTap={tap}
        showIntents
      />
      {active && (
        <>
          {mode ? (
            <div className="mode-hint">
              <span>
                {mode.kind === 'move' ? 'Tap a green square to move.' : `${ability?.name}: tap a lit target.`}
                {ability?.description && <span className="muted small"> {ability.description}</span>}
              </span>
              <button className="ghost" onClick={() => setMode(undefined)}>
                Cancel
              </button>
            </div>
          ) : (
            <div className="ability-grid">
              <button disabled={!hero.canMove} onClick={() => setMode({ kind: 'move' })}>
                Move
                <span className="muted small">{hero.canMove ? '1 action' : "can't move"}</span>
              </button>
              {hero.skills.map((s) => (
                <button key={s.id} disabled={!!s.blocked} onClick={() => choose('skill', s)} title={s.description}>
                  {s.name}
                  <span className="muted small">{s.blocked ?? `${s.cost === 0 ? 'free' : `${s.cost} action${s.cost === 1 ? '' : 's'}`} · ${s.target === 'self' || s.target.startsWith('all') ? 'no aim' : `range ${s.range}`}`}</span>
                </button>
              ))}
              {hero.items.map((s) => (
                <button key={s.id} disabled={!!s.blocked} onClick={() => choose('item', s)}>
                  {s.name} ×{s.count}
                  <span className="muted small">{s.blocked ?? 'use item'}</span>
                </button>
              ))}
              {hero.revive.map((id) => (
                <button key={id} onClick={() => send({ type: 'revive', targetId: id })}>
                  Revive {unit(id)?.name}
                  <span className="muted small">1 action · check</span>
                </button>
              ))}
            </div>
          )}
          <button className="primary" onClick={() => send({ type: 'endTurn' })}>
            End {me?.name}'s turn
          </button>
        </>
      )}
      <ul className="intents small" aria-label="Enemy intents">
        {combat.units
          .filter((u) => u.side === 'enemy')
          .map((u) => (
            <li key={u.id}>
              <b>{u.name}</b> <span className="muted">{squareName(u.pos)} · {u.hp} HP</span> {u.intent && <span className="intent">{u.intent.label}</span>}
            </li>
          ))}
      </ul>
    </div>
  );
}
