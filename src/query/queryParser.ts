/**
 * SheetLab Query Language (SLQL) — a deliberately small SQL-like subset.
 *
 * Supported grammar:
 *
 *   SELECT <selectList>
 *   FROM <sheetName> [AS <alias>]
 *   [[INNER|LEFT|RIGHT|FULL] JOIN <sheetName> [AS <alias>] ON <colRef> = <colRef>]*
 *   [WHERE <condition>]
 *   [GROUP BY <colRef> [, <colRef> ...]]
 *   [HAVING <condition>]
 *   [ORDER BY <colRef> [ASC|DESC] [, ...]]
 *   [LIMIT <n>]
 *
 *   selectList := '*' | selectItem [, selectItem ...]
 *   selectItem := colRef [AS alias] | aggFn '(' colRef | '*' ')' [AS alias]
 *   colRef     := [alias.]column
 *   aggFn      := SUM | COUNT | AVG | MIN | MAX
 *
 * JOIN types: INNER (default), LEFT, RIGHT, FULL (FULL OUTER).
 * ON supports equality only (col = col). Multiple JOINs are left-associated.
 */

export interface SelectItem {
  /** '*' for COUNT(*) or SELECT * */
  column: string;
  /** Optional table alias qualifier (e.g. a.Dept → tableAlias a, column Dept) */
  tableAlias?: string;
  aggFn?: 'SUM' | 'COUNT' | 'AVG' | 'MIN' | 'MAX';
  alias?: string;
}

export interface Condition {
  column: string;
  tableAlias?: string;
  op: '=' | '!=' | '<>' | '<' | '<=' | '>' | '>=';
  value: string | number | null;
  connector?: 'AND' | 'OR';
}

export interface OrderByItem {
  column: string;
  tableAlias?: string;
  direction: 'ASC' | 'DESC';
}

export type JoinType = 'INNER' | 'LEFT' | 'RIGHT' | 'FULL';

export interface JoinOnPair {
  left: { tableAlias?: string; column: string };
  right: { tableAlias?: string; column: string };
}

export interface JoinClause {
  type: JoinType;
  sheet: string;
  alias?: string;
  /** Equality pairs: ON a.x = b.x [AND a.y = b.y ...] */
  on: JoinOnPair[];
  /** @deprecated use on[0] */
  onLeft?: { tableAlias?: string; column: string };
  /** @deprecated use on[0] */
  onRight?: { tableAlias?: string; column: string };
}

