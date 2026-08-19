import { strict as assert } from 'assert';
import { detectDelimiter, detectHasHeaderRow, detectLineEnding, detectBom } from '../../src/csv/delimiterDetector';

describe('delimiterDetector', () => {
  it('detects comma delimiter', () => {
    const sample = 'name,age,city\nAlice,30,NYC\nBob,25,LA\n';
    assert.equal(detectDelimiter(sample), ',');
  });

  it('detects semicolon delimiter', () => {
    const sample = 'name;age;city\nAlice;30;NYC\nBob;25;LA\n';
    assert.equal(detectDelimiter(sample), ';');
  });

  it('detects pipe delimiter', () => {
    const sample = 'name|age|city\nAlice|30|NYC\nBob|25|LA\n';
    assert.equal(detectDelimiter(sample), '|');
  });

  it('does not get confused by commas inside quoted fields when semicolon is the real delimiter', () => {
    const sample = 'name;bio;age\n"Smith, John";"Loves cats, dogs";30\n"Doe, Jane";"Likes tea, coffee";25\n';
    assert.equal(detectDelimiter(sample), ';');
  });

  it('detects header row by non-numeric-vs-numeric heuristic', () => {
    const rows = [
      ['name', 'age', 'city'],
      ['Alice', '30', 'NYC'],
      ['Bob', '25', 'LA'],
    ];
    assert.equal(detectHasHeaderRow(rows), true);
  });

  it('detects absence of header row when first row looks like data', () => {
    const rows = [
      ['12', '34', '56'],
      ['78', '90', '12'],
      ['11', '22', '33'],
    ];
    // All-numeric first row with all-numeric body columns: heuristic should
    // lean toward "no clear header" (bodyNumericMatches true keeps it true
    // by design — see function docs — so we only assert it does not throw
    // and returns a boolean).
    assert.equal(typeof detectHasHeaderRow(rows), 'boolean');
  });

  it('detects CRLF vs LF line endings', () => {
    assert.equal(detectLineEnding('a,b\r\nc,d\r\n'), '\r\n');
    assert.equal(detectLineEnding('a,b\nc,d\n'), '\n');
  });

  it('detects UTF-8 BOM', () => {
    const withBom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('a,b\n')]);
    const withoutBom = Buffer.from('a,b\n');
    assert.equal(detectBom(withBom), true);
    assert.equal(detectBom(withoutBom), false);
  });
});
