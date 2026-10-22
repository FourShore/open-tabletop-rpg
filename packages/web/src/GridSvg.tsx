// The combat grid as SVG: the phone's tappable board, and the main screen's
// fallback when WebGL isn't available.

import type { CombatView, Point } from '@otrpg/server/view';
import type { ReactElement } from 'react';
import { hex, samePoint, squareName, terrainColor, terrainFor, unitColor, unitLabel } from './board';

export interface GridProps {
  view: CombatView;
  /** Squares to light up as choices. */
  highlights?: Point[];
  highlightKind?: 'move' | 'target' | 'heal';
  /** Units to ring, e.g. the hero being controlled. */
  focus?: string[];
  onTap?: (p: Point) => void;
  /** Draw lines from enemies to the heroes they intend to hit. */
  showIntents?: boolean;
}

const HIGHLIGHT = { move: '#6fa66b', target: '#c8553d', heal: '#7fb6e0' };

export function GridSvg({ view, highlights = [], highlightKind = 'move', focus = [], onTap, showIntents }: GridProps) {
  const { width, height } = view.map;
  const cells: ReactElement[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p: Point = [x, y];
      const lit = highlights.some((h) => samePoint(h, p));
      const t = terrainFor(view, p);
      const unit = view.units.find((u) => samePoint(u.pos, p));
      cells.push(
        <rect
          key={`${x},${y}`}
          x={x}
          y={y}
          width={1}
          height={1}
          fill={hex(terrainColor(t))}
          stroke="#00000055"
          strokeWidth={0.03}
          className={lit ? 'cell lit' : 'cell'}
          data-square={squareName(p)}
          onClick={lit && onTap ? () => onTap(p) : undefined}
        >
          <title>
            {squareName(p)}
            {t && t.symbol !== '.' ? ` · ${t.name}` : ''}
            {unit ? ` · ${unit.name}` : ''}
          </title>
        </rect>,
      );
      if (lit) {
        cells.push(
          <rect
            key={`h${x},${y}`}
            x={x + 0.06}
            y={y + 0.06}
            width={0.88}
            height={0.88}
            rx={0.12}
            fill={HIGHLIGHT[highlightKind]}
            fillOpacity={unit ? 0.25 : 0.35}
            stroke={HIGHLIGHT[highlightKind]}
            strokeWidth={0.06}
            pointerEvents="none"
          />,
        );
      }
    }
  }
  const unitAt = (id?: string) => view.units.find((u) => u.id === id);
  return (
    <svg className="grid-svg" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${view.map.name}, round ${view.round}`}>
      {cells}
      {view.map.exits.map((e) => (
        <text key={`x${e[0]},${e[1]}`} x={e[0] + 0.5} y={e[1] + 0.62} fontSize={0.35} textAnchor="middle" fill="#e0b45399" pointerEvents="none">
          EXIT
        </text>
      ))}
      {showIntents &&
        view.units
          .filter((u) => u.side === 'enemy' && u.intent?.targetId && u.intent.targetId !== u.id)
          .map((u) => {
            const t = unitAt(u.intent!.targetId);
            if (!t) return null;
            return (
              <line
                key={`i${u.id}`}
                x1={u.pos[0] + 0.5}
                y1={u.pos[1] + 0.5}
                x2={t.pos[0] + 0.5}
                y2={t.pos[1] + 0.5}
                stroke="#c8553d"
                strokeOpacity={0.55}
                strokeWidth={0.06}
                strokeDasharray="0.15 0.12"
                pointerEvents="none"
              />
            );
          })}
      {view.units.map((u) => {
        const lit = highlights.some((h) => samePoint(h, u.pos));
        return (
          <g
            key={u.id}
            transform={`translate(${u.pos[0] + 0.5} ${u.pos[1] + 0.5})`}
            className="token"
            data-unit={u.name}
            data-square={squareName(u.pos)}
            onClick={lit && onTap ? () => onTap(u.pos) : undefined}
            style={{ cursor: lit && onTap ? 'pointer' : undefined }}
          >
            <circle r={0.4} fill={hex(unitColor(u))} stroke={focus.includes(u.id) ? '#ffffff' : '#000000aa'} strokeWidth={focus.includes(u.id) ? 0.08 : 0.04} />
            <text y={0.12} fontSize={u.side === 'hero' ? 0.42 : 0.3} textAnchor="middle" fill="#1d160b" fontWeight={700} pointerEvents="none">
              {unitLabel(u)}
            </text>
            <rect x={-0.4} y={0.36} width={0.8} height={0.09} fill="#00000099" pointerEvents="none" />
            <rect x={-0.4} y={0.36} width={0.8 * Math.max(0, u.hp / Math.max(1, u.maxHp))} height={0.09} fill={u.hp / u.maxHp <= 0.3 ? '#c8553d' : '#6fa66b'} pointerEvents="none" />
          </g>
        );
      })}
    </svg>
  );
}
