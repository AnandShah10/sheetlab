import { CsvDialect } from '../types/workbook';

const CANDIDATE_DELIMITERS = [',', ';', '\t', '|'];

/**
 * Detect the most likely delimiter by counting occurrences per candidate
 * across a sample of lines, then picking the delimiter with the most
 * consistent (lowest-variance) count per line — a simple, dependency-free
 * heuristic that works well for typical exported CSVs.
 */
export function detectDelimiter(sample: string): string {
  const lines = sample.split(/\r\n|\n/).filter((l) => l.length > 0).slice(0, 25);
  if (lines.length === 0) return ',';

  let best = ',';
  let bestScore = -Infinity;

  for (const delim of CANDIDATE_DELIMITERS) {
    const counts = lines.map((line) => countUnquoted(line, delim));
    if (counts.every((c) => c === 0)) continue;
    const mean = counts.reduce((a, b) => a + b, 0) / counts.length;
    if (mean === 0) continue;
    const variance = counts.reduce((a, b) => a + (b - mean) ** 2, 0) / counts.length;
    // Prefer high mean occurrence with low variance (consistent column count).
    const score = mean - variance * 2;
    if (score > bestScore) {
      bestScore = score;
      best = delim;
    }
  }
  return best;
}

/** Count delimiter occurrences outside of double-quoted spans. */
function countUnquoted(line: string, delim: string): number {
  let inQuotes = false;
  let count = 0;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (!inQuotes && line.startsWith(delim, i)) {
      count++;
    }
  }
  return count;
}

export function detectLineEnding(sample: string): '\n' | '\r\n' {
  return sample.includes('\r\n') ? '\r\n' : '\n';
}

export function detectHasHeaderRow(rows: string[][]): boolean {
  if (rows.length < 2) return true;
  const header = rows[0];
  const body = rows.slice(1, Math.min(rows.length, 20));

  // Heuristic: header row is "header-like" if most of its cells are non-numeric
  // while the equivalent column in the body is often numeric.
  let headerNonNumeric = 0;
  let bodyNumericMatches = 0;
  for (let c = 0; c < header.length; c++) {
    const headerCell = header[c] ?? '';
    if (headerCell.trim() !== '' && isNaN(Number(headerCell))) {
      headerNonNumeric++;
    }
    const bodyNumericCount = body.filter((r) => r[c] !== undefined && r[c] !== '' && !isNaN(Number(r[c]))).length;
    if (bodyNumericCount > body.length / 2) {
      bodyNumericMatches++;
    }
  }
  if (header.length === 0) return true;
  return headerNonNumeric / header.length > 0.5 || bodyNumericMatches > 0;
}

export function detectBom(buffer: Buffer): boolean {
  return buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf;
}

export function detectDialect(text: string, buffer: Buffer, filenameExt: string): CsvDialect {
  const delimiter = filenameExt === '.tsv' ? '\t' : detectDelimiter(text.slice(0, 20000));
  return {
    delimiter,
    quoteChar: '"',
    hasHeaderRow: true, // refined by caller once rows are parsed
    lineEnding: detectLineEnding(text.slice(0, 5000)),
    encoding: detectBom(buffer) ? 'utf8bom' : 'utf8',
  };
}
