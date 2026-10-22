import { describe, expect, it } from 'vitest';
import { evalExpr, evalInt, ExprError, exprNames } from '../src/expr';
import { createRng } from '../src/rng';

describe('expressions', () => {
  it('does arithmetic with precedence and names', () => {
    expect(evalExpr('10 + dex * 2', { dex: 3 }).value).toBe(16);
    expect(evalExpr('(1 + partySize) / 2', { partySize: 4 }).value).toBe(2.5);
    expect(evalInt('maxHp / 4', { maxHp: 15 })).toBe(3);
    expect(evalExpr('-2 + 5', {}).value).toBe(3);
  });

  it('keeps dice within sane limits, since packs come from anyone', () => {
    const rng = createRng(1);
    expect(() => evalExpr('100d1000', {}, rng)).not.toThrow();
    expect(() => evalExpr('1000000d6', {}, rng)).toThrow(ExprError);
    expect(() => evalExpr('2d100000', {}, rng)).toThrow(ExprError);
    expect(() => evalExpr('2d0', {}, rng)).toThrow(ExprError);
  });

  it('supports functions', () => {
    expect(evalExpr('max(1, floor(partySize / 2))', { partySize: 1 }).value).toBe(1);
    expect(evalExpr('ceil(7 / 2) + min(3, 9)', {}).value).toBe(7);
  });

  it('rolls dice within range and records each die', () => {
    const rng = createRng(1);
    for (let i = 0; i < 200; i++) {
      const r = evalExpr('2d6+str', { str: 3 }, rng);
      expect(r.rolls).toHaveLength(2);
      expect(r.value).toBeGreaterThanOrEqual(5);
      expect(r.value).toBeLessThanOrEqual(15);
    }
    expect(evalExpr('d20', {}, rng).rolls[0].sides).toBe(20);
  });

  it('does not confuse stat names with dice', () => {
    expect(evalExpr('dex + d4', { dex: 2 }, createRng(3)).rolls).toHaveLength(1);
  });

  it('reports unknown names, functions and bad syntax', () => {
    expect(() => evalExpr('str + wis', { str: 1 })).toThrow(ExprError);
    expect(() => evalExpr('sqrt(4)', {})).toThrow(/Unknown function/);
    expect(() => evalExpr('1 +', {})).toThrow(ExprError);
    expect(() => evalExpr('(1 + 2', {})).toThrow(ExprError);
  });

  it('lists the names an expression uses', () => {
    expect(exprNames('1d8 + str + max(level, partySize)').sort()).toEqual(['level', 'partySize', 'str']);
  });
});
