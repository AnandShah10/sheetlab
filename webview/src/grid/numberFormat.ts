/**
 * Lightweight number-format rendering -- kept in its own module (no
 * DOM/webview dependencies) so it's unit-testable directly.
 *
 * Supports enough of Excel's number-format mini-language to cover common
 * real-world formats: semicolon-separated positive;negative;zero sections,
 * percent, thousands separators, a literal currency-symbol prefix/suffix,
 * decimal precision derived from the digit pattern (not hardcoded),
 * `[Red]`/`[Blue]`/etc. conditional color sections (see
 * `getNumberFormatColor`), `[$SYMBOL-LCID]` locale-currency tokens
 * (the literal symbol is used; the locale ID itself is not consulted --
 * SheetLab doesn't have a locale table to resolve it against), and a
 * handful of date/time token patterns.
 *
 * It does NOT implement the full mini-language: no indexed palette colors
 * (`[Color 12]` is recognized and stripped so it doesn't pollute the
 * output, but resolves to no color since we have no access to the
 * workbook's actual color palette), no `[$-409]`-style bare locale token
 * with no symbol at all (falls back to `$`), and date-token recognition
 * covers common orderings rather than every token combination. An
 * unrecognized format falls back to the plain numeric value rather than
 * guessing or rendering garbled text.
 */
export function formatNumber(value: number, format: string): string {
  const section = pickSection(value, format);
  if (section === null) return String(value);
  return renderSection(Math.abs(value), section, value < 0 && !hasExplicitNegativeSection(format));
}

/**
 * Returns the CSS color implied by the format section that would be
 * applied to `value` (Excel's `[Red]`, `[Blue]`, etc. conditional color
 * sections), or undefined if the active section has no color token or
 * uses an indexed palette color SheetLab can't resolve.
 */
export function getNumberFormatColor(value: number, format: string): string | undefined {
  const section = pickSection(value, format);
  if (section === null) return undefined;
  return extractColor(section.trim()).color;
}

/** Splits on unescaped semicolons (Excel: positive;negative;zero;text) and picks the section for `value`'s sign. */
function pickSection(value: number, format: string): string | null {
  const sections = splitSections(format);
  if (sections.length === 0) return null;
  if (value < 0 && sections.length > 1) return sections[1];
  if (value === 0 && sections.length > 2) return sections[2];
  return sections[0];
}

function hasExplicitNegativeSection(format: string): boolean {
  return splitSections(format).length > 1;
}

function splitSections(format: string): string[] {
  const sections: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < format.length; i++) {
    const ch = format[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
      current += ch;
      continue;
    }
    if (ch === ';' && !inQuotes) {
      sections.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  sections.push(current);
  return sections.filter((s) => s.length > 0);
}

const NAMED_COLORS: Record<string, string> = {
  black: '#000000',
  blue: '#0000FF',
  cyan: '#00FFFF',
  green: '#008000',
  magenta: '#FF00FF',
  red: '#FF0000',
  white: '#FFFFFF',
  yellow: '#FFFF00',
};

const COLOR_TOKEN_PATTERN = /^\[(black|blue|cyan|green|magenta|red|white|yellow|color\s?\d{1,2})\]/i;

/** Strips a leading `[ColorName]` or `[Color N]` token and resolves it to a CSS color where possible. */
function extractColor(section: string): { color?: string; rest: string } {
  const match = COLOR_TOKEN_PATTERN.exec(section);
  if (!match) return { rest: section };
  const token = match[1].toLowerCase().replace(/\s+/g, '');
  const rest = section.slice(match[0].length);
  if (token.startsWith('color')) {
    // Indexed palette color (e.g. "[Color 12]") -- we have no palette to
    // resolve the index against, so strip the token but report no color
    // rather than guessing one.
    return { rest };
  }
  return { color: NAMED_COLORS[token], rest };
}

const LOCALE_CURRENCY_PATTERN = /\[\$([^\]-]*)(-[0-9A-Fa-f]+)?\]/g;

/** Replaces `[$SYMBOL-LCID]` tokens with the literal symbol (defaulting to "$" if no symbol was given). */
function extractLocaleCurrency(section: string): string {
  return section.replace(LOCALE_CURRENCY_PATTERN, (_whole, symbol: string) => symbol || '$');
}

const DATE_TOKEN_PATTERN = /[ymdhs]{1,4}|:|\/|-/i;

function renderSection(absValue: number, section: string, prependMinus: boolean): string {
  const { rest: afterColor } = extractColor(section.trim());
  const f = extractLocaleCurrency(afterColor).trim();
  const sign = prependMinus ? '-' : '';

  if (f === 'General' || f === '') return `${sign}${absValue}`;

  if (/[ymd]/i.test(f) && DATE_TOKEN_PATTERN.test(f) && /[ymd]{2,}/i.test(f)) {
    const rendered = renderDate(absValue, f);
    if (rendered !== null) return rendered; // dates are never negative-signed
  }

  const isPercent = f.includes('%');
  const digitSection = isPercent ? f.replace('%', '') : f;

  if (!/[0#]/.test(digitSection)) {
    // No digit placeholder at all -- this isn't a recognizable numeric
    // format section, so fall back to the plain value rather than treating
    // arbitrary text as a currency-symbol prefix (see module doc).
    return `${sign}${absValue}`;
  }

  const currencyMatch = /^([^\d#0.,]+)/.exec(digitSection);
  const prefix = currencyMatch ? currencyMatch[1] : '';
  const suffixMatch = /([^\d#0.,]+)$/.exec(digitSection);
  const suffix = suffixMatch ? suffixMatch[1] : '';
  const hasThousands = /#,#|0,0|,##/.test(digitSection) || /#,##0|,000/.test(digitSection);
  const decimalMatch = /\.([0#]+)/.exec(digitSection);
  const decimals = decimalMatch ? decimalMatch[1].length : 0;

  let n = absValue;
  if (isPercent) n *= 100;

  const numeric = hasThousands
    ? n.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
    : n.toFixed(decimals);

  return `${sign}${prefix}${numeric}${isPercent ? '%' : ''}${suffix}`;
}

const EXCEL_EPOCH_UTC_MS = Date.UTC(1899, 11, 30);
const MS_PER_DAY = 86400000;

/** Converts an Excel serial date/time number to a Date, matching Excel's own epoch offset. */
function excelSerialToDate(serial: number): Date {
  return new Date(EXCEL_EPOCH_UTC_MS + serial * MS_PER_DAY);
}

function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0');
}

function renderDate(serial: number, format: string): string | null {
  const d = excelSerialToDate(serial);
  if (Number.isNaN(d.getTime())) return null;

  let out = format;
  out = out.replace(/yyyy/gi, String(d.getUTCFullYear()));
  out = out.replace(/yy/gi, pad(d.getUTCFullYear() % 100));
  out = out.replace(/mm/g, pad(d.getUTCMonth() + 1));
  out = out.replace(/dd/g, pad(d.getUTCDate()));
  out = out.replace(/hh/g, pad(d.getUTCHours()));
  out = out.replace(/ss/g, pad(d.getUTCSeconds()));
  // Single-letter tokens after the two-letter ones are already consumed, so
  // any remaining lone m/d/h/s are the un-padded forms.
  out = out.replace(/\bm\b/g, String(d.getUTCMonth() + 1));
  out = out.replace(/\bd\b/g, String(d.getUTCDate()));
  return out;
}
