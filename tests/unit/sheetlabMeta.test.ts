import { strict as assert } from 'assert';
import { SHEETLAB_META_SHEET, SheetlabMetaPayload } from '../../src/excel/sheetlabMeta';

describe('sheetlabMeta', () => {
  it('defines stable meta sheet name and payload shape', () => {
    assert.equal(SHEETLAB_META_SHEET, '__sheetlab_meta');
    const payload: SheetlabMetaPayload = {
      version: 1,
      lineage: {
        QueryResult: {
          kind: 'query',
          sql: 'SELECT * FROM Sheet1',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      },
    };
    const round = JSON.parse(JSON.stringify(payload)) as SheetlabMetaPayload;
    assert.equal(round.version, 1);
    assert.equal(round.lineage.QueryResult.kind, 'query');
  });
});
