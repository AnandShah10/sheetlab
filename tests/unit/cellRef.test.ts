import { strict as assert } from 'assert';
import { colIndexToLetter, colLetterToIndex, toA1, parseA1OrRange } from '../../src/utils/cellRef';

describe('cellRef', () => {
  it('converts column index to letters', () => {
    assert.equal(colIndexToLetter(0), 'A');
    assert.equal(colIndexToLetter(25), 'Z');
    assert.equal(colIndexToLetter(26), 'AA');
    assert.equal(colIndexToLetter(27), 'AB');
    assert.equal(colIndexToLetter(701), 'ZZ');
  });

  it('converts letters back to index (round trip)', () => {
    for (const idx of [0, 1, 25, 26, 27, 51, 52, 701]) {
      assert.equal(colLetterToIndex(colIndexToLetter(idx)), idx);
    }
  });

  it('builds A1 references', () => {
    assert.equal(toA1(0, 0), 'A1');
    assert.equal(toA1(24, 26), 'AA25');
  });

  it('parses single cell references', () => {
    const parsed = parseA1OrRange('B12');
    assert.deepEqual(parsed, { startRow: 11, endRow: 11, startCol: 1, endCol: 1 });
  });

  it('parses range references regardless of corner order', () => {
    const parsed = parseA1OrRange('C10:A1');
    assert.deepEqual(parsed, { startRow: 0, endRow: 9, startCol: 0, endCol: 2 });
  });

  it('handles absolute reference markers', () => {
    const parsed = parseA1OrRange('$B$2');
    assert.deepEqual(parsed, { startRow: 1, endRow: 1, startCol: 1, endCol: 1 });
  });

  it('returns null for invalid references', () => {
    assert.equal(parseA1OrRange('not a ref'), null);
    assert.equal(parseA1OrRange('1A'), null);
  });
});
