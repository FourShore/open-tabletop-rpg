// The main screen's combat board, drawn with PixiJS so tokens can glide
// between squares. If WebGL isn't available it reports failure and the
// screen falls back to the SVG grid.

import type { CombatView, UnitView } from '@otrpg/server/view';
import { Application, Assets, Container, Graphics, Sprite, Text, type Texture } from 'pixi.js';
import { useEffect, useRef, useState } from 'react';
import { ENEMY_COLOR, terrainColor, terrainFor, unitColor, unitLabel } from './board';

interface Token {
  root: Container;
  disc: Graphics;
  label: Text;
  hp: Graphics;
  target: { x: number; y: number };
  sprite?: Sprite;
}

export function PixiBoard({ view, onFail }: { view: CombatView; onFail: () => void }) {
  const host = useRef<HTMLDivElement>(null);
  const app = useRef<Application | undefined>(undefined);
  const layers = useRef<{ terrain: Container; intents: Graphics; units: Container } | undefined>(undefined);
  const tokens = useRef(new Map<string, Token>());
  const [ready, setReady] = useState(false);
  const [cell, setCell] = useState(48);

  // Create the renderer once.
  useEffect(() => {
    let cancelled = false;
    let started = false;
    const a = new Application();
    a.init({ backgroundAlpha: 0, antialias: true, width: 10, height: 10, preference: 'webgl', autoDensity: true, resolution: window.devicePixelRatio || 1 })
      .then(() => {
        started = true;
        if (cancelled) return a.destroy(true, { children: true });
        host.current!.appendChild(a.canvas);
        const terrain = new Container();
        const intents = new Graphics();
        const units = new Container();
        a.stage.addChild(terrain, intents, units);
        layers.current = { terrain, intents, units };
        app.current = a;
        // Glide tokens toward their squares.
        a.ticker.add((t) => {
          const k = Math.min(1, 0.18 * t.deltaTime);
          for (const tok of tokens.current.values()) {
            tok.root.x += (tok.target.x - tok.root.x) * k;
            tok.root.y += (tok.target.y - tok.root.y) * k;
          }
        });
        setReady(true);
      })
      .catch(() => {
        if (!cancelled) onFail();
      });
    return () => {
      cancelled = true;
      if (started) a.destroy(true, { children: true });
      app.current = undefined;
      layers.current = undefined;
      tokens.current.clear();
    };
  }, [onFail]);

  // Fit the board to the space it has.
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const fit = () => {
      const w = el.clientWidth;
      const h = Math.max(240, window.innerHeight * 0.7);
      setCell(Math.max(16, Math.floor(Math.min(w / view.map.width, h / view.map.height))));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [view.map.width, view.map.height]);

  // Terrain: redrawn when the map or the cell size changes.
  useEffect(() => {
    const a = app.current;
    const l = layers.current;
    if (!ready || !a || !l) return;
    a.renderer.resize(view.map.width * cell, view.map.height * cell);
    l.terrain.removeChildren().forEach((c) => c.destroy());
    const g = new Graphics();
    for (let y = 0; y < view.map.height; y++) {
      for (let x = 0; x < view.map.width; x++) {
        g.rect(x * cell, y * cell, cell, cell).fill(terrainColor(terrainFor(view, [x, y])));
      }
    }
    for (let x = 0; x <= view.map.width; x++) g.moveTo(x * cell, 0).lineTo(x * cell, view.map.height * cell);
    for (let y = 0; y <= view.map.height; y++) g.moveTo(0, y * cell).lineTo(view.map.width * cell, y * cell);
    g.stroke({ width: 1, color: 0x000000, alpha: 0.35 });
    for (const [x, y] of view.map.exits) g.rect(x * cell + 3, y * cell + 3, cell - 6, cell - 6).stroke({ width: 2, color: 0xe0b453, alpha: 0.6 });
    l.terrain.addChild(g);
    if (view.map.background) {
      Assets.load<Texture>(view.map.background)
        .then((tex) => {
          if (!layers.current || l.terrain.destroyed) return;
          const bg = new Sprite(tex);
          bg.width = view.map.width * cell;
          bg.height = view.map.height * cell;
          bg.alpha = 0.85;
          l.terrain.addChildAt(bg, 0);
        })
        .catch(() => undefined);
    }
    // Tokens need re-laying out at the new size.
    for (const t of tokens.current.values()) t.root.destroy({ children: true });
    tokens.current.clear();
  }, [ready, cell, view.map]);

  // Units and intents: every update.
  useEffect(() => {
    const l = layers.current;
    if (!ready || !l) return;
    const seen = new Set<string>();
    for (const u of view.units) {
      seen.add(u.id);
      let tok = tokens.current.get(u.id);
      const target = { x: (u.pos[0] + 0.5) * cell, y: (u.pos[1] + 0.5) * cell };
      if (!tok) {
        tok = makeToken(u, cell, target);
        tokens.current.set(u.id, tok);
        l.units.addChild(tok.root);
      }
      tok.target = target;
      paintToken(tok, u, cell);
    }
    for (const [id, tok] of tokens.current) {
      if (seen.has(id)) continue;
      tok.root.destroy({ children: true });
      tokens.current.delete(id);
    }
    l.intents.clear();
    for (const u of view.units) {
      const t = u.side === 'enemy' && u.intent?.targetId ? view.units.find((x) => x.id === u.intent!.targetId) : undefined;
      if (!t || t.id === u.id) continue;
      l.intents.moveTo((u.pos[0] + 0.5) * cell, (u.pos[1] + 0.5) * cell).lineTo((t.pos[0] + 0.5) * cell, (t.pos[1] + 0.5) * cell);
    }
    l.intents.stroke({ width: Math.max(2, cell / 16), color: ENEMY_COLOR, alpha: 0.5 });
  }, [ready, cell, view.units]);

  return <div className="pixi-board" ref={host} aria-hidden="true" />;
}

