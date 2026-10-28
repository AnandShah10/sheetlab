import { QueryErrorPayload, QueryResultPayload, Workbook, Worksheet } from '../types/workbook';
import {
  Condition,
  JoinClause,
  ParsedQuery,
  parseQuery,
  QueryParseError,
  SelectItem,
} from './queryParser';

type CellVal = string | number | boolean | null;
/** Flat row: qualified column key → value */
type FlatRow = Record<string, CellVal>;

/**
 * Executes SLQL against the workbook's in-memory sheets and returns a result
 * grid. Never mutates the source workbook.
 */
export function runQuery(
  workbook: Workbook,
  sql: string,
  maxResultRows: number,
): QueryResultPayload | QueryErrorPayload {
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

  try {
    const baseAlias = parsed.fromAlias || parsed.from;
    const tableMeta = new Map<string, { sheetName: string; headers: string[]; headerToKey: Map<string, string> }>();

    const loadSheet = (sheetName: string, alias: string) => {
      const sheet = workbook.sheets[sheetName];
      if (!sheet) {
        const avail = workbook.meta.sheetOrder.join(', ') || '(none)';
        throw new Error(
          `Unknown sheet "${sheetName}". JOINs only work within the current workbook. Available sheets: ${avail}`,
        );
      }
      const { headers, rows } = sheetToRows(sheet, alias);
      const headerToKey = new Map(headers.map((h) => [h, `${alias}.${h}`]));
      // also allow unqualified header → key when unique later
      tableMeta.set(alias, { sheetName, headers, headerToKey });
      return { alias, headers, rows, headerToKey };
    };

    let left = loadSheet(parsed.from, baseAlias);
    let workingRows = left.rows;
    // Map of all known headers for resolution
    const allHeaders = new Map<string, string>(); // display/lookup name → flat key
    for (const h of left.headers) {
      allHeaders.set(h, `${left.alias}.${h}`);
      allHeaders.set(`${left.alias}.${h}`, `${left.alias}.${h}`);
    }

    for (const join of parsed.joins) {
      const rightAlias = join.alias || join.sheet;
      const right = loadSheet(join.sheet, rightAlias);
      for (const h of right.headers) {
        allHeaders.set(`${right.alias}.${h}`, `${right.alias}.${h}`);
        // Unqualified only if not already present from left
        if (!allHeaders.has(h)) allHeaders.set(h, `${right.alias}.${h}`);
      }

      const pairs = (join.on && join.on.length
        ? join.on
        : join.onLeft && join.onRight
          ? [{ left: join.onLeft, right: join.onRight }]
          : []);
      if (!pairs.length) {
        throw new Error('JOIN is missing ON equality conditions');
      }
      const leftKeys = pairs.map((p) => resolveJoinKey(p.left, allHeaders, left.alias));
      const rightKeys = pairs.map((p) => resolveJoinKey(p.right, allHeaders, right.alias));

      workingRows = performJoin(
        workingRows,
        right.rows,
        leftKeys,
        rightKeys,
        join.type,
        right.headers,
        right.alias,
      );

      // After join, left side is the combined rows
      left = {
        alias: left.alias,
        headers: [...left.headers, ...right.headers.map((h) => `${right.alias}.${h}`)],
        rows: workingRows,
        headerToKey: allHeaders,
      };
    }

    // Validate SELECT / WHERE / GROUP BY column refs (unknown → structured error)
    const available = [...new Set([
      ...left.headers,
      ...[...allHeaders.keys()],
    ])].filter(Boolean).sort();

    const resolveOrThrow = (column: string, tableAlias: string | undefined, where: string) => {
      if (column === '*') return;
      if (tableAlias) {
        const q = `${tableAlias}.${column}`;
        if (!allHeaders.has(q) && !allHeaders.has(column)) {
          throw new Error(
            `Unknown column "${tableAlias}.${column}" in ${where}. Available columns: ${available.join(', ')}`,
          );
        }
        return;
      }
      if (!allHeaders.has(column)) {
        throw new Error(`Unknown column "${column}" in ${where}. Available columns: ${available.join(', ')}`);
      }
    };

    for (const item of parsed.select) {
      if (!item.aggFn || item.column !== '*') {
        resolveOrThrow(item.column, item.tableAlias, 'SELECT');
      }
    }
    for (const cond of parsed.where) {
      resolveOrThrow(cond.column, cond.tableAlias, 'WHERE clause');
    }
    for (const g of parsed.groupBy) {
      resolveOrThrow(g.column, g.tableAlias, 'GROUP BY');
    }

    // WHERE
    if (parsed.where.length > 0) {
      workingRows = workingRows.filter((row) => evaluateWhere(row, parsed.where, allHeaders));
    }

    // SELECT / GROUP BY
    let columns: string[];
    let outputRows: CellVal[][];

    if (parsed.select.length === 1 && parsed.select[0].column === '*' && !parsed.select[0].aggFn) {
      const multi = parsed.joins.length > 0;
      columns = collectColumns(workingRows, multi);
      outputRows = workingRows.map((r) => columns.map((c) => r[c] ?? null));
    } else if (parsed.groupBy.length > 0 || parsed.select.some((s) => s.aggFn)) {
      const grouped = groupAndAggregate(workingRows, parsed, allHeaders);
      columns = grouped.columns;
      outputRows = grouped.rows;
      if (parsed.having?.length) {
        outputRows = applyHaving(outputRows, columns, parsed.having);
      }
    } else {
      columns = parsed.select.map((it) => it.alias ?? (it.tableAlias ? `${it.tableAlias}.${it.column}` : it.column));
      outputRows = workingRows.map((row) =>
        parsed.select.map((item) => {
          const key = resolveColumnKey(item, allHeaders);
          return key ? (row[key] ?? null) : null;
        }),
      );
    }

    // ORDER BY
    if (parsed.orderBy.length > 0) {
      outputRows = sortRows(outputRows, columns, parsed);
    }

    const limit = parsed.limit ?? maxResultRows;
    const truncated = outputRows.length > limit;
    if (truncated) outputRows = outputRows.slice(0, limit);

    return {
      columns,
      rows: outputRows,
      rowCount: outputRows.length,
      truncated,
      elapsedMs: Date.now() - start,
    };
  } catch (err) {
    return { message: err instanceof Error ? err.message : String(err) };
  }
}

