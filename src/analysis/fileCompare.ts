
import { Workbook } from '../types/workbook';
import { createWorkbookSnapshot, diffSnapshots, SnapshotDiffEntry } from './snapshot';

export function compareTwoWorkbooks(
  before: Workbook,
  after: Workbook,
  label = 'semantic diff',
): { diffs: SnapshotDiffEntry[]; note: string } {
  const a = createWorkbookSnapshot(before);
  const b = createWorkbookSnapshot(after);
  const diffs = diffSnapshots(a, b, 500);
  return {
    diffs,
    note: diffs.length ? `${diffs.length} semantic change(s) (${label})` : `No semantic cell changes (${label})`,
  };
}
