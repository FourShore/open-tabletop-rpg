// Pack validation: JSON Schema first, then cross-references the schema can't
// express (unknown skill ids, missing spawn points, bad expressions...).

import Ajv2020 from 'ajv/dist/2020';
import schema from '../../../spec/schema/pack.schema.json';
import { ExprError, parseExpr } from './expr';
import type { Pack } from './types';

export interface ValidationIssue {
  kind: 'schema' | 'ref' | 'expr';
  path: string;
  message: string;
}

const ajv = new Ajv2020({ allErrors: true, strict: false });
const schemaValidator = ajv.compile(schema);

const BASE_ACTIONS = new Set(['approach', 'flee', 'hold']);
const LOOT_SPECIAL = new Set(['gold', 'xp']);
const ASSET_FIELDS = ['image', 'portrait', 'token', 'icon', 'music', 'background', 'vfx', 'sfx'];
const EXPR_FIELDS = ['amount', 'count', 'dc', 'xp', 'gold', 'hp', 'defense', 'rolls', 'priceModifier', 'perLevel', 'draw', 'distance', 'bonus', 'reviveHp'];

export function validatePack(pack: Pack): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!schemaValidator(pack)) {
    for (const e of schemaValidator.errors ?? []) {
      // if/then branches report a second, less useful error for the same spot.
      if (e.keyword === 'if') continue;
      issues.push({ kind: 'schema', path: e.instancePath || '/', message: e.message ?? 'invalid' });
    }
  }
  issues.push(...checkRefs(pack));
  return issues;
}

