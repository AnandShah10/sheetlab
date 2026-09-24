import { CellRange, CleanupOperation } from '../types/workbook';

export const PIPELINE_FORMAT_VERSION = 1;

export interface TransformationStep {
  id: string;
  operation: CleanupOperation;
  sheetName: string;
  range: CellRange;
  /** ISO timestamp when recorded */
  recordedAt: string;
}

export interface TransformationPipeline {
  version: number;
  name: string;
  description?: string;
  steps: TransformationStep[];
  updatedAt: string;
}

export function createEmptyPipeline(name: string): TransformationPipeline {
  return {
    version: PIPELINE_FORMAT_VERSION,
    name,
    steps: [],
    updatedAt: new Date().toISOString(),
  };
}
