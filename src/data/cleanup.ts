import { CellRange, CleanupOperation, Worksheet } from '../types/workbook';
import { getRangeAsMatrix } from '../workbook/workbookModel';
import { inferCellFromInput } from '../workbook/cellModel';

/**
 * Applies a cleanup operation to `range` and returns a NEW worksheet object
 * (structurally cloned) rather than mutating `sheet` in place. Callers push
 * the previous worksheet onto the undo stack before swapping in the result —
 * see services/undoService via the editor providers.
 */
export function applyCleanup(sheet: Worksheet, range: CellRange, op: CleanupOperation): Worksheet {
  const next: Worksheet = JSON.parse(JSON.stringify(sheet));

  switch (op.kind) {
    case 'trimWhitespace':
      forEachCellInRange(next, range, (cell) => {
        if (cell.type === 'string' && typeof cell.value === 'string') {
          cell.value = cell.value.trim();
          cell.raw = cell.value;
        }
      });
      break;

    case 'removeEmptyRows': {
      const rowsToDelete: number[] = [];
      for (let r = range.startRow; r <= range.endRow; r++) {
        const row = next.rows[r];
        const isEmpty = !row || Object.values(row).every((c) => c.type === 'blank');
        if (isEmpty) rowsToDelete.push(r);
      }
      removeRows(next, rowsToDelete);
      break;
    }

    case 'removeEmptyColumns': {
      const colsToDelete: number[] = [];
      for (let c = range.startCol; c <= range.endCol; c++) {
        let isEmpty = true;
        for (let r = range.startRow; r <= range.endRow; r++) {
          const cell = next.rows[r]?.[c];
          if (cell && cell.type !== 'blank') { isEmpty = false; break; }
        }
        if (isEmpty) colsToDelete.push(c);
      }
      removeColumns(next, colsToDelete);
      break;
    }

    case 'removeDuplicateRows': {
      const seen = new Set<string>();
      const rowsToDelete: number[] = [];
      for (let r = range.startRow; r <= range.endRow; r++) {
        const row = next.rows[r] ?? {};
        const key = JSON.stringify(
          Array.from({ length: range.endCol - range.startCol + 1 }, (_, i) => row[range.startCol + i]?.value ?? null),
        );
        if (seen.has(key)) {
          rowsToDelete.push(r);
        } else {
          seen.add(key);
        }
      }
      removeRows(next, rowsToDelete);
      break;
    }

    case 'normalizeCase':
      forEachCellInRange(next, range, (cell) => {
        if (cell.type === 'string' && typeof cell.value === 'string') {
          cell.value =
            op.mode === 'upper'
              ? cell.value.toUpperCase()
              : op.mode === 'lower'
                ? cell.value.toLowerCase()
                : titleCase(cell.value);
          cell.raw = cell.value;
        }
      });
      break;

    case 'findReplace': {
      const pattern = op.regex ? new RegExp(op.find, 'g') : null;
      forEachCellInRange(next, range, (cell) => {
        if (typeof cell.value === 'string') {
          cell.value = pattern ? cell.value.replace(pattern, op.replace) : cell.value.split(op.find).join(op.replace);
          cell.raw = cell.value;
        }
      });
      break;
    }

    case 'convertTextToNumber':
      forEachCellInRange(next, range, (cell) => {
        if (cell.type === 'string' && typeof cell.value === 'string' && /^-?\d+(\.\d+)?$/.test(cell.value.trim())) {
          const num = Number(cell.value.trim());
          cell.value = num;
          cell.type = 'number';
          cell.raw = String(num);
        }
      });
      break;

    case 'convertNumberToText':
      forEachCellInRange(next, range, (cell) => {
        if (cell.type === 'number') {
          cell.value = String(cell.value);
          cell.type = 'string';
          cell.raw = cell.value;
        }
      });
      break;

    case 'fillDown': {
      for (let c = range.startCol; c <= range.endCol; c++) {
        let lastValue = null as ReturnType<typeof getRangeAsMatrix>[number][number] | null;
        for (let r = range.startRow; r <= range.endRow; r++) {
          const cell = next.rows[r]?.[c];
          if (cell && cell.type !== 'blank') {
            lastValue = cell;
          } else if (lastValue) {
            if (!next.rows[r]) next.rows[r] = {};
            next.rows[r][c] = { ...lastValue };
          }
        }
      }
      break;
    }

    case 'fillRight': {
      for (let r = range.startRow; r <= range.endRow; r++) {
        let lastValue = null as ReturnType<typeof getRangeAsMatrix>[number][number] | null;
        for (let c = range.startCol; c <= range.endCol; c++) {
          const cell = next.rows[r]?.[c];
          if (cell && cell.type !== 'blank') {
            lastValue = cell;
          } else if (lastValue) {
            if (!next.rows[r]) next.rows[r] = {};
            next.rows[r][c] = { ...lastValue };
          }
        }
      }
      break;
    }

    case 'splitColumn': {
      // Splits the first column of `range` into new columns inserted immediately after it.
      const c = range.startCol;
      for (let r = range.startRow; r <= range.endRow; r++) {
        const cell = next.rows[r]?.[c];
        if (!cell || typeof cell.value !== 'string') continue;
        const parts = cell.value.split(op.delimiter);
        parts.forEach((part, i) => {
          if (i === 0) return;
          if (!next.rows[r]) next.rows[r] = {};
          next.rows[r][c + i] = inferCellFromInput(part);
          next.colCount = Math.max(next.colCount, c + i + 1);
        });
        if (!next.rows[r]) next.rows[r] = {};
        next.rows[r][c] = inferCellFromInput(parts[0] ?? '');
      }
      break;
    }

    case 'mergeColumns': {
      const [firstCol, ...restCols] = op.cols;
      for (let r = range.startRow; r <= range.endRow; r++) {
        const row = next.rows[r];
        if (!row) continue;
        const parts = [firstCol, ...restCols].map((c) => String(row[c]?.value ?? ''));
        row[firstCol] = inferCellFromInput(parts.join(op.separator));
        restCols.forEach((c) => delete row[c]);
      }
      break;
    }
  }

  return next;
}

