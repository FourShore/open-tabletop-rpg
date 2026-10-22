// Expression language used throughout packs: "1d8+str", "1 + partySize",
// "maxHp / 2", "max(1, floor(partySize / 2))".
//
// Grammar:
//   expr   := term (('+' | '-') term)*
//   term   := unary (('*' | '/') unary)*
//   unary  := '-' unary | atom
//   atom   := number | dice | name | name '(' expr (',' expr)* ')' | '(' expr ')'
//   dice   := [count] 'd' sides        e.g. d20, 2d6

import type { Expr } from './types';
import type { Rng } from './rng';

const MAX_DICE = 100;
const MAX_SIDES = 1000;

export type Scope = Record<string, number>;

type Node =
  | { k: 'num'; v: number }
  | { k: 'dice'; count: number; sides: number }
  | { k: 'var'; name: string }
  | { k: 'call'; fn: string; args: Node[] }
  | { k: 'neg'; arg: Node }
  | { k: 'bin'; op: '+' | '-' | '*' | '/'; a: Node; b: Node };

const FUNCTIONS: Record<string, (...args: number[]) => number> = {
  min: Math.min,
  max: Math.max,
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
  abs: Math.abs,
};

export class ExprError extends Error {}

const cache = new Map<string, Node>();

export function parseExpr(src: string): Node {
  const hit = cache.get(src);
  if (hit) return hit;
  const tokens = src.match(/\d*\.?\d+d\d+|d\d+|\d*\.\d+|\d+|[A-Za-z_][A-Za-z0-9_]*|[-+*/(),]|\S/g) ?? [];
  let i = 0;
  const peek = () => tokens[i];
  const take = (want?: string) => {
    const t = tokens[i++];
    if (want !== undefined && t !== want) throw new ExprError(`Expected '${want}' in "${src}", got '${t ?? 'end'}'`);
    return t;
  };

  const atom = (): Node => {
    const t = take();
    if (t === undefined) throw new ExprError(`Unexpected end of "${src}"`);
    if (t === '(') {
      const n = expr();
      take(')');
      return n;
    }
    const dice = /^(\d*)d(\d+)$/.exec(t);
    if (dice) {
      const count = dice[1] ? Number(dice[1]) : 1;
      const sides = Number(dice[2]);
      // Packs can come from anyone; keep a single roll cheap.
      if (count > MAX_DICE || sides > MAX_SIDES || sides < 1) throw new ExprError(`Dice must be 1-${MAX_DICE} dice of 1-${MAX_SIDES} sides in "${src}"`);
      return { k: 'dice', count, sides };
    }
    if (/^\d*\.?\d+$/.test(t)) return { k: 'num', v: Number(t) };
    if (/^[A-Za-z_]/.test(t)) {
      if (peek() === '(') {
        if (!FUNCTIONS[t]) throw new ExprError(`Unknown function '${t}' in "${src}"`);
        take('(');
        const args = [expr()];
        while (peek() === ',') {
          take(',');
          args.push(expr());
        }
        take(')');
        return { k: 'call', fn: t, args };
      }
      return { k: 'var', name: t };
    }
    throw new ExprError(`Unexpected '${t}' in "${src}"`);
  };
  const unary = (): Node => {
    if (peek() === '-') {
      take();
      return { k: 'neg', arg: unary() };
    }
    return atom();
  };
  const term = (): Node => {
    let n = unary();
    while (peek() === '*' || peek() === '/') n = { k: 'bin', op: take() as '*' | '/', a: n, b: unary() };
    return n;
  };
  const expr = (): Node => {
    let n = term();
    while (peek() === '+' || peek() === '-') n = { k: 'bin', op: take() as '+' | '-', a: n, b: term() };
    return n;
  };

  const root = expr();
  if (i < tokens.length) throw new ExprError(`Unexpected '${tokens[i]}' in "${src}"`);
  cache.set(src, root);
  return root;
}

export interface EvalResult {
  value: number;
  /** Every die rolled, in order, for display. */
  rolls: { sides: number; value: number }[];
}

export function evalExpr(expr: Expr, scope: Scope, rng?: Rng): EvalResult {
  const rolls: EvalResult['rolls'] = [];
  if (typeof expr === 'number') return { value: expr, rolls };
  const walk = (n: Node): number => {
    switch (n.k) {
      case 'num':
        return n.v;
      case 'dice': {
        if (!rng) throw new ExprError('Dice need an RNG');
        let sum = 0;
        for (let j = 0; j < n.count; j++) {
          const value = rng.die(n.sides);
          rolls.push({ sides: n.sides, value });
          sum += value;
        }
        return sum;
      }
      case 'var':
        if (!(n.name in scope)) throw new ExprError(`Unknown name '${n.name}' in "${expr}"`);
        return scope[n.name];
      case 'call':
        return FUNCTIONS[n.fn](...n.args.map(walk));
      case 'neg':
        return -walk(n.arg);
      case 'bin': {
        const a = walk(n.a);
        const b = walk(n.b);
        if (n.op === '+') return a + b;
        if (n.op === '-') return a - b;
        if (n.op === '*') return a * b;
        return b === 0 ? 0 : a / b;
      }
    }
  };
  return { value: walk(parseExpr(expr)), rolls };
}

/** Evaluate and round down: the usual form for HP, damage, gold and counts. */
export function evalInt(expr: Expr, scope: Scope, rng?: Rng): number {
  return Math.floor(evalExpr(expr, scope, rng).value);
}

/** Names an expression refers to, for validation. */
export function exprNames(expr: Expr): string[] {
  if (typeof expr === 'number') return [];
  const out = new Set<string>();
  const walk = (n: Node) => {
    if (n.k === 'var') out.add(n.name);
    else if (n.k === 'call') n.args.forEach(walk);
    else if (n.k === 'neg') walk(n.arg);
    else if (n.k === 'bin') (walk(n.a), walk(n.b));
  };
  walk(parseExpr(expr));
  return [...out];
}
