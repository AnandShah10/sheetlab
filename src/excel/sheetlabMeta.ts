/** Hidden worksheet used to persist SheetLab lineage inside the XLSX package. */
export const SHEETLAB_META_SHEET = '__sheetlab_meta';

export interface SheetlabMetaPayload {
  version: 1;
  lineage: Record<
    string,
    {
      kind: 'query' | 'pipeline' | 'selection';
      sql?: string;
      pipelineName?: string;
      sourceSheet?: string;
      createdAt: string;
    }
  >;
}
