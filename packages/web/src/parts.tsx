// Pieces shared by the main screen and the phone.

import type { HeroView, LogLine, PromptView, PublicView } from '@otrpg/server/view';
import { useEffect, useRef, useState } from 'react';
import type { Status } from './net';

export function HeroCard({ hero, waiting, compact, yours }: { hero: HeroView; waiting?: boolean; compact?: boolean; yours?: boolean }) {
  const down = hero.maxHp > 0 && hero.hp <= 0;
  return (
    <div className={`hero${down ? ' down' : ''}${waiting ? ' waiting' : ''}`} data-hero={hero.name}>
      <div className="hero-head">
        <strong>{hero.name}</strong>
        <span className="muted">
          {hero.className} · lv {hero.level}
        </span>
        {!hero.online && <span className="tag">no player</span>}
        {waiting && <span className="tag gold">{yours ? 'your move' : 'their move'}</span>}
      </div>
      <HpBar hp={hero.hp} max={hero.maxHp} />
      {!compact && (
        <>
          <div className="stats">
            {Object.entries(hero.stats).map(([k, v]) => (
              <span key={k}>
                <b>{k.toUpperCase()}</b> {v >= 0 ? `+${v}` : v}
              </span>
            ))}
          </div>
          <div className="muted small">
            {hero.gold} gold{hero.xpNext !== undefined ? ` · ${hero.xp}/${hero.xpNext} XP` : ''}
            {hero.conditions.length ? ` · ${hero.conditions.join(', ')}` : ''}
          </div>
        </>
      )}
    </div>
  );
}

export function HpBar({ hp, max }: { hp: number; max: number }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (hp / max) * 100)) : 100;
  return (
    <div className="hp" role="meter" aria-label="Hit points" aria-valuenow={hp} aria-valuemin={0} aria-valuemax={max}>
      <div className="hp-fill" style={{ width: `${pct}%` }} data-low={pct <= 30 ? '' : undefined} />
      <span>{max > 0 ? `${hp} / ${max} HP` : ''}</span>
    </div>
  );
}

export function CardPanel({ view }: { view: PublicView }) {
  const [imgOk, setImgOk] = useState(true);
  const card = view.card;
  useEffect(() => setImgOk(true), [card?.image]);
  if (!card) return <div className="card empty">The deck waits. {view.cardsLeft} cards to go.</div>;
  return (
    <div className="card" data-card-type={card.type}>
      {card.image && imgOk && <img src={card.image} alt="" onError={() => setImgOk(false)} />}
      <div className="card-type">{card.type}</div>
      <h2>{card.title}</h2>
      {card.text && <p>{card.text}</p>}
    </div>
  );
}

/** What the table is waiting for, in words, with votes shown by hero name. */
export function PromptSummary({ view }: { view: PublicView }) {
  const p = view.prompt;
  const name = (id: string) => view.heroes.find((h) => h.id === id)?.name ?? id;
  if (!p) return null;
  return (
    <div className="prompt">
      <PromptBody p={p} name={name} />
    </div>
  );
}

function PromptBody({ p, name }: { p: PromptView; name: (id: string) => string }) {
  switch (p.kind) {
    case 'vote':
      return (
        <>
          <h3>The party votes{p.rule !== 'majority' ? ` (${p.rule === 'leader' ? 'the leader decides' : 'must agree'})` : ''}</h3>
          <ul className="options">
            {p.options.map((o, i) => (
              <li key={i} className={o.enabled ? '' : 'disabled'}>
                <span>{o.label}</span>
                <span className="voters">
                  {o.voters.map((v) => (
                    <span key={v} className="chip">
                      {name(v)}
                    </span>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        </>
      );
    case 'chooseRoller':
      return (
        <h3>
          Who rolls {p.stats.map((s) => s.toUpperCase()).join(' or ')} against DC {p.dc}?
        </h3>
      );
    case 'combat':
      return (
        <>
          <h3>Combat!</h3>
          <p>{p.enemies.map((e) => `${e.count} × ${e.name}`).join(', ')}</p>
        </>
      );
    case 'shop':
      return (
        <>
          <h3>A shop</h3>
          <ul className="options">
            {p.stock.map((e) => (
              <li key={e.itemId} className={e.qty > 0 ? '' : 'disabled'}>
                <span>{e.name}</span>
                <span className="muted">
                  {e.price} gold · {e.qty} left
                </span>
              </li>
            ))}
          </ul>
        </>
      );
    case 'levelUp':
      return (
        <>
          <h3>
            {name(p.heroId)} reaches level {p.level}!
          </h3>
          <ul className="tiles">
            {p.tiles.map((t, i) => (
              <li key={i}>{t.label}</li>
            ))}
          </ul>
        </>
      );
  }
}

export function Log({ lines, limit }: { lines: LogLine[]; limit?: number }) {
  const ref = useRef<HTMLOListElement>(null);
  const shown = limit ? lines.slice(-limit) : lines;
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight });
  }, [shown.at(-1)?.id]);
  return (
    <ol className="log" ref={ref} aria-label="Game log">
      {shown.map((l) => (
        <li key={l.id}>{l.text}</li>
      ))}
    </ol>
  );
}

export function StatusBar({ status }: { status: Status }) {
  if (status === 'connected') return null;
  const text = { connecting: 'Connecting…', reconnecting: 'Connection lost. Reconnecting…', missing: '' }[status];
  return <div className="status">{text}</div>;
}

export function Missing({ code }: { code: string }) {
  return (
    <main className="home">
      <h1>No table {code}</h1>
      <p>That room code doesn't exist, or the table closed after everyone left.</p>
      <a className="button primary" href="/">
        Back to start
      </a>
    </main>
  );
}

export function ResultBanner({ view }: { view: PublicView }) {
  if (view.phase !== 'ended') return null;
  return (
    <div className={`result ${view.result}`}>
      <h2>{view.result === 'victory' ? 'Victory' : 'Defeat'}</h2>
      <p>{view.result === 'victory' ? `${view.scenarioName} is complete.` : 'The party has fallen.'}</p>
      {view.nextScenario && (
        <p className="muted">
          {view.result === 'victory' && view.nextScenario.name !== view.scenarioName ? `Next: ${view.nextScenario.name}.` : 'You can try again.'} Heroes keep what
          they earned.
        </p>
      )}
    </div>
  );
}
