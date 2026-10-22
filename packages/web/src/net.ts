// Connection to a table. Each browser keeps one random token in localStorage,
// which is how the server knows a reloaded phone still owns its heroes.

import type { View } from '@otrpg/server/view';
import { Client, type Room } from 'colyseus.js';
import { useEffect, useRef, useState } from 'react';

export type Role = 'screen' | 'controller';

/** The game server: same origin in production, :2567 next to the Vite dev server. */
const SERVER_URL =
  import.meta.env.VITE_SERVER_URL ?? (import.meta.env.DEV ? `${location.protocol}//${location.hostname}:2567` : location.origin);

const client = new Client(SERVER_URL);

const memoryTokens: Partial<Record<Role, string>> = {};

/** One token per role, so the same laptop can be the main screen and a player. */
export function deviceToken(role: Role): string {
  const key = `otrpg.token.${role}`;
  try {
    let t = localStorage.getItem(key);
    if (!t) {
      t = randomId();
      localStorage.setItem(key, t);
    }
    return t;
  } catch {
    // Private mode or blocked storage: the seat lasts as long as the tab.
    return (memoryTokens[role] ??= randomId());
  }
}

function randomId(): string {
  return globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/** A room created on the home page, handed to the page we navigate to so it doesn't join twice. */
let handoff: { room: Room; role: Role; view?: View } | undefined;

export async function createTable(role: Role): Promise<string> {
  const room = await client.create('table', { token: deviceToken(role), role });
  const h: NonNullable<typeof handoff> = { room, role };
  // The first view can arrive before the next page mounts; keep it.
  room.onMessage('view', (v: View) => (h.view = v));
  handoff = h;
  return room.roomId;
}

export type Status = 'connecting' | 'connected' | 'reconnecting' | 'missing';

export interface TableConnection {
  view?: View;
  status: Status;
  error?: string;
  clearError(): void;
  send(type: string, payload?: unknown): void;
}

/** Join a table by code and keep the latest view, rejoining if the connection drops. */
export function useTable(code: string, role: Role): TableConnection {
  const [view, setView] = useState<View>();
  const [status, setStatus] = useState<Status>('connecting');
  const [error, setError] = useState<string>();
  const roomRef = useRef<Room | undefined>(undefined);

  useEffect(() => {
    let closed = false;
    let retry: ReturnType<typeof setTimeout> | undefined;

    const attach = (room: Room) => {
      roomRef.current = room;
      setStatus('connected');
      room.onMessage('view', (v: View) => setView(v));
      room.onMessage('error', (e: { message: string }) => setError(e.message));
      room.onLeave(() => {
        if (closed) return;
        roomRef.current = undefined;
        setStatus('reconnecting');
        retry = setTimeout(() => join(1), 500);
      });
    };

    const join = async (attempt: number) => {
      try {
        const room = await client.joinById(code, { token: deviceToken(role), role });
        if (closed) return void room.leave();
        attach(room);
      } catch (e) {
        if (closed) return;
        // A missing room won't come back; anything else is probably the network.
        if (/not found|invalid|locked/i.test(String((e as Error)?.message))) return setStatus('missing');
        setStatus('reconnecting');
        retry = setTimeout(() => join(attempt + 1), Math.min(10_000, 500 * 2 ** attempt));
      }
    };

    if (handoff && handoff.room.roomId === code && handoff.role === role) {
      attach(handoff.room);
      if (handoff.view) setView(handoff.view);
      handoff = undefined;
    } else {
      void join(0);
    }
    return () => {
      closed = true;
      clearTimeout(retry);
      void roomRef.current?.leave();
    };
  }, [code, role]);

  return {
    view,
    status,
    error,
    clearError: () => setError(undefined),
    send: (type, payload) => roomRef.current?.send(type, payload ?? {}),
  };
}
