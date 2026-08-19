import { QueryErrorPayload, QueryResultPayload, Workbook } from '../types/workbook';
import { Condition, ParsedQuery, parseQuery, QueryParseError, SelectItem } from './queryParser';

/**
 * Executes SLQL against the workbook's in-memory sheets and returns a result
 * grid. Per spec section 45 (query safety), this NEVER mutates the source
 * workbook — it only reads cell values and returns a fresh table. Turning a
 * result into new data (a new worksheet, a CSV/XLSX export) is a separate,
 * explicit, user-initiated step handled by commands/query.ts.
 */
export function runQuery(workbook: Workbook, sql: string, maxResultRows: number): QueryResultPayload | QueryErrorPayload {
  const start = Date.now();
  let parsed: ParsedQuery;
  try {
    parsed = parseQuery(sql);
  } catch (err) {
    if (err instanceof QueryParseError) {
      return { message: err.message, column: err.position, expression: err.nearText };
    }
    return { message: err instanceof Error ? err.message : 'Unknown query parse error' };
  }

  const sheet = workbook.sheets[parsed.from];
  if (!sheet) {
    return { message: `Unknown sheet "${parsed.from}". Available sheets: ${workbook.meta.sheetOrder.join(', ')}` };
  }

  // Build a header-indexed row table: first non-empty row is treated as the header.
  const rowIndices = Object.keys(sheet.rows).map(Number).sort((a, b) => a - b);
  if (rowIndices.length === 0) {
    return { columns: [], rows: [], rowCount: 0, truncated: false, elapsedMs: Date.now() - start };
  }
  const headerRowIdx = rowIndices[0];
  const headerRow = sheet.rows[headerRowIdx];
  const colIndices = Object.keys(headerRow).map(Number).sort((a, b) => a - b);
  const headerNames = colIndices.map((c) => String(headerRow[c]?.value ?? `Col${c + 1}`));
  const colNameToIndex = new Map(headerNames.map((name, i) => [name, colIndices[i]]));

  for (const item of parsed.select) {
    if (item.column !== '*' && !colNameToIndex.has(item.column)) {
      return { message: `Unknown column "${item.column}" in sheet "${parsed.from}". Available columns: ${headerNames.join(', ')}` };
    }
  }
  for (const cond of parsed.where) {
    if (!colNameToIndex.has(cond.column)) {
      return { message: `Unknown column "${cond.column}" in WHERE clause. Available columns: ${headerNames.join(', ')}` };
    }
  }

  let dataRows = rowIndices.slice(1).map((r) => sheet.rows[r] ?? {});

  // WHERE
  if (parsed.where.length > 0) {
    dataRows = dataRows.filter((row) => evaluateWhere(row, parsed.where, colNameToIndex));
  }

  let columns: string[];
  let outputRows: (string | number | boolean | null)[][];

  if (parsed.groupBy.length > 0 || parsed.select.some((s) => s.aggFn)) {
    const result = executeAggregation(dataRows, parsed, colNameToIndex, headerNames);
    columns = result.columns;
    outputRows = result.rows;
  } else {
    const items: SelectItem[] =
      parsed.select.length === 1 && parsed.select[0].column === '*'
        ? headerNames.map((name) => ({ column: name }))
        : parsed.select;
    columns = items.map((it) => it.alias ?? it.column);
    outputRows = dataRows.map((row) =>
      items.map((it) => {
        const idx = colNameToIndex.get(it.column);
        return idx !== undefined ? (row[idx]?.value ?? null) : null;
      }),
    );
  }

  // ORDER BY
  if (parsed.orderBy.length > 0) {
    const colPositions = parsed.orderBy.map((o) => ({
      pos: columns.indexOf(o.column),
      direction: o.direction,
    }));
    if (colPositions.every((c) => c.pos >= 0)) {
      outputRows.sort((a, b) => {
        for (const { pos, direction } of colPositions) {
          const cmp = compareValues(a[pos], b[pos]);
          if (cmp !== 0) return direction === 'ASC' ? cmp : -cmp;
        }
        return 0;
      });
    }
  }

  const truncated = outputRows.length > maxResultRows;
  const finalRows = truncated ? outputRows.slice(0, maxResultRows) : outputRows;
  if (parsed.limit !== undefined) {
    return {
      columns,
      rows: finalRows.slice(0, parsed.limit),
      rowCount: finalRows.slice(0, parsed.limit).length,
      truncated,
      elapsedMs: Date.now() - start,
    };
  }

  return { columns, rows: finalRows, rowCount: finalRows.length, truncated, elapsedMs: Date.now() - start };
}

