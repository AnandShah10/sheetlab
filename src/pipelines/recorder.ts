import { CellRange, CleanupOperation } from '../types/workbook';
import { createEmptyPipeline, TransformationPipeline, TransformationStep } from './types';

/**
 * Opt-in transformation recorder. When active, cleanup operations are
 * appended as structured steps for later replay / save.
 */
export class TransformationRecorder {
  private recording = false;
  private pipeline: TransformationPipeline = createEmptyPipeline('Untitled');

  isRecording(): boolean {
    return this.recording;
  }

  start(name?: string): void {
    this.recording = true;
    this.pipeline = createEmptyPipeline(name?.trim() || `Pipeline ${new Date().toISOString().slice(0, 10)}`);
  }

  stop(): TransformationPipeline {
    this.recording = false;
    this.pipeline.updatedAt = new Date().toISOString();
    return this.pipeline;
  }

  getPipeline(): TransformationPipeline {
    return this.pipeline;
  }

  record(sheetName: string, range: CellRange, operation: CleanupOperation): void {
    if (!this.recording) return;
    const step: TransformationStep = {
      id: `step_${this.pipeline.steps.length + 1}_${Date.now()}`,
      operation,
      sheetName,
      range: { ...range },
      recordedAt: new Date().toISOString(),
    };
    this.pipeline.steps.push(step);
    this.pipeline.updatedAt = step.recordedAt;
  }
}

/** Module singleton for the extension host session. */
export const transformationRecorder = new TransformationRecorder();
