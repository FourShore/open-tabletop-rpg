// The pack editor: open a pack, edit any entry as JSON with the validator
// running as you type, preview cards and maps, then download the pack or
// playtest it at a new table. The draft is kept in this browser.

import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { hex, terrainColor } from './board';
import { createTable, TableRefused } from './net';
import { check, loadPackUrl, type PackIssue } from './packs';
import { navigate } from './router';

type Json = Record<string, unknown>;
type Pack = Json;

const DRAFT_KEY = 'otrpg.editor.draft';
const META_KEYS = ['spec', 'id', 'name', 'version', 'description', 'authors', 'license'];

interface Section {
  key: string;
  label: string;
  /** An object edited in one piece, rather than a list of entries. */
  whole?: boolean;
  /** A new entry's starting point. */
  template?: (n: number) => Json;
}

const SECTIONS: Section[] = [
  { key: '_meta', label: 'Pack', whole: true },
  { key: 'scenarios', label: 'Scenarios', template: (n) => ({ id: `scenario-${n}`, name: 'New scenario', deck: [] }) },
  { key: 'cards', label: 'Cards', template: (n) => ({ id: `card-${n}`, type: 'story', title: 'New card', text: '', outcomes: [] }) },
  { key: 'cardPools', label: 'Card pools', template: (n) => ({ id: `pool.${n}`, cards: [] }) },
  { key: 'campaign', label: 'Campaign', whole: true },
  { key: 'classes', label: 'Classes', template: (n) => ({ id: `class-${n}`, name: 'New class', baseStats: {}, hp: { base: 10, perLevel: 2 } }) },
  { key: 'skills', label: 'Skills', template: (n) => ({ id: `skill-${n}`, name: 'New skill', tier: 1, classes: [] }) },
  { key: 'items', label: 'Items', template: (n) => ({ id: `item-${n}`, name: 'New item', kind: 'consumable' }) },
  { key: 'enemies', label: 'Enemies', template: (n) => ({ id: `enemy-${n}`, name: 'New enemy', stats: {}, hp: 5 }) },
  { key: 'maps', label: 'Maps', template: (n) => ({ id: `map-${n}`, name: 'New map', width: 8, height: 6, heroStart: [[0, 5]], spawnPoints: { north: [[7, 0]] } }) },
  { key: 'lootTables', label: 'Loot', template: (n) => ({ id: `loot.${n}`, entries: [] }) },
  { key: 'conditions', label: 'Conditions', template: (n) => ({ id: `condition-${n}`, name: 'New condition' }) },
  { key: 'terrain', label: 'Terrain', template: (n) => ({ id: `terrain-${n}`, symbol: '?', moveCost: 1 }) },
  { key: 'stats', label: 'Stats', template: (n) => ({ key: `stat${n}`, name: 'New stat' }) },
  { key: 'rules', label: 'Rules', whole: true },
  { key: 'assets', label: 'Assets', whole: true },
];

const BLANK: Pack = { spec: 'otrpg/0.1', id: 'my.pack', name: 'My Adventure', version: '0.1.0' };

const labelOf = (e: unknown, i: number) => {
  const r = (e ?? {}) as Json;
  return String(r.id ?? r.key ?? r.symbol ?? `#${i + 1}`);
};

function readDraft(): { pack: Pack; baseUrl?: string } | undefined {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    return raw ? JSON.parse(raw) : undefined;
  } catch {
    return undefined;
  }
}

