import { strict as assert } from 'assert';
import { parseCsv } from '../../src/csv/csvReader';
import { serializeCsv } from '../../src/csv/csvWriter';

describe('csvReader', () => {
  it('parses quoted fields with embedded commas and escaped quotes', () => {
    const csv = 'name,quote\n"Smith, John","She said ""hello"""\n';
    const { worksheet } = parseCsv(Buffer.from(csv), '.csv', { maxRows: 1000 });
    assert.equal(worksheet.rows[1][0].value, 'Smith, John');
    assert.equal(worksheet.rows[1][1].value, 'She said "hello"');
  });

  it('parses embedded newlines inside quoted fields', () => {
    const csv = 'name,note\n"Alice","line one\nline two"\n';
    const { worksheet } = parseCsv(Buffer.from(csv), '.csv', { maxRows: 1000 });
    assert.equal(worksheet.rows[1][1].value, 'line one\nline two');
  });

  it('infers numeric, boolean, and string types', () => {
    const csv = 'a,b,c\n42,true,hello\n';
    const { worksheet } = parseCsv(Buffer.from(csv), '.csv', { maxRows: 1000 });
    assert.equal(worksheet.rows[1][0].type, 'number');
    assert.equal(worksheet.rows[1][0].value, 42);
    assert.equal(worksheet.rows[1][1].type, 'boolean');
    assert.equal(worksheet.rows[1][1].value, true);
    assert.equal(worksheet.rows[1][2].type, 'string');
  });

  it('respects the configured max row cap and reports truncation', () => {
    const lines = ['a'];
    for (let i = 0; i < 50; i++) lines.push(String(i));
    const csv = lines.join('\n') + '\n';
    const { worksheet, truncated, droppedRows } = parseCsv(Buffer.from(csv), '.csv', { maxRows: 10 });
    assert.equal(truncated, true);
    assert.equal(worksheet.rowCount, 10);
    assert.equal(droppedRows, 41);
  });

  it('forces tab delimiter for .tsv files', () => {
    const tsv = 'a\tb\tc\n1\t2\t3\n';
    const { dialect } = parseCsv(Buffer.from(tsv), '.tsv', { maxRows: 1000 });
    assert.equal(dialect.delimiter, '\t');
  });
});

describe('csvWriter round-trip', () => {
  it('round-trips a simple CSV through parse -> serialize', () => {
    const original = 'name,age\nAlice,30\nBob,25\n';
    const { worksheet, dialect } = parseCsv(Buffer.from(original), '.csv', { maxRows: 1000 });
    const roundTripped = serializeCsv(worksheet, dialect);
    assert.equal(roundTripped, original);
  });

  it('re-quotes a field that contains the delimiter on write', () => {
    const original = 'name,note\n"Smith, John",hi\n';
    const { worksheet, dialect } = parseCsv(Buffer.from(original), '.csv', { maxRows: 1000 });
    const roundTripped = serializeCsv(worksheet, dialect);
    assert.ok(roundTripped.includes('"Smith, John"'));
  });
});
