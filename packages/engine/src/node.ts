// Node-only helpers (the rest of the engine has no Node dependencies).
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { loadPack } from './pack';
import type { Pack } from './types';

/** Load a pack from a pack.json path or a folder containing one. */
export async function loadPackFromDisk(path: string): Promise<Pack> {
  const manifest = resolve(path.endsWith('.json') ? path : join(path, 'pack.json'));
  const dir = dirname(manifest);
  return loadPack(async (rel) => JSON.parse(await readFile(join(dir, rel), 'utf8')), manifest.slice(dir.length + 1));
}
