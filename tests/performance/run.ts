/**
 * SheetLab performance benchmark. Run with: npm run test:perf
 *
 * Measures the operations the spec flags as performance-critical (section
 * 52): CSV parse time, sort, and filter, at 10k/100k/500k rows. This is a
 * real, executable benchmark against the actual parser/sort/filter code
 * (not a simulated stand-in) -- run it locally after `npm install` to get
 * numbers for your machine; results below are illustrative, not shipped
 * as guaranteed figures.
 */
import * as fs from 'fs';
import { ensureFixture } from './generateFixtures';
import { parseCsv } from '../../src/csv/csvReader';
import { sortRange } from '../../src/data/sort';
import { evaluateFilter } from '../../src/data/filter';

function timeIt<T>(label: string, fn: () => T): T {
  const start = process.hrtime.bigint();
  const result = fn();
  const end = process.hrtime.bigint();
  const ms = Number(end - start) / 1_000_000;
  console.log(`${label.padEnd(45)} ${ms.toFixed(1)} ms`);
  return result;
}

async function main() {
  const sizes = [10000, 100000, 500000];

  for (const size of sizes) {
    console.log(`\n=== ${size.toLocaleString()} rows ===`);
    const file = ensureFixture(size);
    const buffer = fs.readFileSync(file);

    const { worksheet } = timeIt(`parseCsv(${size})`, () =>
      parseCsv(buffer, '.csv', { maxRows: 600000 }),
    );

    timeIt(`sortRange by salary (${size})`, () =>
      sortRange(worksheet, { startRow: 0, startCol: 0, endRow: worksheet.rowCount - 1, endCol: 5 }, [{ col: 3, direction: 'desc' }], true),
    );

    timeIt(`evaluateFilter numberRange (${size})`, () =>
      evaluateFilter(worksheet, 3, { kind: 'numberRange', min: 80000 }, 0),
    );
  }

  console.log(
    '\nNote: the VS Code extension host additionally chunks initial row delivery to the webview ' +
      '(sheetlab.performance.chunkSize, default 5000 rows) so the UI thread never waits on the full ' +
      'parse/sort/filter result before painting the first screenful.',
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