export interface ParsedQuery {
  select: SelectItem[];
  from: string;
  fromAlias?: string;
  joins: JoinClause[];
  where: Condition[];
  groupBy: Array<{ column: string; tableAlias?: string }>;
  having: Condition[];
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
const JOIN_TYPES = new Set(['INNER', 'LEFT', 'RIGHT', 'FULL']);

interface Token {
  value: string;
  pos: number;
}

export function parseQuery(sql: string): ParsedQuery {
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
      throw new QueryParseError(
        `Expected "${kw}"`,
        t?.pos ?? sql.length,
        t?.value ?? '<end of input>',
      );
    }
  };

  expectKeyword('SELECT');
  const select = parseSelectList();
  expectKeyword('FROM');
  const fromTok = next();
  if (!fromTok) throw new QueryParseError('Expected sheet name after FROM', sql.length, '<end of input>');
  const from = stripQuotes(fromTok.value);
  let fromAlias: string | undefined;
  if (peek()?.value.toUpperCase() === 'AS') {
    next();
    const a = next();
    if (!a) throw new QueryParseError('Expected alias after AS', sql.length, '');
    fromAlias = stripQuotes(a.value);
  } else if (peek() && !isClauseKeyword(peek()!.value) && peek()!.value.toUpperCase() !== 'JOIN') {
    // Optional alias without AS: FROM Sheet1 a
    const maybe = peek()!;
    if (!JOIN_TYPES.has(maybe.value.toUpperCase()) && maybe.value !== ',') {
      fromAlias = stripQuotes(next()!.value);
    }
  }

  const joins: JoinClause[] = [];
  while (peek()) {
    const t = peek()!;
    const upper = t.value.toUpperCase();
    if (upper === 'JOIN' || JOIN_TYPES.has(upper)) {
      joins.push(parseJoin());
      continue;
    }
    break;
  }

  const where: Condition[] = [];
  const groupBy: Array<{ column: string; tableAlias?: string }> = [];
  const having: Condition[] = [];
  const orderBy: OrderByItem[] = [];
  let limit: number | undefined;

  while (peek()) {
    const t = peek()!;
    const kw = t.value.toUpperCase();
    if (kw === 'WHERE') {
      next();
      where.push(...parseWhere());
    } else if (kw === 'GROUP') {
      next();
      expectKeyword('BY');
      groupBy.push(...parseColRefList());
    } else if (kw === 'HAVING') {
      next();
      having.push(...parseWhere());
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
    } else if (kw === 'UNION' || kw === 'WITH') {
      throw new QueryParseError(
        `"${kw}" is not supported in SheetLab queries`,
        t.pos,
        t.value,
      );
    } else {
      throw new QueryParseError(`Unexpected token "${t.value}"`, t.pos, t.value);
    }
  }

  return { select, from, fromAlias, joins, where, groupBy, having, orderBy, limit };

  function isClauseKeyword(v: string): boolean {
    const u = v.toUpperCase();
    return u === 'WHERE' || u === 'GROUP' || u === 'ORDER' || u === 'LIMIT' || u === 'HAVING' || u === 'JOIN';
  }

  function parseJoin(): JoinClause {
    let type: JoinType = 'INNER';
    const first = next()!;
    const u = first.value.toUpperCase();
    if (u === 'JOIN') {
      type = 'INNER';
    } else if (JOIN_TYPES.has(u)) {
      type = u === 'FULL' ? 'FULL' : (u as JoinType);
      if (peek()?.value.toUpperCase() === 'OUTER') next();
      expectKeyword('JOIN');
    } else {
      throw new QueryParseError('Expected JOIN', first.pos, first.value);
    }

    const sheetTok = next();
    if (!sheetTok) throw new QueryParseError('Expected sheet name after JOIN', sql.length, '');
    const sheet = stripQuotes(sheetTok.value);

    let alias: string | undefined;
    if (peek()?.value.toUpperCase() === 'AS') {
      next();
      const a = next();
      if (!a) throw new QueryParseError('Expected alias after AS', sql.length, '');
      alias = stripQuotes(a.value);
    } else if (peek() && peek()!.value.toUpperCase() !== 'ON' && !isClauseKeyword(peek()!.value)) {
      const maybe = peek()!;
      if (maybe.value.toUpperCase() !== 'JOIN' && !JOIN_TYPES.has(maybe.value.toUpperCase())) {
        alias = stripQuotes(next()!.value);
      }
    }

    expectKeyword('ON');
    const on: JoinOnPair[] = [];
    for (;;) {
      const left = parseColRef();
      const eq = next();
      if (!eq || eq.value !== '=') {
        throw new QueryParseError(
          'JOIN ON only supports equality pairs (a.col = b.col [AND ...])',
          eq?.pos ?? sql.length,
          eq?.value ?? '',
        );
      }
      const right = parseColRef();
      on.push({ left, right });
      if (peek()?.value.toUpperCase() === 'AND') {
        next();
        continue;
      }
      break;
    }
    if (!on.length) {
      throw new QueryParseError('JOIN requires ON condition', sql.length, '');
    }

    return {
      type,
      sheet,
      alias,
      on,
      onLeft: on[0].left,
      onRight: on[0].right,
    };
  }

  function parseColRef(): { column: string; tableAlias?: string } {
    const t = next();
    if (!t) throw new QueryParseError('Expected column reference', sql.length, '');
    // token may already be "a.col" from tokenizer, or separate a . col
    if (t.value.includes('.') && !t.value.startsWith('.')) {
      const [a, ...rest] = t.value.split('.');
      return { tableAlias: stripQuotes(a), column: stripQuotes(rest.join('.')) };
    }
    if (peek()?.value === '.') {
      next();
      const col = next();
      if (!col) throw new QueryParseError('Expected column after "."', sql.length, '');
      return { tableAlias: stripQuotes(t.value), column: stripQuotes(col.value) };
    }
    return { column: stripQuotes(t.value) };
  }

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
    const t = peek();
    if (!t) throw new QueryParseError('Expected column or aggregate function', sql.length, '<end of input>');
    const upper = t.value.toUpperCase();
    if (AGG_FNS.has(upper) && tokens[pos + 1]?.value === '(') {
      next();
      next(); // '('
      let column = '*';
      let tableAlias: string | undefined;
      if (peek()?.value === '*') {
        next();
      } else {
        const ref = parseColRef();
        column = ref.column;
        tableAlias = ref.tableAlias;
      }
      const closeTok = next();
      if (!closeTok || closeTok.value !== ')') {
        throw new QueryParseError('Expected ")"', closeTok?.pos ?? sql.length, closeTok?.value ?? '');
      }
      let alias: string | undefined;
      if (peek()?.value.toUpperCase() === 'AS') {
        next();
        alias = stripQuotes(next()?.value ?? '');
      }
      return { column, tableAlias, aggFn: upper as SelectItem['aggFn'], alias };
    }

    const ref = parseColRef();
    let alias: string | undefined;
    if (peek()?.value.toUpperCase() === 'AS') {
      next();
      alias = stripQuotes(next()?.value ?? '');
    }
    return { column: ref.column, tableAlias: ref.tableAlias, alias };
  }

  function parseWhere(): Condition[] {
    const conditions: Condition[] = [];
    for (;;) {
      const ref = parseColRef();
      const opTok = next();
      if (!opTok) throw new QueryParseError('Expected comparison operator', sql.length, '');
      const op = opTok.value as Condition['op'];
      if (!['=', '!=', '<>', '<', '<=', '>', '>='].includes(op)) {
        throw new QueryParseError(`Unknown operator "${op}"`, opTok.pos, opTok.value);
      }
      const valTok = next();
      if (!valTok) throw new QueryParseError('Expected value after operator', sql.length, '');
      let value: string | number | null;
      if (valTok.value.toUpperCase() === 'NULL') {
        value = null;
      } else if (/^[-+]?\d+(\.\d+)?$/.test(valTok.value)) {
        value = Number(valTok.value);
      } else {
        value = stripQuotes(valTok.value);
      }
      conditions.push({ column: ref.column, tableAlias: ref.tableAlias, op, value });

      const conn = peek();
      if (conn && (conn.value.toUpperCase() === 'AND' || conn.value.toUpperCase() === 'OR')) {
        conditions[conditions.length - 1].connector = next()!.value.toUpperCase() as 'AND' | 'OR';
        continue;
      }
      break;
    }
    return conditions;
  }

  function parseColRefList(): Array<{ column: string; tableAlias?: string }> {
    const cols: Array<{ column: string; tableAlias?: string }> = [];
    for (;;) {
      cols.push(parseColRef());
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
      const ref = parseColRef();
      let direction: 'ASC' | 'DESC' = 'ASC';
      if (peek() && (peek()!.value.toUpperCase() === 'ASC' || peek()!.value.toUpperCase() === 'DESC')) {
        direction = next()!.value.toUpperCase() as 'ASC' | 'DESC';
      }
      items.push({ column: ref.column, tableAlias: ref.tableAlias, direction });
      if (peek()?.value === ',') {
        next();
        continue;
      }
      break;
    }
    return items;
  }
}

