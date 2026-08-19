import { strict as assert } from 'assert';
import { parseQuery, QueryParseError } from '../../src/query/queryParser';

describe('queryParser', () => {
  it('parses a simple SELECT *', () => {
    const q = parseQuery('SELECT * FROM Sheet1');
    assert.deepEqual(q.select, [{ column: '*' }]);
    assert.equal(q.from, 'Sheet1');
  });

  it('parses column list with aliases', () => {
    const q = parseQuery('SELECT Department, SUM(Sales) AS TotalSales FROM Sheet1');
    assert.equal(q.select.length, 2);
    assert.equal(q.select[0].column, 'Department');
    assert.equal(q.select[1].aggFn, 'SUM');
    assert.equal(q.select[1].alias, 'TotalSales');
  });

  it('parses WHERE with AND/OR chains', () => {
    const q = parseQuery("SELECT * FROM Sheet1 WHERE Sales > 1000 AND Country = 'India'");
    assert.equal(q.where.length, 2);
    assert.equal(q.where[0].op, '>');
    assert.equal(q.where[0].connector, 'AND');
    assert.equal(q.where[1].value, 'India');
  });

  it('parses GROUP BY and ORDER BY with direction', () => {
    const q = parseQuery('SELECT Department, SUM(Sales) AS T FROM Sheet1 GROUP BY Department ORDER BY T DESC');
    assert.deepEqual(q.groupBy, ['Department']);
    assert.deepEqual(q.orderBy, [{ column: 'T', direction: 'DESC' }]);
  });

  it('parses LIMIT', () => {
    const q = parseQuery('SELECT * FROM Sheet1 LIMIT 50');
    assert.equal(q.limit, 50);
  });

  it('throws a QueryParseError with position info on malformed input', () => {
    assert.throws(() => parseQuery('SELECT FROM Sheet1'), QueryParseError);
  });

  it('rejects queries missing FROM', () => {
    assert.throws(() => parseQuery('SELECT *'), QueryParseError);
  });
});