function sheetToRows(
  sheet: Worksheet,
  alias: string,
): { headers: string[]; rows: FlatRow[] } {
  const rowIndices = Object.keys(sheet.rows)
    .map(Number)
    .sort((a, b) => a - b);
  if (rowIndices.length === 0) return { headers: [], rows: [] };

  const headerRowIdx = rowIndices[0];
  const headerRow = sheet.rows[headerRowIdx];
  const colIndices = Object.keys(headerRow)
    .map(Number)
    .sort((a, b) => a - b);
  const headers = colIndices.map((c) => String(headerRow[c]?.value ?? `Col${c + 1}`));

  const rows: FlatRow[] = [];
  for (const r of rowIndices.slice(1)) {
    const src = sheet.rows[r] ?? {};
    const flat: FlatRow = {};
    colIndices.forEach((c, i) => {
      const h = headers[i];
      flat[`${alias}.${h}`] = (src[c]?.value ?? null) as CellVal;
      // also store unqualified for single-table convenience
      flat[h] = flat[`${alias}.${h}`];
    });
    rows.push(flat);
  }
  return { headers, rows };
}

function resolveJoinKey(
  ref: { tableAlias?: string; column: string },
  allHeaders: Map<string, string>,
  fallbackAlias: string,
): string {
  if (ref.tableAlias) {
    const k = `${ref.tableAlias}.${ref.column}`;
    if (allHeaders.has(k) || true) return k;
  }
  const qualified = allHeaders.get(ref.column) ?? allHeaders.get(`${fallbackAlias}.${ref.column}`);
  if (qualified) return qualified;
  return ref.tableAlias ? `${ref.tableAlias}.${ref.column}` : `${fallbackAlias}.${ref.column}`;
}

function resolveColumnKey(
  item: { column: string; tableAlias?: string },
  allHeaders: Map<string, string>,
): string | null {
  if (item.column === '*') return null;
  if (item.tableAlias) return `${item.tableAlias}.${item.column}`;
  return allHeaders.get(item.column) ?? item.column;
}

