/**
 * SheetLab Query Language (SLQL) — a deliberately small SQL-like subset.
 *
 * Supported grammar:
 *
 *   SELECT <selectList>
 *   FROM <sheetName>
 *   [WHERE <condition>]
 *   [GROUP BY <col> [, <col> ...]]
 *   [ORDER BY <col> [ASC|DESC] [, <col> [ASC|DESC] ...]]
 *   [LIMIT <n>]
 *
 *   selectList := '*' | selectItem [, selectItem ...]
 *   selectItem := column [AS alias] | aggFn '(' column | '*' ')' [AS alias]
 *   aggFn      := SUM | COUNT | AVG | MIN | MAX
 *   condition  := comparison [ (AND | OR) comparison ]*
 *   comparison := column op (number | string | NULL)
 *   op         := '=' | '!=' | '<>' | '<' | '<=' | '>' | '>='
 *
 * NOT supported (explicitly, to avoid false claims): JOINs, subqueries,
 * window functions, HAVING, CASE expressions, string concatenation in
 * SELECT, arithmetic expressions in SELECT. Attempting these produces a
 * clear parse error naming the unsupported construct rather than a partial
 * or silently-wrong result.
 */

export interface SelectItem {
  column: string; // '*' for COUNT(*)
  aggFn?: 'SUM' | 'COUNT' | 'AVG' | 'MIN' | 'MAX';
  alias?: string;
}

export interface Condition {
  column: string;
  op: '=' | '!=' | '<>' | '<' | '<=' | '>' | '>=';
  value: string | number | null;
  connector?: 'AND' | 'OR';
}

export interface OrderByItem {
  column: string;
  direction: 'ASC' | 'DESC';
}

export interface ParsedQuery {
  select: SelectItem[];
  from: string;
  where: Condition[];
  groupBy: string[];
  orderBy: OrderByItem[];
  limit?: number;
}

export class QueryParseError extends Error {
  constructor(
    message: string,
    public readonly position: number,
    public readonly nearText: string,
  ) {
    super(message);
  }
}

const AGG_FNS = new Set(['SUM', 'COUNT', 'AVG', 'MIN', 'MAX']);

