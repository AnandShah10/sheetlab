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
