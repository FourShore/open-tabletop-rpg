// The main screen: the world view everyone looks at. It never takes input
// during play, so it works on a TV, a projector, or a remote player's laptop.

import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { useTable } from './net';
import { CardPanel, HeroCard, Log, Missing, PromptSummary, ResultBanner, StatusBar } from './parts';

export function Screen({ code }: { code: string }) {
  const { view, status } = useTable(code, 'screen');
  const joinUrl = `${location.origin}/play/${code}`;
  const [qr, setQr] = useState<string>();
  useEffect(() => {
    QRCode.toDataURL(joinUrl, { margin: 1, width: 320, color: { dark: '#16130f', light: '#f3e9d2' } }).then(setQr, () => setQr(undefined));
  }, [joinUrl]);

  if (status === 'missing') return <Missing code={code} />;
  const waiting = new Set(view?.waitingOn ?? []);

  return (
    <main className="screen">
      <StatusBar status={status} />
      <header className="screen-head">
        <div>
          <div className="muted small">{view?.packName}</div>
          <h1>{view?.scenarioName ?? 'Open Tabletop RPG'}</h1>
        </div>
        <div className="join">
          <div>
            <div className="muted small">Join at {location.host}</div>
            <div className="room-code" aria-label="Room code">
              {code}
            </div>
          </div>
          {qr && view?.phase === 'lobby' && <img className="qr small-qr" src={qr} alt={`QR code to join ${code}`} />}
        </div>
      </header>

      {!view ? (
        <p className="muted">Connecting to table {code}…</p>
      ) : view.phase === 'lobby' ? (
        <section className="lobby">
          <div className="panel center">
            {qr && <img className="qr" src={qr} alt={`QR code to join ${code}`} />}
            <p>
              Scan to join, or go to <b>{joinUrl.replace(/^https?:\/\//, '')}</b>
            </p>
          </div>
          <div>
            <h2>
              The party ({view.heroes.length}/{view.maxHeroes})
            </h2>
            {view.heroes.length === 0 && <p className="muted">No heroes yet. Create one on your phone.</p>}
            <div className="party">
              {view.heroes.map((h) => (
                <HeroCard key={h.id} hero={h} />
              ))}
            </div>
            {view.heroes.length > 0 && <p className="muted">Start the game from any phone when everyone is in.</p>}
          </div>
        </section>
      ) : (
        <section className="table">
          <div className="stage">
            <ResultBanner view={view} />
            <CardPanel view={view} />
            <PromptSummary view={view} />
          </div>
          <aside>
            <div className="party">
              {view.heroes.map((h) => (
                <HeroCard key={h.id} hero={h} waiting={waiting.has(h.id)} />
              ))}
            </div>
            <Log lines={view.log} />
          </aside>
        </section>
      )}
    </main>
  );
}