function stripQuotes(s: string): string {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'")) || (s.startsWith('`') && s.endsWith('`'))) {
    return s.slice(1, -1);
  }
  return s;
}

function tokenize(sql: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch;
      let j = i + 1;
      let val = '';
      while (j < sql.length) {
        if (sql[j] === quote && sql[j + 1] === quote) {
          val += quote;
          j += 2;
          continue;
        }
        if (sql[j] === quote) break;
        val += sql[j++];
      }
      tokens.push({ value: quote + val + quote, pos: i });
      i = j + 1;
      continue;
    }
    if ('(),.*'.includes(ch)) {
      tokens.push({ value: ch, pos: i });
      i++;
      continue;
    }
    // operators: <= >= <> != =
    if (ch === '<' || ch === '>' || ch === '!' || ch === '=') {
      if ((ch === '<' || ch === '>' || ch === '!') && sql[i + 1] === '=') {
        tokens.push({ value: ch + '=', pos: i });
        i += 2;
        continue;
      }
      if (ch === '<' && sql[i + 1] === '>') {
        tokens.push({ value: '<>', pos: i });
        i += 2;
        continue;
      }
      tokens.push({ value: ch, pos: i });
      i++;
      continue;
    }
    // identifier / number / dotted ref
    let j = i;
    while (j < sql.length && /[A-Za-z0-9_$.-]/.test(sql[j])) j++;
    if (j === i) {
      throw new QueryParseError(`Unexpected character "${ch}"`, i, ch);
    }
    tokens.push({ value: sql.slice(i, j), pos: i });
    i = j;
  }
  return tokens;
}
