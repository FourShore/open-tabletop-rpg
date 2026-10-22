import type { Card, ClassDef, ConditionDef, ItemDef, LootTable, Pack, Scenario, SkillDef, Weighted } from './types';

type Fragment = Record<string, unknown>;

/**
 * Merge fragment files into a pack: arrays concatenate, objects merge
 * shallowly, and an array entry whose id already exists replaces it.
 */
export function mergePack(root: Fragment, fragments: Fragment[]): Pack {
  const pack: Fragment = {};
  for (const frag of [root, ...fragments]) {
    for (const [key, value] of Object.entries(frag)) {
      if (key === '$schema' || key === 'include') continue;
      const prev = pack[key];
      if (Array.isArray(value) && Array.isArray(prev)) {
        const merged = prev.slice();
        for (const entry of value) {
          const id = isRecord(entry) ? entry.id : undefined;
          const at = id === undefined ? -1 : merged.findIndex((e) => isRecord(e) && e.id === id);
          if (at >= 0) merged[at] = entry;
          else merged.push(entry);
        }
        pack[key] = merged;
      } else if (isRecord(value) && isRecord(prev)) {
        pack[key] = { ...prev, ...value };
      } else {
        pack[key] = value;
      }
    }
  }
  return pack as unknown as Pack;
}

/** Load a pack from a JSON-file reader (fs on Node, fetch in a browser). */
export async function loadPack(readJson: (relPath: string) => Promise<Fragment>, manifest = 'pack.json'): Promise<Pack> {
  const root = await readJson(manifest);
  const includes = Array.isArray(root.include) ? (root.include as string[]) : [];
  const base = manifest.includes('/') ? manifest.slice(0, manifest.lastIndexOf('/') + 1) : '';
  const fragments = await Promise.all(includes.map((rel) => readJson(base + rel)));
  return mergePack(root, fragments);
}

/** Most fragment files a pack fetched by URL may include. */
const MAX_INCLUDES = 64;
/** Largest JSON file a pack fetched by URL may have. */
const MAX_FILE_BYTES = 2_000_000;

/**
 * Load a pack from the URL of its pack.json, fetching its includes next to it.
 * Works in browsers (the host must allow CORS, as GitHub raw and Pages do) and Node.
 */
export async function loadPackFromUrl(url: string, fetchFn: typeof fetch = fetch): Promise<Pack> {
  let root: URL;
  try {
    root = new URL(url);
  } catch {
    throw new Error(`'${url}' is not a URL`);
  }
  if (root.protocol !== 'https:' && root.protocol !== 'http:') throw new Error('Packs load over http or https');
  let files = 0;
  return loadPack(async (rel) => {
    if (++files > MAX_INCLUDES + 1) throw new Error(`A pack can include at most ${MAX_INCLUDES} files`);
    const at = new URL(rel, root);
    let res: Response;
    try {
      res = await fetchFn(at.href);
    } catch {
      throw new Error(`Couldn't fetch ${at.href} (is the host allowing cross-origin requests?)`);
    }
    if (!res.ok) throw new Error(`${at.href} answered ${res.status}`);
    const body = await res.text();
    if (body.length > MAX_FILE_BYTES) throw new Error(`${at.href} is too big`);
    try {
      return JSON.parse(body) as Fragment;
    } catch {
      throw new Error(`${at.href} isn't valid JSON`);
    }
  }, root.href);
}

/** Lookup tables built once per pack. */
export interface PackIndex {
  pack: Pack;
  classes: Map<string, ClassDef>;
  skills: Map<string, SkillDef>;
  items: Map<string, ItemDef>;
  conditions: Map<string, ConditionDef>;
  loot: Map<string, LootTable>;
  cards: Map<string, Card>;
  pools: Map<string, Weighted[]>;
  scenarios: Map<string, Scenario>;
  abilityStats: string[];
}

export function indexPack(pack: Pack): PackIndex {
  const byId = <T extends { id: string }>(list: T[] | undefined) => new Map((list ?? []).map((e) => [e.id, e]));
  return {
    pack,
    classes: byId(pack.classes),
    skills: byId(pack.skills),
    items: byId(pack.items),
    conditions: byId(pack.conditions),
    loot: byId(pack.lootTables),
    cards: byId(pack.cards),
    pools: new Map((pack.cardPools ?? []).map((p) => [p.id, p.cards])),
    scenarios: byId(pack.scenarios),
    abilityStats: (pack.stats ?? []).filter((s) => (s.kind ?? 'ability') === 'ability').map((s) => s.key),
  };
}

/** Pick the display string for a localizable text field. */
export function text(value: unknown, locale = 'en'): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  if (isRecord(value)) return String(value[locale] ?? Object.values(value)[0] ?? '');
  return String(value);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
