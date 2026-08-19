import { Cell } from '../types/workbook';

/**
 * Infer a Cell from what a user typed into the grid or formula bar. This is
 * intentionally simpler/stricter than file-import inference (csvReader's
 * inferCell): a user typing "5-3" as text should not become a formula, but
 * a leading "=" always means formula, and things that look unambiguously
 * numeric/boolean should become typed values so sort/filter/aggregate work.
 */
export function inferCellFromInput(raw: string): Cell {
  if (raw === '') {
    return { raw: null, value: null, type: 'blank' };
  }
  if (raw.startsWith('=') && raw.length > 1) {
    return { raw, value: null, type: 'formula', formula: raw.slice(1) };
  }
  const trimmed = raw.trim();
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    return { raw, value: Number(trimmed), type: 'number' };
  }
  if (/^(true|false)$/i.test(trimmed)) {
    return { raw, value: trimmed.toLowerCase() === 'true', type: 'boolean' };
  }
  return { raw, value: raw, type: 'string' };
}
