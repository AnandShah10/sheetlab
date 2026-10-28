
import * as assert from 'assert';
import { analyzeColumn, buildChartFromColumn } from '../../src/analysis/dataStats';
import { Worksheet, Cell } from '../../src/types/workbook';

function cell(v: string | number): Cell {
  if (typeof v === 'number') return { raw: String(v), value: v, type: 'number' };
  return { raw: v, value: v, type: 'string' };
}

function sheetOf(header: string, values: Array<string | number>): Worksheet {
  const rows: Worksheet['rows'] = { 0: { 0: cell(header) } };
  values.forEach((v, i) => {
    rows[i + 1] = { 0: cell(v) };
  });
  return {
    name: 'Sheet1',
    rows,
    rowCount: values.length + 1,
    colCount: 1,
    columns: {},
    rowMeta: {},
    tables: [],
    freezePane: { row: 0, col: 0 },
  };
}

describe('dataStats', () => {
  it('computes numeric stats', () => {
    const s = analyzeColumn(sheetOf('Score', [10, 20, 30, 40]), 0);
    assert.strictEqual(s.nonBlank, 4);
    assert.strictEqual(s.min, 10);
    assert.strictEqual(s.max, 40);
    assert.strictEqual(s.mean, 25);
    assert.ok(s.histogram && s.histogram.length >= 1);
  });

  it('builds bar chart from categories', () => {
    const ch = buildChartFromColumn(sheetOf('City', ['A', 'A', 'B', 'C', 'A']), 0, 'bar');
    assert.strictEqual(ch.kind, 'bar');
    assert.ok(ch.series[0].values[0] >= 1);
  });
});
