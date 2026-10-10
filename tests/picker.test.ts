import { describe, expect, it } from 'vitest';
import { ELEMENTS } from '../src/gallery/data';
import { searchElements, tableCell } from '../src/ui/picker';

describe('element picker', () => {
  it('gives every element its own cell', () => {
    const seen = new Set(ELEMENTS.map((e) => { const { row, col } = tableCell(e); return `${row},${col}`; }));
    expect(seen.size).toBe(ELEMENTS.length);
  });
  it('puts the f block on its own rows', () => {
    expect(tableCell(ELEMENTS[56])).toEqual({ row: 9, col: 3 }); // La
    expect(tableCell(ELEMENTS[102])).toEqual({ row: 10, col: 17 }); // Lr
    expect(tableCell(ELEMENTS[71])).toEqual({ row: 6, col: 4 }); // Hf
    expect(tableCell(ELEMENTS[0])).toEqual({ row: 1, col: 1 });
    expect(tableCell(ELEMENTS[1])).toEqual({ row: 1, col: 18 });
  });
  it('finds by symbol, name and number', () => {
    expect(searchElements('fe')[0].name).toBe('Iron');
    expect(searchElements('carb')[0].symbol).toBe('C');
    expect(searchElements('26')[0].symbol).toBe('Fe');
    expect(searchElements('n')[0].symbol).toBe('N');
    expect(searchElements('')).toEqual([]);
  });
});
