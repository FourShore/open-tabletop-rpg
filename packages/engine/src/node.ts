// Node-only helpers (the rest of the engine has no Node dependencies).
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { loadPack } from './pack';
import type { Pack } from './types';

/**
 * Load a pack from a pack.json path or a folder containing one. Relative paths
 * resolve against the directory npm was started from (npm runs workspace
 * scripts inside the package folder).
 */
export async function loadPackFromDisk(path: string): Promise<Pack> {
  const base = process.env.INIT_CWD ?? process.cwd();
  const manifest = resolve(base, path.endsWith('.json') ? path : join(path, 'pack.json'));
  const dir = dirname(manifest);
  return loadPack(async (rel) => JSON.parse(await readFile(join(dir, rel), 'utf8')), manifest.slice(dir.length + 1));
}
