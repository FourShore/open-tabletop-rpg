// Campaign saves in the browser. There are no accounts: the server hands out
// a save file, and the main screen keeps the latest one in localStorage so a
// group can pick up where they left off even after the server restarts.

import type { PublicView } from '@otrpg/server/view';
import { useEffect, useRef, useState, type ChangeEvent } from 'react';

type Send = (type: string, payload?: unknown) => void;

interface StoredSave {
  savedAt: string;
  heroes: string[];
  scenarioId: string;
  data: unknown;
}

const key = (packId: string) => `otrpg.save.${packId}`;

function readStored(packId: string): StoredSave | undefined {
  try {
    const raw = localStorage.getItem(key(packId));
    return raw ? (JSON.parse(raw) as StoredSave) : undefined;
  } catch {
    return undefined;
  }
}

/** Keep the newest save for this pack whenever the table has one to give. */
export function useAutosave(code: string, view: PublicView | undefined) {
  const last = useRef('');
  const canSave = !!view?.campaign.canSave;
  const stamp = view ? `${view.phase}:${view.heroes.map((h) => `${h.id}:${h.xp}:${h.gold}:${h.items.length}`).join(',')}` : '';
  useEffect(() => {
    if (!view || !canSave || stamp === last.current) return;
    last.current = stamp;
    fetch(`/save/${code}`)
      .then((r) => (r.ok ? r.json() : undefined))
      .then((data) => {
        if (!data) return;
        const stored: StoredSave = { savedAt: data.savedAt, heroes: data.campaign.party.map((p: { name: string }) => p.name), scenarioId: data.scenarioId, data };
        localStorage.setItem(key(view.packId), JSON.stringify(stored));
      })
      .catch(() => undefined);
  }, [code, view, canSave, stamp]);
}

export function DownloadSave({ code, view }: { code: string; view: PublicView }) {
  if (!view.campaign.canSave) return null;
  return (
    <a className="button" href={`/save/${code}?download`} download>
      Download save
    </a>
  );
}

/** Lobby controls: pick up the remembered campaign, or load a save file. */
export function LoadSave({ view, send }: { view: PublicView; send: Send }) {
  const [stored, setStored] = useState(() => readStored(view.packId));
  const [error, setError] = useState<string>();
  useEffect(() => setStored(readStored(view.packId)), [view.packId, view.campaign.started]);

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      send('loadSave', { save: JSON.parse(await file.text()) });
      setError(undefined);
    } catch {
      setError("That file isn't a campaign save.");
    }
  };

  return (
    <div className="load-save stack">
      {stored && !view.campaign.started && (
        <button onClick={() => send('loadSave', { save: stored.data })}>
          Resume your last campaign
          <span className="muted small"> {stored.heroes.join(', ')} · saved {new Date(stored.savedAt).toLocaleDateString()}</span>
        </button>
      )}
      <label className="button ghost file">
        Load a save file
        <input type="file" accept="application/json,.json" onChange={onFile} hidden />
      </label>
      {error && <p className="error small">{error}</p>}
    </div>
  );
}
