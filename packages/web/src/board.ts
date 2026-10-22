// Shared look of the combat grid, used by the PixiJS main screen board and
// the SVG board on phones.

import type { CombatView, Point, UnitView } from '@otrpg/server/view';

export type Terrain = CombatView['map']['terrain'][number];

export function terrainFor(view: CombatView, p: Point): Terrain | undefined {
  const symbol = view.map.tiles[p[1]]?.[p[0]] ?? '.';
  return view.map.terrain.find((t) => t.symbol === symbol);
}

/** Fill color for a square, picked from what the terrain does. */
export function terrainColor(t: Terrain | undefined): number {
  if (!t) return 0x3a3126;
  if (t.hazard) return 0x7a3b1d;
  if (t.moveCost < 0) return t.blocksSight ? 0x1b1814 : 0x5b5446;
  if (t.moveCost > 1) return t.defenseBonus > 0 ? 0x2f4a2b : 0x24465c;
  return 0x3a3126;
}

export const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

export const HERO_COLOR = 0xe0b453;
export const ENEMY_COLOR = 0xc8553d;
export const DOWN_COLOR = 0x6b6358;

export function unitColor(u: UnitView): number {
  if (u.down) return DOWN_COLOR;
  return u.side === 'hero' ? HERO_COLOR : ENEMY_COLOR;
}

/** Short token label: a hero's initial; an enemy's initials (two at most) plus its number. */
export function unitLabel(u: UnitView): string {
  const num = /\s(\d+)$/.exec(u.name)?.[1] ?? '';
  if (u.side === 'hero') return (u.name[0] ?? '?').toUpperCase();
  const words = u.name.replace(/\s\d+$/, '').split(/\s+/).slice(0, 2);
  return words.map((w) => w[0]?.toUpperCase() ?? '').join('') + num;
}

/** Chess-style square name, e.g. C4, for logs and screen readers. */
export function squareName(p: Point): string {
  return `${String.fromCharCode(65 + p[0])}${p[1] + 1}`;
}

export const samePoint = (a: Point, b: Point) => a[0] === b[0] && a[1] === b[1];
