import { strict as assert } from 'assert';
import { aggregate, computeSelectionStats } from '../../src/data/aggregation';

describe('aggregation', () => {
  it('computes sum/average/min/max/count over numeric values, ignoring nulls', () => {
    const values = [10, 20, null, 30];
    assert.equal(aggregate(values, 'sum'), 60);
    assert.equal(aggregate(values, 'average'), 20);
    assert.equal(aggregate(values, 'min'), 10);
    assert.equal(aggregate(values, 'max'), 30);
    assert.equal(aggregate(values, 'count'), 3);
    assert.equal(aggregate(values, 'counta'), 3);
  });

  it('computeSelectionStats returns null aggregates for an all-blank selection', () => {
    const stats = computeSelectionStats([null, null], 1, 2);
    assert.equal(stats.sum, null);
    assert.equal(stats.numericCount, 0);
    assert.equal(stats.cellCount, 2);
  });
});