export function parseQuery(sql: string): ParsedQuery {
  // Semicolon is a statement terminator. Support trailing `;` and
  // multi-statement input by running the last non-empty statement.
  const statements = sql
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const statement = statements[statements.length - 1] ?? '';
  const tokens = tokenize(statement);
  let pos = 0;

  const peek = () => tokens[pos];
  const next = () => tokens[pos++];
  const expectKeyword = (kw: string) => {
    const t = next();
    if (!t || t.value.toUpperCase() !== kw) {
      throw new QueryParseError(`Expected "${kw}"`, t?.pos ?? sql.length, t?.value ?? '<end of input>');
    }
  };

  expectKeyword('SELECT');
  const select = parseSelectList();
  expectKeyword('FROM');
  const fromTok = next();
  if (!fromTok) throw new QueryParseError('Expected sheet name after FROM', sql.length, '<end of input>');
  const from = stripQuotes(fromTok.value);

  const where: Condition[] = [];
  const groupBy: string[] = [];
  const orderBy: OrderByItem[] = [];
  let limit: number | undefined;

  while (pos < tokens.length) {
    const t = peek();
    const kw = t.value.toUpperCase();
    if (kw === 'WHERE') {
      next();
      where.push(...parseWhere());
    } else if (kw === 'GROUP') {
      next();
      expectKeyword('BY');
      groupBy.push(...parseColumnList());
    } else if (kw === 'ORDER') {
      next();
      expectKeyword('BY');
      orderBy.push(...parseOrderByList());
    } else if (kw === 'LIMIT') {
      next();
      const n = next();
      if (!n || Number.isNaN(Number(n.value))) {
        throw new QueryParseError('Expected a number after LIMIT', n?.pos ?? sql.length, n?.value ?? '');
      }
      limit = Number(n.value);
    } else {
      throw new QueryParseError(`Unexpected token "${t.value}"`, t.pos, t.value);
    }
  }

  return { select, from, where, groupBy, orderBy, limit };

  function parseSelectList(): SelectItem[] {
    if (peek()?.value === '*') {
      next();
      return [{ column: '*' }];
    }
    const items: SelectItem[] = [];
    for (;;) {
      items.push(parseSelectItem());
      if (peek()?.value === ',') {
        next();
        continue;
      }
      break;
    }
    return items;
  }

  function parseSelectItem(): SelectItem {
    const t = next();
    if (!t) throw new QueryParseError('Expected column or aggregate function', sql.length, '<end of input>');
    const upper = t.value.toUpperCase();
    if (AGG_FNS.has(upper) && peek()?.value === '(') {
      next(); // consume '('
      const colTok = next();
      if (!colTok) throw new QueryParseError('Expected column inside aggregate function', sql.length, '');
      const closeTok = next();
      if (!closeTok || closeTok.value !== ')') {
        throw new QueryParseError('Expected ")"', closeTok?.pos ?? sql.length, closeTok?.value ?? '');
      }
      let alias: string | undefined;
      if (peek()?.value.toUpperCase() === 'AS') {
        next();
        alias = stripQuotes(next()?.value ?? '');
      }
      return { column: stripQuotes(colTok.value), aggFn: upper as SelectItem['aggFn'], alias };
    }
    let alias: string | undefined;
    if (peek()?.value.toUpperCase() === 'AS') {
      next();
      alias = stripQuotes(next()?.value ?? '');
    }
    return { column: stripQuotes(t.value), alias };
  }

  function parseWhere(): Condition[] {
    const conditions: Condition[] = [];
    for (;;) {
      const column = stripQuotes(next()?.value ?? '');
      const opTok = next();
      const op = opTok?.value as Condition['op'];
      if (!['=', '!=', '<>', '<', '<=', '>', '>='].includes(op)) {
        throw new QueryParseError('Expected a comparison operator', opTok?.pos ?? sql.length, opTok?.value ?? '');
      }
      const valTok = next();
      if (!valTok) throw new QueryParseError('Expected a value after operator', sql.length, '<end of input>');
      const value =
        valTok.value.toUpperCase() === 'NULL'
          ? null
          : valTok.quoted
            ? valTok.value
            : Number.isNaN(Number(valTok.value))
              ? valTok.value
              : Number(valTok.value);
      conditions.push({ column, op, value });

      const connectorTok = peek();
      if (connectorTok && ['AND', 'OR'].includes(connectorTok.value.toUpperCase())) {
        next();
        conditions[conditions.length - 1].connector = connectorTok.value.toUpperCase() as 'AND' | 'OR';
        continue;
      }
      break;
    }
    return conditions;
  }

  function parseColumnList(): string[] {
    const cols: string[] = [];
    for (;;) {
      cols.push(stripQuotes(next()?.value ?? ''));
      if (peek()?.value === ',') {
        next();
        continue;
      }
      break;
    }
    return cols;
  }

  function parseOrderByList(): OrderByItem[] {
    const items: OrderByItem[] = [];
    for (;;) {
      const column = stripQuotes(next()?.value ?? '');
      let direction: OrderByItem['direction'] = 'ASC';
      const dirTok = peek();
      if (dirTok && ['ASC', 'DESC'].includes(dirTok.value.toUpperCase())) {
        next();
        direction = dirTok.value.toUpperCase() as OrderByItem['direction'];
      }
      items.push({ column, direction });
      if (peek()?.value === ',') {
        next();
        continue;
      }
      break;
    }
    return items;
  }
}

interface Token {
  value: string;
  pos: number;
  quoted: boolean;
}

function tokenize(sql: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const multiCharOps = ['<=', '>=', '!=', '<>'];

  while (i < sql.length) {
    const ch = sql[i];
    if (/\s/.test(ch) || ch === ';') { i++; continue; }

    if (ch === "'" || ch === '"') {
      const quote = ch;
      let j = i + 1;
      let value = '';
      while (j < sql.length && sql[j] !== quote) {
        value += sql[j];
        j++;
      }
      tokens.push({ value, pos: i, quoted: true });
      i = j + 1;
      continue;
    }

    const twoChar = sql.slice(i, i + 2);
    if (multiCharOps.includes(twoChar)) {
      tokens.push({ value: twoChar, pos: i, quoted: false });
      i += 2;
      continue;
    }

    if ('(),*=<>'.includes(ch)) {
      tokens.push({ value: ch, pos: i, quoted: false });
      i++;
      continue;
    }

    let j = i;
    while (j < sql.length && !/[\s(),*=<>'"]/.test(sql[j])) j++;
    if (j === i) { i++; continue; }
    tokens.push({ value: sql.slice(i, j), pos: i, quoted: false });
    i = j;
  }

  return tokens;
}

function stripQuotes(s: string): string {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith('`') && s.endsWith('`'))) {
    return s.slice(1, -1);
  }
  return s;
}
