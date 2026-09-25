export interface WorkbookTestCase {
  id: string;
  name: string;
  /** e.g. Sheet1!B12 */
  cell?: string;
  /** exact value or formula result */
  equals?: string | number | boolean;
  /** cell must not be an error type */
  noError?: boolean;
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
