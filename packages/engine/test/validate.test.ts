import { describe, expect, it } from 'vitest';
import { loadPackFromDisk } from '../src/node';
import { loadPackFromUrl } from '../src/pack';
import type { Pack } from '../src/types';
import { validatePack } from '../src/validate';
import { EXAMPLE_PACK } from './helpers';

describe('validatePack', () => {
  it('accepts the example pack', async () => {
    expect(validatePack(await loadPackFromDisk(EXAMPLE_PACK))).toEqual([]);
  });

  it('reports schema errors, broken references and bad expressions', async () => {
    const pack: Pack = structuredClone(await loadPackFromDisk(EXAMPLE_PACK));
    pack.cards!.find((c) => c.id === 'rickety-bridge')!.check!.mode = 'solo' as never;
    pack.cards!.find((c) => c.id === 'goblin-ambush')!.combat!.spawns[0].enemy = 'dragon';
    pack.skills!.find((s) => s.id === 'shield-wall')!.classes[0].branch = 'nope';
    pack.cards!.find((c) => c.id === 'road-begins')!.outcomes![0].gold = '5 +';
    const issues = validatePack(pack);
    const messages = issues.map((i) => `${i.kind}: ${i.message}`);
    expect(messages).toContainEqual(expect.stringMatching(/^schema: must be equal to one of the allowed values/));
    expect(messages).toContain("ref: unknown enemy 'dragon'");
    expect(messages).toContain("ref: class 'knight' has no branch 'nope'");
    expect(messages).toContainEqual(expect.stringMatching(/^expr: Unexpected end/));
  });
});

describe('loadPackFromUrl', () => {
  it('fetches the manifest and its includes next to it', async () => {
    const { readFile } = await import('node:fs/promises');
    const dir = new URL('../../../spec/example-pack/', import.meta.url);
    const seen: string[] = [];
    const fakeFetch = (async (url: string) => {
      seen.push(url);
      const rel = url.replace('https://packs.example/hollow/', '');
      return new Response(await readFile(new URL(rel, dir), 'utf8'));
    }) as typeof fetch;
    const pack = await loadPackFromUrl('https://packs.example/hollow/pack.json', fakeFetch);
    expect(pack.id).toBe('core.hollow-road');
    expect(pack.scenarios?.length).toBe(2);
    expect(seen[0]).toBe('https://packs.example/hollow/pack.json');
    expect(seen).toContain('https://packs.example/hollow/story.json');
    expect(validatePack(pack)).toEqual([]);
  });

  it('explains what went wrong', async () => {
    const status = (code: number) => (async () => new Response('nope', { status: code })) as unknown as typeof fetch;
    await expect(loadPackFromUrl('ftp://x/pack.json')).rejects.toThrow(/http/);
    await expect(loadPackFromUrl('not a url')).rejects.toThrow(/not a URL/);
    await expect(loadPackFromUrl('https://x.test/pack.json', status(404))).rejects.toThrow(/answered 404/);
    await expect(loadPackFromUrl('https://x.test/pack.json', (async () => new Response('{oops')) as unknown as typeof fetch)).rejects.toThrow(/valid JSON/);
    const offline = (async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    await expect(loadPackFromUrl('https://x.test/pack.json', offline)).rejects.toThrow(/cross-origin/);
  });
});

describe('the pack gallery', () => {
  it('lists one built-in pack and only https URLs otherwise', async () => {
    const { default: gallery } = await import('../../../spec/gallery.json');
    const ids = gallery.packs.map((p: { id: string }) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(gallery.packs.filter((p: { builtin?: boolean }) => p.builtin)).toHaveLength(1);
    for (const p of gallery.packs as { builtin?: boolean; url?: string; name: string; description: string }[]) {
      expect(p.name && p.description).toBeTruthy();
      if (!p.builtin) expect(p.url).toMatch(/^https:\/\/.+\.json$/);
    }
  });
});
