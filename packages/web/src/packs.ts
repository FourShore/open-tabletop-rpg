// Picking a pack: the server's own, one from the gallery, or any pack.json URL.
// Packs from elsewhere are fetched and checked here in the browser, then handed
// to the server with the new table. The engine is loaded only when needed, since
// the validator is the heaviest part of it.

import gallery from '../../../spec/gallery.json';
import type { CustomPack } from './net';

export interface GalleryEntry {
  id: string;
  name: string;
  description: string;
  author?: string;
  license?: string;
  players?: string;
  /** The server's own pack. */
  builtin?: boolean;
  /** pack.json URL, for packs hosted elsewhere. */
  url?: string;
}

export const GALLERY: GalleryEntry[] = gallery.packs;

export interface PackIssue {
  path: string;
  message: string;
}

export type LoadResult = { ok: true; custom: CustomPack; name: string; description?: string } | { ok: false; error: string; issues: PackIssue[] };

/** Fetch a pack by its pack.json URL and check it. */
export async function loadPackUrl(url: string): Promise<LoadResult> {
  const engine = await import('@otrpg/engine');
  let pack;
  try {
    pack = await engine.loadPackFromUrl(url.trim());
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), issues: [] };
  }
  return check(pack, url.trim());
}

/** Check a pack already in hand (from the editor or a file). */
export async function check(pack: unknown, baseUrl?: string): Promise<LoadResult> {
  const engine = await import('@otrpg/engine');
  const issues = engine.validatePack(pack as never);
  if (issues.length) return { ok: false, error: `The pack has ${issues.length} problem${issues.length === 1 ? '' : 's'}`, issues };
  const p = pack as { name: string; description?: string };
  return { ok: true, custom: { pack, baseUrl }, name: engine.text(p.name), description: p.description };
}