function compositeKey(row: FlatRow, keys: string[]): string {
  return keys.map((k) => String(row[k] ?? '')).join('\u0001');
}

function performJoin(
  leftRows: FlatRow[],
  rightRows: FlatRow[],
  leftKeys: string[],
  rightKeys: string[],
  type: JoinClause['type'],
  rightHeaders: string[],
  rightAlias: string,
): FlatRow[] {
  const rightIndex = new Map<string, FlatRow[]>();
  for (const r of rightRows) {
    const k = compositeKey(r, rightKeys);
    if (!rightIndex.has(k)) rightIndex.set(k, []);
    rightIndex.get(k)!.push(r);
  }

  const out: FlatRow[] = [];
  const matchedRight = new Set<FlatRow>();

  for (const l of leftRows) {
    const k = compositeKey(l, leftKeys);
    const matches = rightIndex.get(k);
    if (matches && matches.length) {
      for (const r of matches) {
        matchedRight.add(r);
        out.push({ ...l, ...r });
      }
    } else if (type === 'LEFT' || type === 'FULL') {
      const nullRight: FlatRow = { ...l };
      for (const h of rightHeaders) {
        nullRight[`${rightAlias}.${h}`] = null;
        if (!(h in nullRight)) nullRight[h] = null;
      }
      out.push(nullRight);
    }
  }

  if (type === 'RIGHT' || type === 'FULL') {
    for (const r of rightRows) {
      if (matchedRight.has(r)) continue;
      out.push({ ...r });
    }
  }

  return out;
}

function collectColumns(rows: FlatRow[], multiTable: boolean): string[] {
  const seen = new Set<string>();
  const cols: string[] = [];
  for (const r of rows) {
    for (const k of Object.keys(r)) {
      if (multiTable) {
        if (k.includes('.') && !seen.has(k)) {
          seen.add(k);
          cols.push(k);
        }
      } else if (!k.includes('.') && !seen.has(k)) {
        seen.add(k);
        cols.push(k);
      }
    }
  }
  if (cols.length === 0 && rows[0]) {
    for (const k of Object.keys(rows[0])) {
      if (!seen.has(k)) {
        seen.add(k);
        cols.push(k);
      }
    }
  }
  return cols;
}

function evaluateWhere(row: FlatRow, conditions: Condition[], allHeaders: Map<string, string>): boolean {
  if (conditions.length === 0) return true;
  let result = compareCond(row, conditions[0], allHeaders);
  for (let i = 0; i < conditions.length - 1; i++) {
    const conn = conditions[i].connector ?? 'AND';
    const next = compareCond(row, conditions[i + 1], allHeaders);
    result = conn === 'OR' ? result || next : result && next;
  }
  return result;
}

function compareCond(row: FlatRow, cond: Condition, allHeaders: Map<string, string>): boolean {
  const key = resolveColumnKey(cond, allHeaders) ?? cond.column;
  const left = row[key] ?? row[cond.column];
  const right = cond.value;
  if (cond.op === '=' || cond.op === '!=') {
    const eq =
      left === right ||
      (left == null && right == null) ||
      String(left ?? '') === String(right ?? '');
    return cond.op === '=' ? eq : !eq;
  }
  if (cond.op === '<>') {
    return !(left === right || String(left ?? '') === String(right ?? ''));
  }
  const ln = typeof left === 'number' ? left : Number(left);
  const rn = typeof right === 'number' ? right : Number(right);
  if (Number.isFinite(ln) && Number.isFinite(rn)) {
    switch (cond.op) {
      case '<':
        return ln < rn;
      case '<=':
        return ln <= rn;
      case '>':
        return ln > rn;
      case '>=':
        return ln >= rn;
    }
  }
  const ls = String(left ?? '');
  const rs = String(right ?? '');
  switch (cond.op) {
    case '<':
      return ls < rs;
    case '<=':
      return ls <= rs;
    case '>':
      return ls > rs;
    case '>=':
      return ls >= rs;
    default:
      return false;
  }
}

