// The phone: make heroes in the lobby, then vote, roll, shop and level up for
// them. A phone can run several heroes, which is how solo play works.

import type { ControllerView, HeroView, PromptView } from '@otrpg/server/view';
import { useState } from 'react';
import { useTable } from './net';
import { CardPanel, HeroCard, Log, Missing, PromptSummary, ResultBanner, StatusBar } from './parts';

type Send = (type: string, payload?: unknown) => void;

export function Controller({ code }: { code: string }) {
  const { view, status, error, clearError, send } = useTable(code, 'controller');
  if (status === 'missing') return <Missing code={code} />;
  const act = (action: Record<string, unknown>) => send('act', { action });

  return (
    <main className="phone">
      <StatusBar status={status} />
      <header className="phone-head">
        <span className="room-code small-code">{code}</span>
        <a className="muted small" href={`/screen/${code}`} target="_blank" rel="noreferrer">
          Open main screen ↗
        </a>
      </header>
      {error && (
        <div className="error" role="alert" onClick={clearError}>
          {error} <span className="muted">(tap to dismiss)</span>
        </div>
      )}
      {view?.role !== 'controller' ? (
        <p className="muted">Joining table {code}…</p>
      ) : view.phase === 'lobby' ? (
        <Lobby view={view} send={send} />
      ) : (
        <Play view={view} send={send} act={act} />
      )}
    </main>
  );
}

