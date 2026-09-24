import { strict as assert } from 'assert';
import { runValidation } from '../../src/validation/rules';
import { TransformationRecorder } from '../../src/pipelines/recorder';
import { Workbook } from '../../src/types/workbook';

function wb(): Workbook {
  return {
    meta: { sourceKind: 'xlsx', sourcePath: '', sheetOrder: ['Sheet1'] },
    sheets: {
      Sheet1: {
        name: 'Sheet1',
        rowCount: 4,
        colCount: 1,
        rows: {
          0: { 0: { raw: 'id', value: 'id', type: 'string' } },
          1: { 0: { raw: 'a', value: 'a', type: 'string' } },
          2: { 0: { raw: 'a', value: 'a', type: 'string' } },
          3: { 0: { raw: '', value: '', type: 'string' } },
        },
        columns: {},
        rowMeta: {},
      },
    },
  };
}

describe('validation', () => {
  it('flags duplicates and required empties', () => {
    const diags = runValidation(wb(), {
      version: 1,
      rules: [
        { column: 'id', kind: 'required' },
        { column: 'id', kind: 'unique' },
      ],
    });
    assert.ok(diags.some((d) => d.ruleId.includes('unique')));
    assert.ok(diags.some((d) => d.ruleId.includes('required')));
  });
});

describe('TransformationRecorder', () => {
  it('records steps only while active', () => {
    const r = new TransformationRecorder();
    r.record('Sheet1', { startRow: 0, startCol: 0, endRow: 1, endCol: 0 }, { kind: 'trimWhitespace' });
    assert.equal(r.getPipeline().steps.length, 0);
    r.start('test');
    r.record('Sheet1', { startRow: 0, startCol: 0, endRow: 1, endCol: 0 }, { kind: 'trimWhitespace' });
    assert.equal(r.getPipeline().steps.length, 1);
    const p = r.stop();
    assert.equal(p.steps.length, 1);
    assert.equal(r.isRecording(), false);
  });
});