export function Editor() {
  const [doc, setDoc] = useState<{ pack: Pack; baseUrl?: string }>(() => readDraft() ?? { pack: BLANK });
  const [section, setSection] = useState('_meta');
  const [entry, setEntry] = useState(0);
  const [issues, setIssues] = useState<PackIssue[]>();
  const [note, setNote] = useState<string>();
  const [busy, setBusy] = useState(false);
  /** Bumped when entries move, so the text box reloads what is now in its place. */
  const [rev, setRev] = useState(0);
  const pack = doc.pack;
  const load = (next: { pack: Pack; baseUrl?: string }) => {
    setDoc(next);
    setSection('_meta');
    setEntry(0);
    setRev((r) => r + 1);
  };

  // Keep the draft, and re-check the pack shortly after each edit.
  useEffect(() => {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(doc));
    } catch {
      // Storage full or blocked: the draft lasts as long as the tab.
    }
    const t = setTimeout(async () => {
      const r = await check(doc.pack, doc.baseUrl);
      setIssues(r.ok ? [] : r.issues);
    }, 300);
    return () => clearTimeout(t);
  }, [doc]);

  const sec = SECTIONS.find((s) => s.key === section)!;
  const list = sec.whole ? undefined : ((pack[sec.key] as unknown[] | undefined) ?? []);
  const value = sec.key === '_meta' ? Object.fromEntries(META_KEYS.filter((k) => k in pack).map((k) => [k, pack[k]])) : list ? list[entry] : (pack[sec.key] ?? {});

  const replace = (next: unknown) =>
    setDoc((d) => {
      const p = { ...d.pack };
      if (sec.key === '_meta') {
        for (const k of META_KEYS) delete p[k];
        Object.assign(p, next as Json);
      } else if (list) {
        const l = [...((p[sec.key] as unknown[]) ?? [])];
        l[entry] = next;
        p[sec.key] = l;
      } else {
        p[sec.key] = next;
      }
      return { ...d, pack: p };
    });
  const setList = (l: unknown[], select: number) => {
    setDoc((d) => ({ ...d, pack: { ...d.pack, [sec.key]: l } }));
    setEntry(select);
    setRev((r) => r + 1);
  };

  const open = async (url: string) => {
    setBusy(true);
    setNote(undefined);
    const engine = await import('@otrpg/engine');
    try {
      const p = await engine.loadPackFromUrl(new URL(url, location.href).href);
      load({ pack: p as unknown as Pack, baseUrl: new URL(url, location.href).href });
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    }
    setBusy(false);
  };
  const openFile = async (file: File) => {
    try {
      const p = JSON.parse(await file.text()) as Pack;
      if (Array.isArray(p.include) && p.include.length) setNote('This pack.json includes other files. Open it by URL instead, or merge it into one file first.');
      load({ pack: p });
    } catch {
      setNote("That file isn't valid JSON.");
    }
  };
  const download = () => {
    const blob = new Blob([JSON.stringify(pack, null, 2) + '\n'], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${String(pack.id || 'pack')}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const playtest = async () => {
    setBusy(true);
    setNote(undefined);
    const r = await check(pack, doc.baseUrl);
    if (!r.ok) {
      setNote('Fix the problems listed below first.');
      setBusy(false);
      return;
    }
    try {
      const code = await createTable('controller', r.custom);
      navigate(`/play/${code}`);
    } catch (e) {
      setNote(e instanceof TableRefused ? e.message : "Couldn't reach the game server.");
      setBusy(false);
    }
  };
  const jump = (path: string) => {
    const [, key, idx] = path.split('/');
    const target = SECTIONS.find((s) => s.key === key) ?? (META_KEYS.includes(key) || !key ? SECTIONS[0] : undefined);
    if (!target) return;
    setSection(target.key);
    setEntry(target.whole ? 0 : Number(idx) || 0);
  };

  const counts = (key: string) => (Array.isArray(pack[key]) ? (pack[key] as unknown[]).length : undefined);
  const issuesHere = (issues ?? []).filter((i) => {
    const [, key, idx] = i.path.split('/');
    if (sec.key === '_meta') return !key || META_KEYS.includes(key);
    return key === sec.key && (sec.whole || Number(idx) === entry);
  });

  return (
    <main className="editor">
      <header className="editor-head">
        <div>
          <a className="muted small" href="/" onClick={(e) => (e.preventDefault(), navigate('/'))}>
            ← Home
          </a>
          <h1>Pack editor</h1>
        </div>
        <div className="row wrap">
          <button disabled={busy} onClick={() => open('/pack/pack.json')}>
            Open The Hollow Road
          </button>
          <UrlOpener busy={busy} onOpen={open} />
          <label className="button ghost">
            Open file
            <input type="file" accept="application/json,.json" hidden onChange={(e) => (e.target.files?.[0] && openFile(e.target.files[0]), (e.target.value = ''))} />
          </label>
          <button className="ghost" onClick={() => load({ pack: BLANK })}>
            New pack
          </button>
          <button onClick={download}>Download pack.json</button>
          <button className="primary" disabled={busy || !!issues?.length} onClick={playtest}>
            Playtest
          </button>
        </div>
      </header>
      {note && (
        <p className="error" role="alert" onClick={() => setNote(undefined)}>
          {note}
        </p>
      )}
      <div className="editor-body">
        <nav className="editor-nav" aria-label="Sections">
          {SECTIONS.map((s) => (
            <button key={s.key} className={s.key === section ? 'selected' : ''} onClick={() => (setSection(s.key), setEntry(0))}>
              {s.label}
              {counts(s.key) !== undefined && <span className="muted small"> {counts(s.key)}</span>}
            </button>
          ))}
        </nav>
        {list && (
          <div className="editor-list">
            <ul>
              {list.map((e, i) => (
                <li key={i}>
                  <button className={i === entry ? 'selected' : ''} onClick={() => setEntry(i)}>
                    {labelOf(e, i)}
                    {(issues ?? []).some((x) => x.path.startsWith(`/${sec.key}/${i}/`) || x.path === `/${sec.key}/${i}`) && <span className="tag red">!</span>}
                  </button>
                </li>
              ))}
            </ul>
            <div className="row wrap">
              <button onClick={() => setList([...list, sec.template!(list.length + 1)], list.length)}>+ New</button>
              {list[entry] !== undefined && (
                <>
                  <button className="ghost" onClick={() => setList([...list.slice(0, entry + 1), { ...(list[entry] as Json), id: `${labelOf(list[entry], entry)}-copy` }, ...list.slice(entry + 1)], entry + 1)}>
                    Duplicate
                  </button>
                  <button className="ghost" onClick={() => setList(list.filter((_, i) => i !== entry), Math.max(0, entry - 1))}>
                    Delete
                  </button>
                </>
              )}
            </div>
          </div>
        )}
        <div className="editor-main">
          {value === undefined ? (
            <p className="muted">Nothing here yet. Add one with + New.</p>
          ) : (
            <>
              {issuesHere.length > 0 && <IssueList issues={issuesHere} />}
              {section === 'cards' && <CardPreview card={value as Json} />}
              {section === 'maps' && <MapPreview map={value as Json} terrain={(pack.terrain as Json[]) ?? []} />}
              <JsonField key={`${section}:${entry}:${rev}`} value={value} onChange={replace} />
            </>
          )}
        </div>
        <aside className="editor-issues">
          <h2>Checks</h2>
          {issues === undefined ? (
            <p className="muted">Checking…</p>
          ) : issues.length === 0 ? (
            <p className="ok">No problems. Ready to playtest.</p>
          ) : (
            <IssueList issues={issues} onPick={jump} />
          )}
        </aside>
      </div>
    </main>
  );
}

function UrlOpener({ busy, onOpen }: { busy: boolean; onOpen: (url: string) => void }) {
  const [url, setUrl] = useState('');
  return (
    <form className="row" onSubmit={(e) => (e.preventDefault(), url.trim() && onOpen(url.trim()))}>
      <input aria-label="Pack URL" placeholder="https://…/pack.json" value={url} onChange={(e) => setUrl(e.target.value)} />
      <button disabled={busy || !url.trim()}>Open URL</button>
    </form>
  );
}

/** A JSON text box that only commits text that parses. */
function JsonField({ value, onChange }: { value: unknown; onChange: (v: unknown) => void }) {
  const [textValue, setText] = useState(() => JSON.stringify(value, null, 2));
  const [error, setError] = useState<string>();
  const rows = useMemo(() => Math.min(30, Math.max(8, textValue.split('\n').length + 1)), [textValue]);
  return (
    <div className="json-field">
      <textarea
        aria-label="Entry JSON"
        spellCheck={false}
        rows={rows}
        value={textValue}
        onChange={(e) => {
          setText(e.target.value);
          try {
            onChange(JSON.parse(e.target.value));
            setError(undefined);
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Invalid JSON');
          }
        }}
      />
      {error && <p className="error small">Not saved yet: {error}</p>}
    </div>
  );
}

function IssueList({ issues, onPick }: { issues: PackIssue[]; onPick?: (path: string) => void }) {
  return (
    <ul className="issues">
      {issues.slice(0, 100).map((i, n) => (
        <li key={n}>
          {onPick ? (
            <button className="ghost" onClick={() => onPick(i.path)}>
              <code>{i.path}</code> {i.message}
            </button>
          ) : (
            <>
              <code>{i.path}</code> {i.message}
            </>
          )}
        </li>
      ))}
    </ul>
  );
}

function CardPreview({ card }: { card: Json }) {
  const t = (v: unknown) => (typeof v === 'string' ? v : v && typeof v === 'object' ? String(Object.values(v)[0] ?? '') : '');
  const options = Array.isArray(card.options) ? (card.options as Json[]) : [];
  return (
    <div className="card preview">
      <div className="card-type">{String(card.type ?? '')}</div>
      <h2>{t(card.title)}</h2>
      <p>{t(card.text)}</p>
      {options.length > 0 && (
        <ul className="muted">
          {options.map((o, i) => (
            <li key={i}>{t(o.label)}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function MapPreview({ map, terrain }: { map: Json; terrain: Json[] }) {
  const w = Number(map.width) || 0;
  const h = Number(map.height) || 0;
  if (w <= 0 || h <= 0 || w > 64 || h > 64) return null;
  const tiles = Array.isArray(map.tiles) ? (map.tiles as string[]) : [];
  const cells: ReactElement[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sym = String(tiles[y] ?? '')[x] ?? '.';
      const t = terrain.find((d) => d.symbol === sym);
      const color = terrainColor(
        t ? { symbol: sym, name: '', moveCost: Number(t.moveCost ?? 1), defenseBonus: Number(t.defenseBonus ?? 0), blocksSight: !!t.blocksSight, hazard: Array.isArray(t.onEnter) && t.onEnter.length > 0 } : undefined,
      );
      cells.push(<rect key={`${x},${y}`} x={x} y={y} width={1} height={1} fill={hex(color)} stroke="#00000055" strokeWidth={0.03} />);
    }
  }
  const dots = (pts: unknown, fill: string, label: string) =>
    (Array.isArray(pts) ? pts : []).map((p, i) =>
      Array.isArray(p) ? (
        <circle key={`${label}${i}`} cx={Number(p[0]) + 0.5} cy={Number(p[1]) + 0.5} r={0.3} fill={fill}>
          <title>{label}</title>
        </circle>
      ) : null,
    );
  const spawns = Object.entries((map.spawnPoints as Record<string, unknown>) ?? {}).flatMap(([k, pts]) => dots(pts, '#c8553d', `spawn: ${k}`));
  return (
    <figure className="map-preview">
      <svg className="grid-svg" viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`Map preview, ${w} by ${h}`}>
        {cells}
        {dots(map.heroStart, '#e0b453', 'hero start')}
        {spawns}
        {dots(map.exits, '#6fa66b', 'exit')}
      </svg>
      <figcaption className="muted small">Gold: hero starts. Red: enemy spawns. Green: exits.</figcaption>
    </figure>
  );
}
