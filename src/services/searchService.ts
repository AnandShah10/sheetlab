import { SearchMatch, SearchOptions, Workbook } from '../types/workbook';

export function searchWorkbook(workbook: Workbook, currentSheetName: string, query: string, options: SearchOptions): SearchMatch[] {
  if (query === '') return [];
  const matcher = buildMatcher(query, options);
  const sheetNames = options.scope === 'currentSheet' ? [currentSheetName] : workbook.meta.sheetOrder;

  const matches: SearchMatch[] = [];
  for (const sheetName of sheetNames) {
    const sheet = workbook.sheets[sheetName];
    if (!sheet) continue;
    for (const [rowStr, row] of Object.entries(sheet.rows)) {
      for (const [colStr, cell] of Object.entries(row)) {
        const text = cell.type === 'formula' ? (cell.raw ?? '') : String(cell.value ?? '');
        if (text === '') continue;
        if (matcher(text)) {
          matches.push({
            sheetName,
            row: Number(rowStr),
            col: Number(colStr),
            preview: text.length > 80 ? `${text.slice(0, 80)}…` : text,
          });
        }
      }
    }
  }
  return matches;
}

/** Apply find/replace against matched cells. Mutates the workbook. */
export function replaceInWorkbook(
  workbook: Workbook,
  currentSheetName: string,
  query: string,
  replaceWith: string,
  options: SearchOptions,
  mode: 'all' | 'first',
): { replaced: number; matches: SearchMatch[] } {
  const matches = searchWorkbook(workbook, currentSheetName, query, options);
  if (matches.length === 0) return { replaced: 0, matches };
  const targets = mode === 'first' ? matches.slice(0, 1) : matches;
  let replaced = 0;

  for (const m of targets) {
    const sheet = workbook.sheets[m.sheetName];
    const cell = sheet?.rows[m.row]?.[m.col];
    if (!cell) continue;
    const source = cell.type === 'formula' ? (cell.raw ?? '') : String(cell.value ?? '');
    const next = applyReplace(source, query, replaceWith, options);
    if (next === source) continue;
    if (cell.type === 'formula') {
      cell.raw = next;
      cell.formula = next.startsWith('=') ? next.slice(1) : next;
    } else {
      cell.raw = next;
      cell.value = next;
      cell.type = 'string';
    }
    replaced += 1;
  }
  return { replaced, matches: searchWorkbook(workbook, currentSheetName, query, options) };
}

function applyReplace(text: string, query: string, replaceWith: string, options: SearchOptions): string {
  if (options.regex) {
    try {
      const flags = options.caseSensitive ? 'g' : 'gi';
      const pattern = options.wholeCell ? `^(?:${query})$` : query;
      return text.replace(new RegExp(pattern, flags), replaceWith);
    } catch {
      return text;
    }
  }
  if (options.wholeCell) {
    const a = options.caseSensitive ? text : text.toLowerCase();
    const b = options.caseSensitive ? query : query.toLowerCase();
    return a === b ? replaceWith : text;
  }
  if (options.caseSensitive) return text.split(query).join(replaceWith);
  const re = new RegExp(escapeRegExp(query), 'gi');
  return text.replace(re, replaceWith);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildMatcher(query: string, options: SearchOptions): (text: string) => boolean {
  if (options.regex) {
    let re: RegExp;
    try {
      re = new RegExp(query, options.caseSensitive ? '' : 'i');
    } catch {
      return () => false;
    }
    return (text) => (options.wholeCell ? new RegExp(`^(?:${query})$`, options.caseSensitive ? '' : 'i').test(text) : re.test(text));
  }

  const needle = options.caseSensitive ? query : query.toLowerCase();
  return (text) => {
    const hay = options.caseSensitive ? text : text.toLowerCase();
    return options.wholeCell ? hay === needle : hay.includes(needle);
  };
}
