import { useEffect, useState } from 'react';
import { createTable, TableRefused, type CustomPack, type Role } from './net';
import { GALLERY, loadPackUrl, type PackIssue } from './packs';
import { navigate } from './router';

/** The pack new tables use. Undefined custom = the server's own. */
interface Choice {
  name: string;
  description?: string;
  custom?: CustomPack;
  url?: string;
}

const builtin = GALLERY.find((g) => g.builtin);
const DEFAULT: Choice = { name: builtin?.name ?? 'The built-in pack', description: builtin?.description };

export function Home() {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [choice, setChoice] = useState<Choice>(DEFAULT);

  const host = async (role: Role) => {
    setBusy(true);
    setError(undefined);
    try {
      const c = await createTable(role, choice.custom);
      navigate(role === 'screen' ? `/screen/${c}` : `/play/${c}`);
    } catch (e) {
      setError(e instanceof TableRefused ? e.message : "Couldn't reach the game server. Try again in a moment.");
      setBusy(false);
    }
  };
  const clean = code.replace(/[^a-z]/gi, '').toUpperCase().slice(0, 4);

  return (
    <main className="home">
      <h1>Open Tabletop RPG</h1>
      <p className="lede">Flip cards, make hard choices, roll the dice. One screen for the table, a phone for each hero.</p>
      <PackPicker choice={choice} onChoose={setChoice} />
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
      <p className="muted small center">
        Make your own adventure in the <a href="/editor" onClick={(e) => (e.preventDefault(), navigate('/editor'))}>pack editor</a>. Packs are
        plain JSON; see the <a href="https://github.com/FourShore/open-tabletop-rpg/tree/main/spec">spec</a>.
      </p>
    </main>
  );
}

/** Choose the pack: one from the gallery, or any pack.json URL (also taken from ?pack= so a pack can be shared as a link). */
function PackPicker({ choice, onChoose }: { choice: Choice; onChoose: (c: Choice) => void }) {
  const [url, setUrl] = useState(() => new URLSearchParams(location.search).get('pack') ?? '');
  const [loading, setLoading] = useState(false);
  const [problem, setProblem] = useState<{ error: string; issues: PackIssue[] }>();

  const load = async (from: string) => {
    if (!from.trim()) return;
    setLoading(true);
    setProblem(undefined);
    const r = await loadPackUrl(from);
    setLoading(false);
    if (r.ok) onChoose({ name: r.name, description: r.description, custom: r.custom, url: from.trim() });
    else setProblem(r);
  };
  useEffect(() => {
    const shared = new URLSearchParams(location.search).get('pack');
    if (shared) void load(shared);
    // Only on first load.
  }, []);

  return (
    <section className="panel packs">
      <h2>Adventure</h2>
      <p className="chosen" aria-live="polite">
        <b>{choice.name}</b>
        {choice.description && <span className="muted small"> {choice.description}</span>}
      </p>
      <ul className="gallery">
        {GALLERY.map((g) => {
          const selected = g.builtin ? !choice.custom : choice.url === g.url;
          return (
            <li key={g.id}>
              <button
                className={selected ? 'selected' : ''}
                aria-pressed={selected}
                disabled={loading}
                onClick={() => (g.builtin ? onChoose(DEFAULT) : g.url && void load(g.url))}
              >
                <b>{g.name}</b>
                <span className="muted small">
                  {[g.author, g.players && `${g.players} players`, g.license].filter(Boolean).join(' · ')}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          void load(url);
        }}
      >
        <input aria-label="Pack URL" placeholder="https://…/pack.json" value={url} onChange={(e) => setUrl(e.target.value)} inputMode="url" />
        <button disabled={loading || !url.trim()}>{loading ? 'Loading…' : 'Load'}</button>
      </form>
      {problem && (
        <div className="error small" role="alert">
          {problem.error}
          {problem.issues.length > 0 && (
            <ul>
              {problem.issues.slice(0, 5).map((i, n) => (
                <li key={n}>
                  <code>{i.path}</code> {i.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