function makeToken(u: UnitView, cell: number, at: { x: number; y: number }): Token {
  const root = new Container();
  root.x = at.x;
  root.y = at.y;
  const disc = new Graphics();
  const label = new Text({ text: '', style: { fill: 0x1d160b, fontWeight: '700', fontFamily: 'system-ui, sans-serif', fontSize: 12 } });
  label.anchor.set(0.5);
  const hp = new Graphics();
  root.addChild(disc, label, hp);
  const tok: Token = { root, disc, label, hp, target: at };
  if (u.token) {
    Assets.load<Texture>(u.token)
      .then((tex) => {
        if (root.destroyed) return;
        const s = new Sprite(tex);
        s.anchor.set(0.5);
        s.width = s.height = cell * 0.8;
        root.addChildAt(s, 1);
        tok.sprite = s;
        label.visible = false;
      })
      .catch(() => undefined);
  }
  return tok;
}

function paintToken(tok: Token, u: UnitView, cell: number) {
  const r = cell * 0.4;
  tok.disc.clear().circle(0, 0, r).fill(unitColor(u)).stroke({ width: Math.max(1.5, cell / 24), color: 0x000000, alpha: 0.6 });
  tok.label.text = unitLabel(u);
  tok.label.style.fontSize = Math.round(cell * (u.side === 'hero' ? 0.42 : 0.3));
  if (tok.sprite) tok.sprite.alpha = u.down ? 0.4 : 1;
  const w = cell * 0.8;
  const frac = Math.max(0, u.hp / Math.max(1, u.maxHp));
  tok.hp
    .clear()
    .rect(-w / 2, r - 2, w, Math.max(3, cell / 12))
    .fill({ color: 0x000000, alpha: 0.6 })
    .rect(-w / 2, r - 2, w * frac, Math.max(3, cell / 12))
    .fill(frac <= 0.3 ? 0xc8553d : 0x6fa66b);
}