function groupAndAggregate(
  rows: FlatRow[],
  parsed: ParsedQuery,
  allHeaders: Map<string, string>,
): { columns: string[]; rows: CellVal[][] } {
  const groupKeys = parsed.groupBy.map((g) => resolveColumnKey(g, allHeaders) ?? g.column);
  const groups = new Map<string, FlatRow[]>();
  for (const row of rows) {
    const key =
      groupKeys.length > 0 ? groupKeys.map((k) => String(row[k] ?? '')).join('\u0001') : '__all__';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(row);
  }

  const columns = parsed.select.map(
    (it) =>
      it.alias ??
      (it.aggFn
        ? `${it.aggFn}(${it.tableAlias ? it.tableAlias + '.' : ''}${it.column})`
        : it.tableAlias
          ? `${it.tableAlias}.${it.column}`
          : it.column),
  );

  const outputRows: CellVal[][] = [];
  for (const groupRows of groups.values()) {
    const outputRow: CellVal[] = [];
    for (const item of parsed.select) {
      if (item.aggFn) {
        outputRow.push(computeAgg(groupRows, item, allHeaders));
      } else {
        const key = resolveColumnKey(item, allHeaders) ?? item.column;
        outputRow.push(groupRows[0]?.[key] ?? null);
      }
    }
    outputRows.push(outputRow);
  }
  return { columns, rows: outputRows };
}

function computeAgg(rows: FlatRow[], item: SelectItem, allHeaders: Map<string, string>): number {
  if (item.aggFn === 'COUNT' && item.column === '*') return rows.length;
  const key = resolveColumnKey(item, allHeaders) ?? item.column;
  const values = rows.map((r) => r[key] ?? null);
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

function sortRows(
  rows: CellVal[][],
  columns: string[],
  parsed: ParsedQuery,
): CellVal[][] {
  const idxs = parsed.orderBy.map((o) => {
    let idx = columns.findIndex(
      (c) => c === o.column || c === `${o.tableAlias}.${o.column}` || c.endsWith(`.${o.column}`),
    );
    if (idx < 0) idx = columns.indexOf(o.column);
    return { idx: idx < 0 ? 0 : idx, dir: o.direction };
  });

  return [...rows].sort((a, b) => {
    for (const { idx, dir } of idxs) {
      const cmp = compareValues(a[idx] ?? null, b[idx] ?? null);
      if (cmp !== 0) return dir === 'DESC' ? -cmp : cmp;
    }
    return 0;
  });
}

function applyHaving(
  rows: CellVal[][],
  columns: string[],
  having: Condition[],
): CellVal[][] {
  return rows.filter((row) => {
    let result = true;
    for (let i = 0; i < having.length; i++) {
      const cond = having[i];
      const idx = columns.findIndex(
        (c) =>
          c === cond.column ||
          c === `${cond.tableAlias}.${cond.column}` ||
          c.endsWith(`(${cond.column})`) ||
          c.toUpperCase() === cond.column.toUpperCase(),
      );
      const left = idx >= 0 ? row[idx] : null;
      const right = cond.value;
      let ok = false;
      if (cond.op === '=' || cond.op === '!=') {
        const eq =
          left === right ||
          (left == null && right == null) ||
          String(left ?? '') === String(right ?? '');
        ok = cond.op === '=' ? eq : !eq;
      } else if (cond.op === '<>') {
        ok = !(left === right || String(left ?? '') === String(right ?? ''));
      } else {
        const ln = typeof left === 'number' ? left : Number(left);
        const rn = typeof right === 'number' ? right : Number(right);
        if (Number.isFinite(ln) && Number.isFinite(rn)) {
          ok =
            cond.op === '<'
              ? ln < rn
              : cond.op === '<='
                ? ln <= rn
                : cond.op === '>'
                  ? ln > rn
                  : ln >= rn;
        }
      }
      if (i === 0) result = ok;
      else {
        const conn = having[i - 1].connector ?? 'AND';
        result = conn === 'OR' ? result || ok : result && ok;
      }
    }
    return result;
  });
}

function compareValues(a: CellVal, b: CellVal): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a ?? '').localeCompare(String(b ?? ''), undefined, { numeric: true });
}
