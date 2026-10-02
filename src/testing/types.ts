export interface WorkbookTestCase {
  id: string;
  name: string;
  /** e.g. Sheet1!B12 */
  cell?: string;
  /** exact value or formula result */
  equals?: string | number | boolean;
  /** value must not equal this */
  notEquals?: string | number | boolean;
  /** cell must not be an error type */
  noError?: boolean;
  /**
   * Column uniqueness on a sheet (header name or 0-based index).
   * Optional sheetName defaults to first sheet.
   */
  uniqueColumn?: string | number;
  sheetName?: string;
  /** A1 range that must contain no error cells, e.g. Sheet1!A1:C100 or A1:C100 */
  rangeNoErrors?: string;
  /** Formula text must contain this substring (case-insensitive) */
  formulaContains?: string;
}

export interface WorkbookTestFile {
  version: number;
  name: string;
  tests: WorkbookTestCase[];
}

export interface TestResult {
  id: string;
  name: string;
  passed: boolean;
  message: string;
  sheetName?: string;
  row?: number;
  col?: number;
}
