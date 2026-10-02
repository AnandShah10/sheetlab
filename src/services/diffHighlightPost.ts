
import { SnapshotDiffEntry } from '../analysis/snapshot';
import { parseA1 } from '../utils/cellRef';
import { activePanelRegistry } from './activePanelRegistry';

export function postDiffsToActivePanel(
  note: string,
  diffs: SnapshotDiffEntry[],
): boolean {
  const entries = diffs.map((d) => {
    const p = parseA1(d.a1);
    return {
      sheet: d.sheet,
      row: p?.row ?? 0,
      col: p?.col ?? 0,
      a1: d.a1,
      kind: d.kind,
      before: d.before,
      after: d.after,
    };
  });
  const listOk = activePanelRegistry.postRaw({
    type: 'analysisGitDiff',
    note,
    diffs,
  });
  activePanelRegistry.postRaw({
    type: 'diffHighlights',
    note,
    entries,
  });
  return Boolean(listOk);
}

export function clearDiffHighlights(): void {
  activePanelRegistry.postRaw({
    type: 'diffHighlights',
    note: '',
    entries: [],
    clear: true,
  });
}
