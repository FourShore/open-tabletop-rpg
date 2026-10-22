// The fight on the main screen: the board in the middle, and beside it who
// is still to move and what each enemy is about to do.

import type { CombatView, PublicView } from '@otrpg/server/view';
import { lazy, Suspense, useCallback, useState } from 'react';
import { squareName } from './board';
import { GridSvg } from './GridSvg';
import { HpBar } from './parts';

// PixiJS is only needed on the main screen, so phones never download it.
const PixiBoard = lazy(() => import('./PixiBoard').then((m) => ({ default: m.PixiBoard })));

export function CombatStage({ view, combat }: { view: PublicView; combat: CombatView }) {
  const [svg, setSvg] = useState(false);
  const fail = useCallback(() => setSvg(true), []);
  return (
    <div className="combat-stage">
      <div className="combat-head">
        <div>
          <div className="card-type">{view.card?.title ?? 'Combat'}</div>
          <h2>
            Round {combat.round} · {combat.phase === 'heroes' ? 'Heroes act' : 'Enemies act'}
          </h2>
        </div>
        <div className="muted">{combat.objective}</div>
      </div>
      <div className="board-wrap">
        {svg ? (
          <GridSvg view={combat} showIntents />
        ) : (
          <Suspense fallback={<GridSvg view={combat} showIntents />}>
            <PixiBoard view={combat} onFail={fail} />
          </Suspense>
        )}
      </div>
    </div>
  );
}

/** Who is still to move and what each enemy is about to do, beside the board. */
export function CombatLists({ combat }: { combat: CombatView }) {
  const heroes = combat.units.filter((u) => u.side === 'hero');
  const enemies = combat.units.filter((u) => u.side === 'enemy');
  return (
    <div className="combat-lists">
      <ul className="units" aria-label="Heroes">
        {heroes.map((u) => (
          <li key={u.id} data-unit={u.name} data-square={squareName(u.pos)} className={u.down ? 'down' : u.done ? 'done' : 'active'}>
            <span>
              <b>{u.name}</b> <span className="muted small">{squareName(u.pos)}</span>
            </span>
            <span className="small">{u.down ? 'Down' : u.done ? 'Done' : `${u.actionsLeft} action${u.actionsLeft === 1 ? '' : 's'}`}</span>
            <HpBar hp={u.hp} max={u.maxHp} />
            {u.conditions.length > 0 && <span className="muted small">{u.conditions.join(', ')}</span>}
          </li>
        ))}
      </ul>
      <ul className="units enemies" aria-label="Enemies">
        {enemies.map((u) => (
          <li key={u.id} data-unit={u.name} data-square={squareName(u.pos)}>
            <span>
              <b>{u.name}</b> <span className="muted small">{squareName(u.pos)}</span>
            </span>
            {u.intent && <span className="intent small">{u.intent.label}</span>}
            <HpBar hp={u.hp} max={u.maxHp} />
            {u.conditions.length > 0 && <span className="muted small">{u.conditions.join(', ')}</span>}
          </li>
        ))}
        {combat.reinforcements.map((r, i) => (
          <li key={`r${i}`} className="muted small">
            {r.count} × {r.name} arrive in round {r.round}
          </li>
        ))}
      </ul>
    </div>
  );
}
