import { ExcelTableMeta, Worksheet } from '../types/workbook';
import { colIndexToLetter } from '../utils/cellRef';

/**
 * Excel structured references (`SalesTable[Amount]`, `SalesTable[@Amount]`,
 * `SalesTable[#Headers]`, `SalesTable[[Col1]:[Col2]]`, ...) are not
 * something HyperFormula understands natively -- it resolves plain
 * A1/range references only. Rather than leaving formulas that use them
 * silently broken, we rewrite the formula text before it reaches
 * HyperFormula: look up the named table, resolve the specifier against its
 * boundaries, and substitute the equivalent A1 range or single-cell
 * reference.
 *
 * Supported specifier forms:
 *   Table[Column]                    -- whole data column
 *   Table[@Column]                   -- "this row"
 *   Table[#All]                      -- entire table (headers+data+totals)
 *   Table[#Headers]                  -- header row only
 *   Table[#Totals]                   -- totals row only (requires the
 *                                        table's hasTotalsRow to be set --
 *                                        see ExcelTableMeta)
 *   Table[#Data]                     -- data body, all columns (same rows
 *                                        as the bare Table[Column] form)
 *   Table[[Col1]:[Col2]]             -- data body, column range
 *   Table[[#Headers],[Col1]:[Col2]]  -- an item specifier combined with a
 *                                        column range/single column
 *
 * NOT supported: `[#This Row]` as a standalone item outside `@` syntax,
 * and any specifier this parser can't cleanly resolve is left as literal
 * text -- HyperFormula then reports its own parse/name error rather than
 * SheetLab guessing a value. Table names are matched workbook-wide since
 * Excel table names are unique across the whole workbook, not per-sheet.
 */
export function resolveStructuredReferences(
  formula: string,
  currentSheetName: string,
  currentRow: number,
  sheets: Record<string, Worksheet>,
): string {
  let result = '';
  let i = 0;

  while (i < formula.length) {
    const found = tryMatchAt(formula, i, currentSheetName, currentRow, sheets);
    if (found) {
      result += found.replacement;
      i += found.consumed;
    } else {
      result += formula[i];
      i += 1;
    }
  }

  return result;
}

const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_.]*/;

function tryMatchAt(
  formula: string,
  start: number,
  currentSheetName: string,
  currentRow: number,
  sheets: Record<string, Worksheet>,
): { consumed: number; replacement: string } | null {
  const idMatch = IDENTIFIER_PATTERN.exec(formula.slice(start));
  if (!idMatch) return null;
  const tableName = idMatch[0];
  const bracketStart = start + tableName.length;
  if (formula[bracketStart] !== '[') return null;

  const bracketEnd = findMatchingBracket(formula, bracketStart);
  if (bracketEnd === null) return null;

  const innerContent = formula.slice(bracketStart + 1, bracketEnd);
  const consumed = bracketEnd + 1 - start;

  const found = findTable(sheets, tableName);
  if (!found) return null;

  const spec = parseSpecifier(innerContent);
  if (!spec) return null;

  const replacement = resolveSpecifier(spec, found.sheetName, found.table, sheets[found.sheetName], currentSheetName, currentRow);
  if (replacement === null) return null;

  return { consumed, replacement };
}

/** Finds the index of the `]` matching the `[` at `openIndex`, tracking nested bracket depth. */
function findMatchingBracket(formula: string, openIndex: number): number | null {
  let depth = 1;
  for (let j = openIndex + 1; j < formula.length; j++) {
    if (formula[j] === '[') depth++;
    else if (formula[j] === ']') {
      depth--;
      if (depth === 0) return j;
    }
  }
  return null;
}

type TableItem = 'all' | 'headers' | 'totals' | 'data';

interface StructuredSpec {
  thisRow: boolean;
  item: TableItem;
  columns: { start: string; end: string } | null; // null = every column in the table
}

function parseSpecifier(rawContent: string): StructuredSpec | null {
  const content = rawContent.trim();
  if (content === '') return null;

  if (content.startsWith('@')) {
    const colName = stripBrackets(content.slice(1));
    if (colName === '') return null;
    return { thisRow: true, item: 'data', columns: { start: colName, end: colName } };
  }

  // Combined "item,columns" form -- checked before the standalone '#'/'['
  // branches below because in this form the item keyword is ITSELF
  // bracketed (e.g. "[#Headers],[Col1]:[Col2]"), so content.startsWith('[')
  // would otherwise misroute it into the plain column-range parser.
  const commaIndex = findTopLevelComma(content);
  if (commaIndex !== -1) {
    const itemPart = content.slice(0, commaIndex);
    const colPart = content.slice(commaIndex + 1);
    const item = parseItemKeyword(itemPart);
    if (!item) return null;
    const columns = parseColumnPart(colPart);
    if (!columns) return null;
    return { thisRow: false, item, columns };
  }

  if (content.startsWith('#')) {
    const item = parseItemKeyword(content);
    if (!item) return null;
    return { thisRow: false, item, columns: null };
  }

  if (content.startsWith('[')) {
    const columns = parseColumnPart(content);
    if (!columns) return null;
    return { thisRow: false, item: 'data', columns };
  }

  // Bare column name, e.g. Table[Amount].
  const colName = stripBrackets(content);
  if (colName === '') return null;
  return { thisRow: false, item: 'data', columns: { start: colName, end: colName } };
}

