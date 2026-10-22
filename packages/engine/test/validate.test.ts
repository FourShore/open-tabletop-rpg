import { describe, expect, it } from 'vitest';
import { loadPackFromDisk } from '../src/node';
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
