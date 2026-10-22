import { useState } from 'react';
import { navigate } from './router';
import { createTable, type Role } from './net';

export function Home() {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const host = async (role: Role) => {
    setBusy(true);
    setError(undefined);
    try {
      const c = await createTable(role);
      navigate(role === 'screen' ? `/screen/${c}` : `/play/${c}`);
    } catch {
      setError("Couldn't reach the game server. Try again in a moment.");
      setBusy(false);
    }
  };
  const clean = code.replace(/[^a-z]/gi, '').toUpperCase().slice(0, 4);

  return (
    <main className="home">
      <h1>Open Tabletop RPG</h1>
      <p className="lede">Flip cards, make hard choices, roll the dice. One screen for the table, a phone for each hero.</p>
      <section className="panel">
        <h2>Host a game</h2>
        <p>Put this on the TV or a laptop. Players scan the code with their phones.</p>
        <button className="primary" disabled={busy} onClick={() => host('screen')}>
          Open the main screen
        </button>
      </section>
      <section className="panel">
        <h2>Join a game</h2>
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            if (clean.length === 4) navigate(`/play/${clean}`);
          }}
        >
          <input
            aria-label="Room code"
            className="code-input"
            placeholder="ABCD"
            value={clean}
            onChange={(e) => setCode(e.target.value)}
            autoCapitalize="characters"
            autoComplete="off"
          />
          <button className="primary" disabled={clean.length !== 4}>
            Join
          </button>
        </form>
      </section>
      <section className="panel">
        <h2>Play solo</h2>
        <p>Run a party from one device. Anyone can still join with the room code.</p>
        <button disabled={busy} onClick={() => host('controller')}>
          Start a solo table
        </button>
      </section>
      {error && <p className="error">{error}</p>}
    </main>
  );
}