function findTopLevelComma(s: string): number {
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '[') depth++;
    else if (s[i] === ']') depth--;
    else if (s[i] === ',' && depth === 0) return i;
  }
  return -1;
}

function parseItemKeyword(raw: string): TableItem | null {
  const word = stripBrackets(raw).toLowerCase();
  if (!word.startsWith('#')) return null;
  const name = word.slice(1);
  if (name === 'all') return 'all';
  if (name === 'headers') return 'headers';
  if (name === 'totals') return 'totals';
  if (name === 'data') return 'data';
  return null;
}

/** Parses `[Col1]:[Col2]` or a single `[Col1]` into a start/end column-name pair. */
function parseColumnPart(raw: string): { start: string; end: string } | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const colonIndex = findTopLevelColon(trimmed);
  if (colonIndex === -1) {
    const name = stripBrackets(trimmed);
    return name === '' ? null : { start: name, end: name };
  }
  const start = stripBrackets(trimmed.slice(0, colonIndex));
  const end = stripBrackets(trimmed.slice(colonIndex + 1));
  if (start === '' || end === '') return null;
  return { start, end };
}

function findTopLevelColon(s: string): number {
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '[') depth++;
    else if (s[i] === ']') depth--;
    else if (s[i] === ':' && depth === 0) return i;
  }
  return -1;
}

function stripBrackets(s: string): string {
  const t = s.trim();
  if (t.startsWith('[') && t.endsWith(']')) return t.slice(1, -1).trim();
  return t;
}

function findTable(
  sheets: Record<string, Worksheet>,
  name: string,
): { sheetName: string; table: ExcelTableMeta } | null {
  for (const [sheetName, sheet] of Object.entries(sheets)) {
    const table = sheet.tables?.find((t) => t.name === name);
    if (table) return { sheetName, table };
  }
  return null;
}

function resolveSpecifier(
  spec: StructuredSpec,
  sheetName: string,
  table: ExcelTableMeta,
  sheet: Worksheet,
  currentSheetName: string,
  currentRow: number,
): string | null {
  const dataStartRow = table.hasHeaderRow ? table.range.startRow + 1 : table.range.startRow;
  const dataEndRow = table.hasTotalsRow ? table.range.endRow - 1 : table.range.endRow;
  const headerRow = table.hasHeaderRow ? table.range.startRow : null;
  const totalsRow = table.hasTotalsRow ? table.range.endRow : null;

  let rowStart: number;
  let rowEnd: number;

  if (spec.thisRow) {
    if (currentRow < dataStartRow || currentRow > dataEndRow) return null; // no "this row" to resolve against
    rowStart = currentRow;
    rowEnd = currentRow;
  } else {
    switch (spec.item) {
      case 'all':
        rowStart = table.range.startRow;
        rowEnd = table.range.endRow;
        break;
      case 'headers':
        if (headerRow === null) return null;
        rowStart = headerRow;
        rowEnd = headerRow;
        break;
      case 'totals':
        if (totalsRow === null) return null;
        rowStart = totalsRow;
        rowEnd = totalsRow;
        break;
      case 'data':
      default:
        if (dataStartRow > dataEndRow) return null; // empty table body
        rowStart = dataStartRow;
        rowEnd = dataEndRow;
    }
  }

  let colStart: number;
  let colEnd: number;
  if (spec.columns === null) {
    colStart = table.range.startCol;
    colEnd = table.range.endCol;
  } else {
    const a = findColumnIndex(sheet, table, spec.columns.start);
    const b = findColumnIndex(sheet, table, spec.columns.end);
    if (a === null || b === null) return null;
    colStart = Math.min(a, b);
    colEnd = Math.max(a, b);
  }

  const sheetPrefix = sheetName !== currentSheetName ? `'${sheetName}'!` : '';
  const startRef = `${colIndexToLetter(colStart)}${rowStart + 1}`;
  const endRef = `${colIndexToLetter(colEnd)}${rowEnd + 1}`;
  return startRef === endRef ? `${sheetPrefix}${startRef}` : `${sheetPrefix}${startRef}:${endRef}`;
}

function findColumnIndex(sheet: Worksheet, table: ExcelTableMeta, columnName: string): number | null {
  if (!table.hasHeaderRow) return null; // no header text to match a column name against
  const headerRow = sheet.rows[table.range.startRow];
  if (!headerRow) return null;
  const target = columnName.toLowerCase();
  for (let c = table.range.startCol; c <= table.range.endCol; c++) {
    const cell = headerRow[c];
    if (cell && String(cell.value ?? '').trim().toLowerCase() === target) return c;
  }
  return null;
}