function checkRefs(pack: Pack): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const need = (ok: boolean, path: string, message: string, kind: ValidationIssue['kind'] = 'ref') => {
    if (!ok) issues.push({ kind, path, message });
  };
  const ids = (list?: { id: string }[]) => new Set((list ?? []).map((e) => e.id));
  const classes = new Map((pack.classes ?? []).map((c) => [c.id, c]));
  const skills = ids(pack.skills);
  const items = ids(pack.items);
  const enemies = ids(pack.enemies);
  const cards = ids(pack.cards);
  const pools = ids(pack.cardPools);
  const loot = ids(pack.lootTables);
  const conditions = ids(pack.conditions);
  const scenarios = ids(pack.scenarios);
  const assets = new Set(Object.keys(pack.assets ?? {}));
  const stats = new Set((pack.stats ?? []).map((s) => s.key));
  type MapLike = { id: string; width: number; height: number; tiles?: string[]; spawnPoints?: Record<string, unknown> };
  const maps = new Map(((pack.maps ?? []) as MapLike[]).map((m) => [m.id, m]));

  for (const key of ['classes', 'skills', 'items', 'enemies', 'cards', 'maps', 'scenarios', 'lootTables', 'cardPools'] as const) {
    const seen = new Set<string>();
    for (const e of (pack[key] ?? []) as { id: string }[]) {
      need(!seen.has(e.id), `/${key}`, `duplicate id '${e.id}'`);
      seen.add(e.id);
    }
  }

  for (const c of pack.classes ?? []) {
    const at = `/classes/${c.id}`;
    for (const s of [...(c.startingSkills ?? []), ...(c.basicAttack ? [c.basicAttack] : [])]) need(skills.has(s), at, `unknown skill '${s}'`);
    for (const i of c.startingItems ?? []) need(items.has(i), at, `unknown item '${i}'`);
    for (const k of [...Object.keys(c.baseStats ?? {}), ...(c.keyStats ?? [])]) need(stats.has(k), at, `unknown stat '${k}'`);
  }

  for (const s of pack.skills ?? []) {
    for (const entry of s.classes ?? []) {
      const cls = classes.get(entry.class);
      need(!!cls, `/skills/${s.id}`, `unknown class '${entry.class}'`);
      if (cls && entry.branch) {
        need((cls.branches ?? []).some((b) => b.id === entry.branch), `/skills/${s.id}`, `class '${cls.id}' has no branch '${entry.branch}'`);
      }
    }
  }

  type EnemyLike = { id: string; skills?: string[]; behavior?: { do: string }[]; loot?: string };
  for (const e of (pack.enemies ?? []) as unknown as EnemyLike[]) {
    const at = `/enemies/${e.id}`;
    for (const s of e.skills ?? []) need(skills.has(s), at, `unknown skill '${s}'`);
    for (const b of e.behavior ?? []) need(skills.has(b.do) || BASE_ACTIONS.has(b.do), at, `behavior uses unknown action '${b.do}'`);
    if (e.loot) need(loot.has(e.loot), at, `unknown loot table '${e.loot}'`);
  }

  for (const t of pack.lootTables ?? []) {
    for (const entry of t.entries) need(items.has(entry.id) || LOOT_SPECIAL.has(entry.id), `/lootTables/${t.id}`, `unknown item '${entry.id}'`);
  }
  for (const p of pack.cardPools ?? []) {
    for (const entry of p.cards) need(cards.has(entry.id), `/cardPools/${p.id}`, `unknown card '${entry.id}'`);
  }
  for (const sc of pack.scenarios ?? []) {
    for (const d of sc.deck) {
      if ('card' in d) need(cards.has(d.card), `/scenarios/${sc.id}`, `unknown card '${d.card}'`);
      else need(pools.has(d.pool), `/scenarios/${sc.id}`, `unknown pool '${d.pool}'`);
    }
  }
  for (const id of pack.campaign?.startScenarios ?? []) need(scenarios.has(id), '/campaign', `unknown scenario '${id}'`);
  for (const t of pack.rules?.leveling?.statBoostTiles ?? []) {
    need(stats.has(t.stat) || t.stat === 'primary', '/rules/leveling', `unknown stat '${t.stat}'`);
  }

  const symbols = new Set(['.', ...((pack.terrain ?? []) as { symbol?: string }[]).map((t) => t.symbol)]);
  for (const m of maps.values()) {
    const rows = m.tiles ?? [];
    if (!rows.length) continue;
    need(rows.length === m.height, `/maps/${m.id}`, `${rows.length} rows but height ${m.height}`);
    rows.forEach((row, y) => {
      need(row.length === m.width, `/maps/${m.id}`, `row ${y} has ${row.length} columns, width is ${m.width}`);
      for (const ch of new Set(row)) need(symbols.has(ch), `/maps/${m.id}`, `row ${y} uses unknown terrain symbol '${ch}'`);
    });
  }

  walk(pack, '', (path, obj) => {
    if (!path.startsWith('/assets')) {
      for (const f of ASSET_FIELDS) {
        if (typeof obj[f] === 'string') need(assets.has(obj[f] as string), path, `${f} '${obj[f]}' is not in assets`);
      }
    }
    for (const f of EXPR_FIELDS) {
      if (typeof obj[f] === 'string') {
        try {
          parseExpr(obj[f] as string);
        } catch (e) {
          need(false, `${path}/${f}`, (e as ExprError).message, 'expr');
        }
      }
    }
    const type = obj.type;
    if (type === 'condition' || type === 'removeCondition') need(conditions.has(obj.condition as string), path, `unknown condition '${obj.condition}'`);
    if (type === 'insertCard' || type === 'removeCard' || type === 'shuffleIn' || type === 'goto') need(cards.has(obj.card as string), path, `unknown card '${obj.card}'`);
    if (type === 'grant' || type === 'take') {
      if (obj.item) need(items.has(obj.item as string), path, `unknown item '${obj.item}'`);
      if (obj.loot) need(loot.has(obj.loot as string), path, `unknown loot table '${obj.loot}'`);
      if (obj.skill) need(skills.has(obj.skill as string), path, `unknown skill '${obj.skill}'`);
    }
    if (typeof obj.hasSkill === 'string') need(skills.has(obj.hasSkill), path, `hasSkill '${obj.hasSkill}' is not a skill`);
    if (Array.isArray(obj.spawns) && typeof obj.map === 'string') {
      const m = maps.get(obj.map);
      need(!!m, path, `unknown map '${obj.map}'`);
      for (const sp of obj.spawns as { enemy: string; at?: string }[]) {
        need(enemies.has(sp.enemy), path, `unknown enemy '${sp.enemy}'`);
        if (m && sp.at) need(sp.at in (m.spawnPoints ?? {}), path, `map '${m.id}' has no spawn point '${sp.at}'`);
      }
    }
  });
  return issues;
}

function walk(node: unknown, path: string, visit: (path: string, obj: Record<string, unknown>) => void) {
  if (Array.isArray(node)) {
    node.forEach((v, i) => walk(v, `${path}/${i}`, visit));
  } else if (node && typeof node === 'object') {
    const obj = node as Record<string, unknown>;
    visit(path || '/', obj);
    for (const [k, v] of Object.entries(obj)) walk(v, `${path}/${k}`, visit);
  }
}