function Lobby({ view, send }: { view: ControllerView; send: Send }) {
  const [name, setName] = useState('');
  const [classId, setClassId] = useState(view.classes[0]?.id ?? '');
  const mine = view.heroes.filter((h) => view.mine.includes(h.id));
  const others = view.heroes.filter((h) => !view.mine.includes(h.id));
  const full = view.heroes.length >= view.maxHeroes;

  return (
    <>
      <section>
        <h2>{mine.length ? 'Your heroes' : 'Make your hero'}</h2>
        {mine.map((h) => (
          <div key={h.id} className="row spread">
            <HeroCard hero={h} />
            <button className="ghost" onClick={() => send('removeHero', { heroId: h.id })} aria-label={`Remove ${h.name}`}>
              ✕
            </button>
          </div>
        ))}
        {!full && (
          <form
            className="new-hero"
            onSubmit={(e) => {
              e.preventDefault();
              send('addHero', { name, classId });
              setName('');
            }}
          >
            <input aria-label="Hero name" placeholder="Hero name" value={name} maxLength={24} onChange={(e) => setName(e.target.value)} />
            <div className="class-grid" role="radiogroup" aria-label="Class">
              {view.classes.map((c) => (
                <button
                  type="button"
                  key={c.id}
                  role="radio"
                  aria-checked={c.id === classId}
                  className={c.id === classId ? 'selected' : ''}
                  onClick={() => setClassId(c.id)}
                >
                  <b>{c.name}</b>
                  {c.role && <span className="muted small">{c.role}</span>}
                </button>
              ))}
            </div>
            <button className={mine.length ? '' : 'primary'} disabled={!name.trim()}>
              {mine.length ? 'Add another hero' : 'Join the party'}
            </button>
          </form>
        )}
      </section>
      {others.length > 0 && (
        <section>
          <h2>Also at the table</h2>
          {others.map((h) => (
            <HeroCard key={h.id} hero={h} compact />
          ))}
        </section>
      )}
      {mine.length > 0 && (
        <section className="sticky-actions">
          {view.scenarios.length > 1 && (
            <select aria-label="Scenario" value={view.scenarioId} onChange={(e) => send('scenario', { scenarioId: e.target.value })}>
              {view.scenarios.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          )}
          <button className="primary" onClick={() => send('start')}>
            Start {view.scenarioName ?? 'the game'} ({view.heroes.length} {view.heroes.length === 1 ? 'hero' : 'heroes'})
          </button>
        </section>
      )}
    </>
  );
}

function Play({ view, send, act }: { view: ControllerView; send: Send; act: (a: Record<string, unknown>) => void }) {
  // Heroes whose phone dropped can be played by anyone, so the table doesn't stall.
  const mine = view.heroes.filter((h) => view.mine.includes(h.id) || !h.online);
  return (
    <>
      <ResultBanner view={view} />
      <CardPanel view={view} />
      <PromptSummary view={view} />
      <section className="actions" aria-label="Your move">
        {view.phase === 'ended' ? (
          <>
            <button className="primary" onClick={() => send('start')}>
              Play again
            </button>
            <button onClick={() => send('lobby')}>Back to the lobby</button>
          </>
        ) : view.prompt ? (
          <PromptActions key={promptKey(view.prompt)} view={view} prompt={view.prompt} mine={mine} act={act} />
        ) : (
          <button className="primary" onClick={() => act({ type: 'next' })}>
            Turn the next card
          </button>
        )}
      </section>
      <section>
        {mine.map((h) => (
          <HeroCard key={h.id} hero={h} waiting={view.waitingOn.includes(h.id)} yours />
        ))}
      </section>
      <Log lines={view.log} limit={8} />
    </>
  );
}

function PromptActions({ view, prompt: p, mine, act }: { view: ControllerView; prompt: PromptView; mine: HeroView[]; act: (a: Record<string, unknown>) => void }) {
  const [buyer, setBuyer] = useState(mine[0]?.id);
  const [anyStatTile, setAnyStatTile] = useState<number>();
  const label = (h: HeroView, text: string) => (mine.length > 1 ? `${h.name}: ${text}` : text);

  if (!mine.length) return <p className="muted">You're watching. Add a hero in the lobby next game.</p>;

  switch (p.kind) {
    case 'vote': {
      const voters = mine.filter((h) => view.waitingOn.includes(h.id));
      if (!voters.length) return <p className="muted">Waiting for the others to vote…</p>;
      return (
        <>
          {voters.map((h) => (
            <div key={h.id} className="stack">
              {mine.length > 1 && <h3>{h.name} votes</h3>}
              {p.options.map((o, i) =>
                o.enabled ? (
                  <button key={i} onClick={() => act({ type: 'vote', playerId: h.id, option: i })}>
                    {o.label}
                  </button>
                ) : null,
              )}
            </div>
          ))}
        </>
      );
    }
    case 'chooseRoller': {
      const able = mine.filter((h) => h.hp > 0);
      if (!able.length) return <p className="muted">Your heroes are down. Someone else must roll.</p>;
      return (
        <>
          {able.map((h) => {
            const best = Math.max(...p.stats.map((s) => h.stats[s] ?? 0));
            return (
              <button key={h.id} onClick={() => act({ type: 'chooseRoller', playerId: h.id })}>
                {mine.length > 1 ? `${h.name} rolls` : 'I’ll roll'} ({best >= 0 ? '+' : ''}
                {best})
              </button>
            );
          })}
        </>
      );
    }
    case 'combat':
      return (
        <>
          <button className="primary" onClick={() => act({ type: 'resolveCombat', victory: true })}>
            We won the fight
          </button>
          <button onClick={() => act({ type: 'resolveCombat', victory: false })}>We were defeated</button>
        </>
      );
    case 'shop': {
      const who = mine.find((h) => h.id === buyer) ?? mine[0];
      return (
        <>
          {mine.length > 1 && (
            <select aria-label="Buyer" value={who.id} onChange={(e) => setBuyer(e.target.value)}>
              {mine.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name} ({h.gold} gold)
                </option>
              ))}
            </select>
          )}
          {p.stock.map((e) => (
            <button key={e.itemId} disabled={e.qty <= 0 || who.gold < e.price} onClick={() => act({ type: 'buy', playerId: who.id, itemId: e.itemId })}>
              Buy {e.name} · {e.price} gold
            </button>
          ))}
          <p className="muted small">{who.name} has {who.gold} gold.</p>
          <button className="primary" onClick={() => act({ type: 'leaveShop' })}>
            Leave the shop
          </button>
        </>
      );
    }
    case 'levelUp': {
      const h = mine.find((m) => m.id === p.heroId);
      if (!h) return <p className="muted">Waiting for {view.heroes.find((x) => x.id === p.heroId)?.name} to level up…</p>;
      if (anyStatTile !== undefined) {
        return (
          <>
            <h3>Raise which stat?</h3>
            {view.stats.map((s) => (
              <button key={s} onClick={() => (setAnyStatTile(undefined), act({ type: 'pickTile', playerId: h.id, index: anyStatTile, stat: s }))}>
                {s.toUpperCase()} ({h.stats[s] >= 0 ? '+' : ''}
                {h.stats[s]})
              </button>
            ))}
            <button className="ghost" onClick={() => setAnyStatTile(undefined)}>
              Back
            </button>
          </>
        );
      }
      const cost = p.freeRerolls > 0 ? 0 : p.rerollCost;
      return (
        <>
          <h3>{label(h, `pick a level ${p.level} tile`)}</h3>
          {p.tiles.map((t, i) => (
            <button key={i} className="tile" onClick={() => (t.anyStat ? setAnyStatTile(i) : act({ type: 'pickTile', playerId: h.id, index: i }))}>
              {t.label}
            </button>
          ))}
          {cost !== undefined && (
            <button className="ghost" disabled={h.gold < cost} onClick={() => act({ type: 'rerollTiles', playerId: h.id })}>
              {cost ? `Reroll for ${cost} gold` : `Reroll (${p.freeRerolls} free)`}
            </button>
          )}
        </>
      );
    }
  }
}

/** Reset local picks (like a half-chosen +1 stat tile) when a new prompt comes up. */
function promptKey(p: PromptView): string {
  return p.kind === 'levelUp' ? `levelUp:${p.heroId}:${p.level}` : p.kind;
}
