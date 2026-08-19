import { strict as assert } from 'assert';
import { UndoStack } from '../../src/services/undoService';
import { Worksheet } from '../../src/types/workbook';

function sheet(marker: string): Worksheet {
  return { name: marker, rowCount: 0, colCount: 0, rows: {}, columns: {}, rowMeta: {} };
}

describe('UndoStack', () => {
  it('undo returns the "before" snapshot and redo returns "after"', () => {
    const stack = new UndoStack();
    stack.push({ sheetName: 'S', before: sheet('v0'), after: sheet('v1'), label: 'edit' });
    assert.equal(stack.canUndo(), true);
    assert.equal(stack.canRedo(), false);

    const undone = stack.undo();
    assert.equal(undone?.before.name, 'v0');
    assert.equal(stack.canRedo(), true);

    const redone = stack.redo();
    assert.equal(redone?.after.name, 'v1');
  });

  it('discards the redo tail when a new edit is pushed after an undo', () => {
    const stack = new UndoStack();
    stack.push({ sheetName: 'S', before: sheet('a0'), after: sheet('a1'), label: '1' });
    stack.push({ sheetName: 'S', before: sheet('b0'), after: sheet('b1'), label: '2' });
    stack.undo();
    assert.equal(stack.canRedo(), true);
    stack.push({ sheetName: 'S', before: sheet('c0'), after: sheet('c1'), label: '3' });
    assert.equal(stack.canRedo(), false);
  });

  it('caps history at maxEntries to bound memory', () => {
    const stack = new UndoStack();
    for (let i = 0; i < 250; i++) {
      stack.push({ sheetName: 'S', before: sheet(`v${i}`), after: sheet(`v${i + 1}`), label: String(i) });
    }
    let count = 0;
    while (stack.canUndo()) {
      stack.undo();
      count++;
    }
    assert.ok(count <= 200);
  });
});
