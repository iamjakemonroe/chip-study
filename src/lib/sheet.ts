/** A small spreadsheet: cells hold text, numbers or formulas (=SUM(A1:A5), =B2*1.2, =AVERAGE(B2:B9)),
 * worked out on demand with cycles caught. */

export type Grid = string[][];
export type Value = number | string;

const FUNCS: Record<string, (args: number[]) => number> = {
  SUM: (a) => a.reduce((x, y) => x + y, 0),
  AVERAGE: (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN),
  AVG: (a) => FUNCS.AVERAGE(a),
  MIN: (a) => (a.length ? Math.min(...a) : 0),
  MAX: (a) => (a.length ? Math.max(...a) : 0),
  COUNT: (a) => a.length,
  ROUND: (a) => {
    const p = 10 ** (a[1] ?? 0);
    return Math.round((a[0] ?? 0) * p) / p;
  },
  ABS: (a) => Math.abs(a[0] ?? 0),
  SQRT: (a) => Math.sqrt(a[0] ?? 0),
  POWER: (a) => (a[0] ?? 0) ** (a[1] ?? 1),
  MEDIAN: (a) => {
    if (!a.length) return NaN;
    const s = [...a].sort((x, y) => x - y);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  },
};

export const colName = (c: number): string => {
  let s = '';
  for (let n = c + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};

function colIndex(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

class FormulaError extends Error {}

type Token = { t: 'num'; v: number } | { t: 'ref'; c: number; r: number } | { t: 'op'; v: string } | { t: 'name'; v: string } | { t: '('; } | { t: ')' } | { t: ',' } | { t: ':' };

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) i++;
    else if (/[0-9.]/.test(ch)) {
      const m = /^\d*\.?\d+(?:e[+-]?\d+)?%?/i.exec(src.slice(i))!;
      if (!m) throw new FormulaError();
      const pct = m[0].endsWith('%');
      out.push({ t: 'num', v: parseFloat(m[0]) / (pct ? 100 : 1) });
      i += m[0].length;
    } else if (/[A-Za-z]/.test(ch)) {
      const m = /^([A-Za-z]+)(\d+)?/.exec(src.slice(i))!;
      if (m[2] && /^[A-Za-z]{1,3}$/.test(m[1])) out.push({ t: 'ref', c: colIndex(m[1]), r: Number(m[2]) - 1 });
      else out.push({ t: 'name', v: m[1].toUpperCase() });
      i += m[0].length;
    } else if ('+-*/^'.includes(ch)) {
      out.push({ t: 'op', v: ch });
      i++;
    } else if (ch === '(' || ch === ')' || ch === ',' || ch === ':') {
      out.push({ t: ch } as Token);
      i++;
    } else throw new FormulaError();
  }
  return out;
}

/** Works out the whole grid. */
export function evaluate(grid: Grid): Value[][] {
  const memo = new Map<string, Value>();
  const visiting = new Set<string>();

  const cell = (r: number, c: number): Value => {
    const key = `${r},${c}`;
    if (memo.has(key)) return memo.get(key)!;
    if (visiting.has(key)) throw new FormulaError('#CYCLE');
    const raw = (grid[r]?.[c] ?? '').trim();
    let v: Value;
    if (raw.startsWith('=')) {
      visiting.add(key);
      try {
        v = formula(raw.slice(1));
      } catch (e) {
        v = e instanceof FormulaError && e.message ? e.message : '#ERR';
      } finally {
        visiting.delete(key);
      }
    } else if (raw !== '' && !Number.isNaN(Number(raw.replace(/,/g, '')))) v = Number(raw.replace(/,/g, ''));
    else v = raw;
    memo.set(key, v);
    return v;
  };

  const num = (v: Value): number => {
    if (typeof v === 'number') return v;
    if (v.startsWith('#')) throw new FormulaError(v);
    return v === '' ? 0 : NaN;
  };

  const formula = (src: string): number => {
    const tokens = tokenize(src);
    let at = 0;
    const peek = () => tokens[at];
    const take = () => tokens[at++];
    const values = (): number[] => {
      // A range expands to its numbers; anything else is one value.
      const t = peek();
      const next = tokens[at + 1];
      if (t?.t === 'ref' && next?.t === ':') {
        take();
        take();
        const end = take();
        if (end?.t !== 'ref') throw new FormulaError();
        const out: number[] = [];
        for (let r = Math.min(t.r, end.r); r <= Math.max(t.r, end.r); r++)
          for (let c = Math.min(t.c, end.c); c <= Math.max(t.c, end.c); c++) {
            const v = cell(r, c);
            if (typeof v === 'number') out.push(v);
            else if (v.startsWith('#')) throw new FormulaError(v);
          }
        return out;
      }
      return [expr()];
    };
    const atom = (): number => {
      const t = take();
      if (!t) throw new FormulaError();
      if (t.t === 'num') return t.v;
      if (t.t === 'ref') return num(cell(t.r, t.c));
      if (t.t === 'op' && t.v === '-') return -power();
      if (t.t === 'op' && t.v === '+') return power();
      if (t.t === '(') {
        const v = expr();
        if (take()?.t !== ')') throw new FormulaError();
        return v;
      }
      if (t.t === 'name') {
        const fn = FUNCS[t.v];
        if (!fn || take()?.t !== '(') throw new FormulaError('#NAME');
        const args: number[] = [];
        if (peek()?.t !== ')') {
          args.push(...values());
          while (peek()?.t === ',') {
            take();
            args.push(...values());
          }
        }
        if (take()?.t !== ')') throw new FormulaError();
        return fn(args);
      }
      throw new FormulaError();
    };
    const power = (): number => {
      const base = atom();
      if (peek()?.t === 'op' && (peek() as { v: string }).v === '^') {
        take();
        return base ** power();
      }
      return base;
    };
    const term = (): number => {
      let v = power();
      while (peek()?.t === 'op' && '*/'.includes((peek() as { v: string }).v)) {
        const op = (take() as { v: string }).v;
        const rhs = power();
        if (op === '/' && rhs === 0) throw new FormulaError('#DIV/0');
        v = op === '*' ? v * rhs : v / rhs;
      }
      return v;
    };
    const expr = (): number => {
      let v = term();
      while (peek()?.t === 'op' && '+-'.includes((peek() as { v: string }).v)) {
        const op = (take() as { v: string }).v;
        v = op === '+' ? v + term() : v - term();
      }
      return v;
    };
    const result = expr();
    if (at !== tokens.length) throw new FormulaError();
    if (Number.isNaN(result)) throw new FormulaError('#VALUE');
    return result;
  };

  return grid.map((row, r) => row.map((_, c) => cell(r, c)));
}

export function show(v: Value): string {
  if (typeof v === 'string') return v;
  if (!Number.isFinite(v)) return '#NUM';
  return Number.isInteger(v) && Math.abs(v) < 1e15 ? String(v) : String(Number(v.toPrecision(10)));
}

/** The grid as CSV (worked-out values). */
export function toCsv(values: Value[][]): string {
  return values.map((row) => row.map((v) => {
    const s = show(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(',')).join('\n');
}