function evaluateWhere(
  row: Record<number, { value: string | number | boolean | null }>,
  conditions: Condition[],
  colNameToIndex: Map<string, number>,
): boolean {
  let result: boolean | undefined;
  let pendingConnector: 'AND' | 'OR' | undefined;

  for (const cond of conditions) {
    const idx = colNameToIndex.get(cond.column);
    const cellValue = idx !== undefined ? (row[idx]?.value ?? null) : null;
    const matches = compareCondition(cellValue, cond);

    if (result === undefined) {
      result = matches;
    } else if (pendingConnector === 'OR') {
      result = result || matches;
    } else {
      result = result && matches;
    }
    pendingConnector = cond.connector;
  }
  return result ?? true;
}

function compareCondition(cellValue: string | number | boolean | null, cond: Condition): boolean {
  if (cond.value === null) {
    return cond.op === '=' ? cellValue === null : cellValue !== null;
  }
  const cv = typeof cellValue === 'boolean' ? String(cellValue) : cellValue;
  switch (cond.op) {
    case '=':
      return String(cv) === String(cond.value) || Number(cv) === Number(cond.value);
    case '!=':
    case '<>':
      return !(String(cv) === String(cond.value) || Number(cv) === Number(cond.value));
    case '<':
      return Number(cv) < Number(cond.value);
    case '<=':
      return Number(cv) <= Number(cond.value);
    case '>':
      return Number(cv) > Number(cond.value);
    case '>=':
      return Number(cv) >= Number(cond.value);
    default:
      return false;
  }
}

function executeAggregation(
  rows: Record<number, { value: string | number | boolean | null }>[],
  parsed: ParsedQuery,
  colNameToIndex: Map<string, number>,
  _headerNames: string[],
): { columns: string[]; rows: (string | number | boolean | null)[][] } {
  const groupKeyOf = (row: Record<number, { value: string | number | boolean | null }>) =>
    parsed.groupBy.map((col) => String(row[colNameToIndex.get(col) ?? -1]?.value ?? '')).join('\u0001');

  const groups = new Map<string, typeof rows>();
  for (const row of rows) {
    const key = parsed.groupBy.length > 0 ? groupKeyOf(row) : '__all__';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(row);
  }

  const columns = parsed.select.map((it) => it.alias ?? (it.aggFn ? `${it.aggFn}(${it.column})` : it.column));
  const outputRows: (string | number | boolean | null)[][] = [];

  for (const groupRows of groups.values()) {
    const outputRow: (string | number | boolean | null)[] = [];
    for (const item of parsed.select) {
      if (item.aggFn) {
        outputRow.push(computeAgg(groupRows, item, colNameToIndex));
      } else {
        const idx = colNameToIndex.get(item.column);
        outputRow.push(idx !== undefined ? (groupRows[0]?.[idx]?.value ?? null) : null);
      }
    }
    outputRows.push(outputRow);
  }

  return { columns, rows: outputRows };
}

function computeAgg(
  rows: Record<number, { value: string | number | boolean | null }>[],
  item: SelectItem,
  colNameToIndex: Map<string, number>,
): number {
  if (item.aggFn === 'COUNT' && item.column === '*') return rows.length;
  const idx = colNameToIndex.get(item.column);
  const values = rows.map((r) => (idx !== undefined ? r[idx]?.value : null));
  const numeric = values.filter((v): v is number => typeof v === 'number');

  switch (item.aggFn) {
    case 'SUM':
      return numeric.reduce((a, b) => a + b, 0);
    case 'COUNT':
      return values.filter((v) => v !== null && v !== undefined).length;
    case 'AVG':
      return numeric.length ? numeric.reduce((a, b) => a + b, 0) / numeric.length : 0;
    case 'MIN':
      return numeric.length ? Math.min(...numeric) : 0;
    case 'MAX':
      return numeric.length ? Math.max(...numeric) : 0;
    default:
      return 0;
  }
}

function compareValues(a: string | number | boolean | null, b: string | number | boolean | null): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a ?? '').localeCompare(String(b ?? ''), undefined, { numeric: true });
}
