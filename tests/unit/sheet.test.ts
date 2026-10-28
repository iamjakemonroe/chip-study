import { describe, expect, it } from 'vitest';
import { colName, evaluate, show, toCsv } from '../../src/lib/sheet.ts';

describe('the table tool', () => {
  it('names columns like a spreadsheet', () => {
    expect([0, 1, 25, 26, 27, 701, 702].map(colName)).toEqual(['A', 'B', 'Z', 'AA', 'AB', 'ZZ', 'AAA']);
  });
  it('reads numbers and text', () => {
    expect(evaluate([['Item', '12', '1,500', ' 3.5 ']])[0]).toEqual(['Item', 12, 1500, 3.5]);
  });
  it('works out formulas with refs, ranges and functions', () => {
    const v = evaluate([
      ['Price', 'Qty', 'Total'],
      ['2.5', '4', '=A2*B2'],
      ['10', '3', '=A3*B3'],
      ['', 'Sum', '=SUM(C2:C3)'],
      ['', 'Avg', '=AVERAGE(A2:A3)'],
      ['', 'Mix', '=ROUND(C4 / 3, 2) + MAX(A2:B3, 100) - 2^3'],
      ['', 'Pct', '=200 * 15%'],
      ['', 'Median', '=MEDIAN(A2:B3)'],
    ]);
    expect(v[1][2]).toBe(10);
    expect(v[3][2]).toBe(40);
    expect(v[4][2]).toBe(6.25);
    expect(v[5][2]).toBeCloseTo(13.33 + 100 - 8);
    expect(v[6][2]).toBe(30);
    expect(v[7][2]).toBe(3.5);
  });
  it('catches errors calmly', () => {
    const v = evaluate([['=A1+1', '=1/0', '=NOPE(1)', '=1+', '=A5*2', '="x"', 'word', '=G1*2']]);
    expect(v[0][0]).toBe('#CYCLE');
    expect(v[0][1]).toBe('#DIV/0');
    expect(v[0][2]).toBe('#NAME');
    expect(v[0][3]).toBe('#ERR');
    expect(v[0][4]).toBe(0);
    expect(v[0][5]).toBe('#ERR');
    expect(v[0][7]).toBe('#VALUE');
  });
  it('an error spreads to what uses it', () => {
    const v = evaluate([['=1/0', '=A1+1', '=SUM(A1:B1)']]);
    expect(v[0]).toEqual(['#DIV/0', '#DIV/0', '#DIV/0']);
  });
  it('shows and exports values', () => {
    expect(show(0.1 + 0.2)).toBe('0.3');
    expect(show(1e21)).toBe('1e+21');
    expect(toCsv([['a,b', 1], ['say "hi"', 2.5]])).toBe('"a,b",1\n"say ""hi""",2.5');
  });
});
