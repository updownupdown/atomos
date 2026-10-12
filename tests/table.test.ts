import { describe, expect, it } from 'vitest';
import { elementAt } from '../src/gallery/data';
import { roomState } from '../src/ui/elementlist';
import { readTableState, tableColumns, tableRows } from '../src/gallery/table';

describe('Tables', () => {
  it('says what each element is at room temperature', () => {
    expect(roomState(elementAt(80))).toBe('Liquid'); // mercury
    expect(roomState(elementAt(35))).toBe('Liquid'); // bromine
    expect(roomState(elementAt(31))).toBe('Solid'); // gallium melts at 30 °C
    expect(roomState(elementAt(8))).toBe('Gas');
    expect(roomState(elementAt(26))).toBe('Solid');
  });
  it('falls back to plain choices for a bad save', () => {
    expect(readTableState('nonsense')).toEqual(readTableState(null));
    const st = readTableState(JSON.stringify({ sort: 'melt', desc: true, group: 'block', filters: { block: ['d', 'x'], period: [3] } }));
    expect(st).toMatchObject({ sort: 'melt', desc: true, group: 'block', filters: { block: ['d'], period: [], series: [], state: [] } });
  });
  it('shows symbol, number and name, then the sorted and filtered columns', () => {
    const st = readTableState(null);
    expect(tableColumns(st)).toEqual(['symbol', 'z', 'name']);
    st.sort = 'density';
    st.filters.block = ['p'];
    st.filters.state = ['Gas'];
    expect(tableColumns(st)).toEqual(['symbol', 'z', 'name', 'density', 'block', 'state']);
    st.sort = 'name';
    expect(tableColumns(st)).toEqual(['symbol', 'z', 'name', 'block', 'state']);
  });
  it('filters, sorts and groups', () => {
    const st = readTableState(null);
    st.filters.state = ['Liquid'];
    expect(tableRows(st)[0].rows.map((e) => e.symbol).sort()).toEqual(['Br', 'Hg']);
    st.filters.state = [];
    st.group = 'period';
    const secs = tableRows(st);
    expect(secs.map((s) => s.title)).toEqual([1, 2, 3, 4, 5, 6, 7].map((p) => `Period ${p}`));
    expect(secs[1].rows.map((e) => e.z)).toEqual([3, 4, 5, 6, 7, 8, 9, 10]);
    st.desc = true;
    expect(tableRows(st)[0].rows.map((e) => e.z)).toEqual([2, 1]);
    st.group = 'block';
    st.filters.period = ['2'];
    expect(tableRows(st).map((s) => s.title)).toEqual(['s block', 'p block']);
  });
  it('searches inside the filters', () => {
    const st = readTableState(null);
    expect(tableRows(st, 'iron')[0].rows[0].symbol).toBe('Fe');
    st.filters.block = ['s'];
    expect(tableRows(st, 'iron')[0].rows).toEqual([]);
  });
});
