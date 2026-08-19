/**
 * Generates synthetic CSV fixtures at the row counts referenced in the spec
 * (10k / 100k / 500k) so the benchmark script has something realistic to
 * parse, sort, and filter without shipping large binary fixtures in the repo.
 */
import * as fs from 'fs';
import * as path from 'path';

function generateCsv(rows: number): string {
  const lines = ['id,name,department,salary,hired_date,active'];
  const departments = ['Engineering', 'Sales', 'Marketing', 'Support', 'Finance'];
  for (let i = 0; i < rows; i++) {
    const dept = departments[i % departments.length];
    const salary = 40000 + ((i * 37) % 90000);
    const year = 2015 + (i % 10);
    lines.push(`${i},Employee ${i},${dept},${salary},${year}-01-15,${i % 3 === 0 ? 'true' : 'false'}`);
  }
  return lines.join('\n') + '\n';
}

export function ensureFixture(rows: number): string {
  const dir = path.join(__dirname, '..', 'fixtures');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `generated_${rows}.csv`);
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, generateCsv(rows));
  }
  return file;
}

if (require.main === module) {
  for (const n of [10000, 100000, 500000]) {
    const file = ensureFixture(n);
    console.log(`Generated ${file}`);
  }
}