function forEachCellInRange(
  sheet: Worksheet,
  range: CellRange,
  fn: (cell: Worksheet['rows'][number][number]) => void,
): void {
  for (let r = range.startRow; r <= range.endRow; r++) {
    const row = sheet.rows[r];
    if (!row) continue;
    for (let c = range.startCol; c <= range.endCol; c++) {
      const cell = row[c];
      if (cell) fn(cell);
    }
  }
}

function removeRows(sheet: Worksheet, rowsToDelete: number[]): void {
  if (rowsToDelete.length === 0) return;
  const deleteSet = new Set(rowsToDelete);
  const remainingRowIndices = Object.keys(sheet.rows)
    .map(Number)
    .filter((r) => !deleteSet.has(r))
    .sort((a, b) => a - b);

  const newRows: Worksheet['rows'] = {};
  remainingRowIndices.forEach((oldIdx, newIdx) => {
    newRows[newIdx] = sheet.rows[oldIdx];
  });
  sheet.rows = newRows;
  sheet.rowCount = remainingRowIndices.length;
}

function removeColumns(sheet: Worksheet, colsToDelete: number[]): void {
  if (colsToDelete.length === 0) return;
  const deleteSet = new Set(colsToDelete);
  Object.values(sheet.rows).forEach((row) => {
    const cols = Object.keys(row).map(Number).sort((a, b) => a - b);
    const kept = cols.filter((c) => !deleteSet.has(c));
    const newRow: typeof row = {};
    let newIdx = 0;
    let lastOld = -1;
    kept.forEach((oldCol) => {
      const shift = colsToDelete.filter((dc) => dc < oldCol).length;
      newRow[oldCol - shift] = row[oldCol];
      newIdx++;
      lastOld = oldCol;
    });
    void newIdx;
    void lastOld;
    Object.keys(row).forEach((k) => delete row[Number(k)]);
    Object.assign(row, newRow);
  });
  sheet.colCount = Math.max(0, sheet.colCount - colsToDelete.length);
}

function titleCase(s: string): string {
  return s.replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}
