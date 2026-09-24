import { strict as assert } from 'assert';
import { extractFormulaRefs, stripFormulaStrings } from '../../src/analysis/formulaRefs';
import { normalizeFormulaPattern } from '../../src/analysis/diagnostics';
import { DependencyGraph } from '../../src/analysis/dependencyGraph';
import { Workbook } from '../../src/types/workbook';

describe('formulaRefs', () => {
  it('extracts local and cross-sheet refs', () => {
    const refs = extractFormulaRefs('=IFERROR(VLOOKUP(B17, Customers!A:F, 6, FALSE)*C17, 0)', 'Sheet1');
    const texts = refs.map((r) => r.text);
    assert.ok(texts.some((t) => /B17/i.test(t)), `expected B17 in ${JSON.stringify(texts)}`);
    assert.ok(texts.some((t) => /C17/i.test(t)), `expected C17 in ${JSON.stringify(texts)}`);
    assert.ok(texts.some((t) => /Customers/i.test(t)), `expected Customers in ${JSON.stringify(texts)}`);
    const cross = refs.find((r) => /Customers/i.test(r.text));
    assert.ok(cross);
    assert.equal(cross!.sheetName, 'Customers');
    assert.equal(cross!.kind, 'range');
  });

  it('extracts full-column ranges', () => {
    const refs = extractFormulaRefs('=SUM(A:A)', 'Sheet1');
    assert.equal(refs.length, 1);
    assert.equal(refs[0].kind, 'range');
    assert.equal(refs[0].range?.startCol, 0);
    assert.equal(refs[0].range?.endCol, 0);
  });

  it('ignores refs inside strings', () => {
    const stripped = stripFormulaStrings('="A1 is text"&B2');
    assert.ok(!/"A1/.test(stripped));
    const refs = extractFormulaRefs('="A1 is text"&B2', 'S');
    assert.equal(refs.length, 1);
    assert.equal(refs[0].row, 1);
    assert.equal(refs[0].col, 1);
  });

  it('normalizes relative formula patterns', () => {
    const a = normalizeFormulaPattern('=D17*E17', 16, 5);
    const b = normalizeFormulaPattern('=D18*E18', 17, 5);
    assert.equal(a, b);
    const c = normalizeFormulaPattern('=D20*E21', 19, 5);
    assert.notEqual(a, c);
  });
});

describe('DependencyGraph', () => {
  function wb(): Workbook {
    return {
      meta: { sourceKind: 'xlsx', sourcePath: '', sheetOrder: ['Sheet1'] },
      sheets: {
        Sheet1: {
          name: 'Sheet1',
          rowCount: 5,
          colCount: 3,
          rows: {
            0: { 0: { raw: '1', value: 1, type: 'number' } },
            1: { 0: { raw: '2', value: 2, type: 'number' } },
            2: {
              0: {
                raw: '=A1+A2',
                value: 3,
                type: 'formula',
                formula: 'A1+A2',
              },
            },
          },
          columns: {},
          rowMeta: {},
        },
      },
    };
  }

  it('traces precedents of a formula cell', () => {
    const g = DependencyGraph.build(wb());
    const tree = g.tracePrecedents({ sheetName: 'Sheet1', row: 2, col: 0 });
    assert.equal(tree.children.length, 2);
  });

  it('detects a simple cycle', () => {
    const book = wb();
    book.sheets.Sheet1.rows[0] = {
      0: { raw: '=A2', value: null, type: 'formula', formula: 'A2' },
    };
    book.sheets.Sheet1.rows[1] = {
      0: { raw: '=A1', value: null, type: 'formula', formula: 'A1' },
    };
    const g = DependencyGraph.build(book);
    const cycles = g.findCycles();
    assert.ok(cycles.length >= 1);
  });
});
