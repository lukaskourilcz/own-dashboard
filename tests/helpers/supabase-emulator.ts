import type { PGlite, Transaction } from '@electric-sql/pglite';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { setDatabaseTime } from './supabase-pglite';

/**
 * The Supabase HTTP surface the real `@supabase/supabase-js` client talks to, answered from PGlite: PostgREST
 * (`/rest/v1`: table reads with filters, logic trees, JSON paths, embedded resources and `!inner`, inserts,
 * upserts, updates, deletes and RPC) and Storage (`/storage/v1`: buckets, upload, info, download, signed URLs,
 * remove). Only the slice OwnDashboard uses is implemented; anything else answers 501 so a gap is loud.
 *
 * Every request runs in its own transaction under the role its bearer token names (service_role, or
 * authenticated with `request.jwt.claim.sub`), so grants and RLS apply as they do on Supabase, and the
 * database clock is set to the JavaScript clock first. Requests are serialized: PGlite has one connection.
 */
type Role = { role: 'service_role' | 'authenticated' | 'anon'; sub: string | null };
type Params = unknown[];
type ColumnExpr = { column: string; path: Array<{ op: '->' | '->>'; key: string }>; cast?: string };
type SelectItem =
  | { kind: 'star' }
  | { kind: 'column'; alias: string; expr: ColumnExpr }
  | { kind: 'embed'; alias: string; table: string; inner: boolean; hint: string | null; items: SelectItem[] };
type Relation = { kind: 'to-one' | 'to-many'; pairs: Array<{ parent: string; child: string }> };

export class PostgrestHttpError extends Error {
  constructor(readonly status: number, readonly body: Record<string, unknown>) { super(String(body.message)); }
}
const unsupported = (what: string): never => { throw new PostgrestHttpError(501, { code: 'EMULATOR', message: `supabase emulator: unsupported ${what}`, details: null, hint: null }); };
const ident = (name: string) => { if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) unsupported(`identifier ${name}`); return `"${name}"`; };
const literalKey = (key: string) => /^\d+$/.test(key) ? key : `'${key.replace(/'/g, "''")}'`;

/** Splits on commas outside parentheses and double quotes. */
function splitTop(value: string): string[] {
  const parts: string[] = []; let depth = 0, quoted = false, current = '';
  for (let index = 0; index < value.length; index++) {
    const char = value[index]!;
    if (char === '\\' && quoted) { current += char + (value[index + 1] ?? ''); index++; continue; }
    if (char === '"') quoted = !quoted;
    else if (!quoted && char === '(') depth++;
    else if (!quoted && char === ')') depth--;
    if (char === ',' && depth === 0 && !quoted) { parts.push(current); current = ''; continue; }
    current += char;
  }
  if (current) parts.push(current);
  return parts;
}
const unquote = (value: string) => value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1).replace(/\\(.)/g, '$1') : value;

export function parseColumnExpr(raw: string): ColumnExpr {
  const [body, cast] = raw.split('::');
  const match = /^([A-Za-z_][A-Za-z0-9_]*)((?:->>?[A-Za-z0-9_]+)*)$/.exec(body ?? '');
  if (!match) return unsupported(`column ${raw}`);
  const path = [...match[2]!.matchAll(/(->>?)([A-Za-z0-9_]+)/g)].map((part) => ({ op: part[1] as '->' | '->>', key: part[2]! }));
  return { column: match[1]!, path, ...(cast ? { cast } : {}) };
}

export function parseSelect(value: string): SelectItem[] {
  return splitTop(value).map((part): SelectItem => {
    if (part === '*') return { kind: 'star' };
    const aliased = /^([A-Za-z_][A-Za-z0-9_]*):(?!:)([\s\S]*)$/.exec(part);
    const alias = aliased?.[1] ?? null; const body = aliased ? aliased[2]! : part;
    const embed = /^([A-Za-z_][A-Za-z0-9_]*)((?:![A-Za-z0-9_]+)*)\(([\s\S]*)\)$/.exec(body);
    if (embed) {
      const hints = embed[2]!.split('!').filter(Boolean);
      return { kind: 'embed', alias: alias ?? embed[1]!, table: embed[1]!, inner: hints.includes('inner'), hint: hints.find((hint) => hint !== 'inner' && hint !== 'left') ?? null, items: parseSelect(embed[3] || '*') };
    }
    const expr = parseColumnExpr(body);
    return { kind: 'column', alias: alias ?? (expr.path.at(-1)?.key ?? expr.column), expr };
  });
}

class SqlBuilder {
  readonly params: Params = [];
  bind(value: unknown): string { this.params.push(value); return `$${this.params.length}`; }
}

function columnSql(alias: string, expr: ColumnExpr): string {
  let sql = `${alias}.${ident(expr.column)}`;
  for (const part of expr.path) sql = `(${sql}${part.op}${literalKey(part.key)})`;
  return expr.cast ? `(${sql})::${ident(expr.cast).slice(1, -1)}` : sql;
}

const OPERATORS: Record<string, string> = { eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=', like: 'like', ilike: 'ilike' };
/** One `[not.]op.value` condition on a column expression. */
function conditionSql(builder: SqlBuilder, column: string, raw: string): string {
  let negate = false; let rest = raw;
  if (rest.startsWith('not.')) { negate = true; rest = rest.slice(4); }
  const dot = rest.indexOf('.');
  const op = dot < 0 ? rest : rest.slice(0, dot); const value = dot < 0 ? '' : rest.slice(dot + 1);
  let sql: string;
  if (op === 'is') {
    const keyword = { null: 'null', true: 'true', false: 'false', unknown: 'unknown' }[value.toLowerCase()];
    if (!keyword) unsupported(`is.${value}`);
    sql = `${column} is ${keyword}`;
  } else if (op === 'in') {
    if (!value.startsWith('(') || !value.endsWith(')')) unsupported(`in ${value}`);
    const items = splitTop(value.slice(1, -1)).map(unquote);
    sql = items.length ? `${column} in (${items.map((item) => builder.bind(item)).join(',')})` : 'false';
  } else if (OPERATORS[op]) {
    const bound = op === 'like' || op === 'ilike' ? unquote(value).replace(/\*/g, '%') : unquote(value);
    sql = `${column} ${OPERATORS[op]} ${builder.bind(bound)}`;
  } else return unsupported(`operator ${op}`);
  return negate ? `not (${sql})` : sql;
}

/** `or=(a.is.null,b.lt."x")`, `and=(…)` and nested `or(…)`/`and(…)`/`not.or(…)`. */
function logicSql(builder: SqlBuilder, alias: string, joiner: 'or' | 'and', raw: string): string {
  if (!raw.startsWith('(') || !raw.endsWith(')')) unsupported(`logic ${raw}`);
  const parts = splitTop(raw.slice(1, -1)).map((part) => {
    const nested = /^(not\.)?(and|or)(\([\s\S]*\))$/.exec(part);
    if (nested) { const sql = logicSql(builder, alias, nested[2] as 'or' | 'and', nested[3]!); return nested[1] ? `not ${sql}` : sql; }
    const match = /^([A-Za-z_][A-Za-z0-9_]*(?:->>?[A-Za-z0-9_]+)*)\.([\s\S]*)$/.exec(part);
    if (!match) return unsupported(`logic item ${part}`);
    return conditionSql(builder, columnSql(alias, parseColumnExpr(match[1]!)), match[2]!);
  });
  return `(${parts.join(` ${joiner} `)})`;
}

const RESERVED = new Set(['select', 'order', 'limit', 'offset', 'on_conflict', 'columns']);
type Filters = { own: Array<[string, string]>; embedded: Map<string, Array<[string, string]>> };
function splitFilters(search: URLSearchParams, embeds: readonly string[]): Filters {
  const filters: Filters = { own: [], embedded: new Map() };
  for (const [key, value] of search) {
    if (RESERVED.has(key)) continue;
    const dot = key.indexOf('.');
    const scope = dot > 0 ? key.slice(0, dot) : null;
    if (scope && embeds.includes(scope)) {
      const list = filters.embedded.get(scope) ?? [];
      list.push([key.slice(dot + 1), value]); filters.embedded.set(scope, list);
    } else if (dot > 0 && !['or', 'and', 'not'].includes(key)) unsupported(`filter key ${key}`);
    else filters.own.push([key, value]);
  }
  return filters;
}
function filterSql(builder: SqlBuilder, alias: string, filters: ReadonlyArray<[string, string]>): string[] {
  return filters.map(([key, value]) => key === 'or' || key === 'and' ? logicSql(builder, alias, key, value)
    : key === 'not.or' || key === 'not.and' ? `not ${logicSql(builder, alias, key.slice(4) as 'or' | 'and', value)}`
      : conditionSql(builder, columnSql(alias, parseColumnExpr(key)), value));
}

export class SupabaseEmulator {
  private queue: Promise<unknown> = Promise.resolve();
  private relations = new Map<string, Relation>();
  private functions = new Map<string, Array<{ args: string[]; types: string[]; defaults: number; retset: boolean; returns: string; composite: boolean }>>();
  readonly requests: Array<{ method: string; path: string; status: number }> = [];
  readonly signingSecret = 'TEST-ONLY-storage-signing-secret';

  constructor(readonly db: PGlite, readonly origin: string, readonly tokens: { service: string; users: Record<string, string> }, readonly clock: () => Date = () => new Date()) {}

  /** Runs `work` alone on the connection, in a transaction, as `role`, at the JavaScript clock. */
  serialized<T>(role: Role, work: (tx: Transaction) => Promise<T>): Promise<T> {
    const run = async () => {
      await setDatabaseTime(this.db, this.clock());
      return this.db.transaction(async (tx) => {
        await tx.query(`select set_config('role',$1,true), set_config('request.jwt.claim.sub',$2,true), set_config('request.jwt.claim.role',$1,true),
          set_config('request.jwt.claims',$3,true), set_config('TimeZone','UTC',true)`, [role.role, role.sub ?? '', JSON.stringify({ role: role.role, ...(role.sub ? { sub: role.sub } : {}) })]);
        return work(tx);
      });
    };
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => undefined);
    return result;
  }
  /** Test-side SQL as the database owner (no role switch), serialized with the requests. */
  sql<T = Record<string, unknown>>(text: string, params: Params = []): Promise<T[]> {
    const run = async () => { await setDatabaseTime(this.db, this.clock()); return (await this.db.query<T>(text, params)).rows; };
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => undefined);
    return result;
  }

  private role(request: Request): Role {
    const bearer = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? request.headers.get('apikey') ?? '';
    if (bearer === this.tokens.service) return { role: 'service_role', sub: null };
    const user = Object.entries(this.tokens.users).find(([, token]) => token === bearer)?.[0];
    return user ? { role: 'authenticated', sub: user } : { role: 'anon', sub: null };
  }

  async fetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
    const request = input instanceof Request && !init ? input : new Request(input, init);
    const url = new URL(request.url);
    let response: Response;
    try {
      if (url.origin !== this.origin) throw new PostgrestHttpError(404, { message: `unknown origin ${url.origin}` });
      if (url.pathname.startsWith('/rest/v1/')) response = await this.rest(request, url);
      else if (url.pathname.startsWith('/storage/v1/')) response = await this.storage(request, url);
      else response = Response.json({ message: `supabase emulator: no route ${url.pathname}` }, { status: 501 });
    } catch (error) {
      response = error instanceof PostgrestHttpError ? Response.json(error.body, { status: error.status })
        : Response.json({ code: 'XX000', message: error instanceof Error ? error.message : String(error), details: null, hint: null }, { status: 500 });
    }
    this.requests.push({ method: request.method, path: url.pathname, status: response.status });
    return response;
  }

  // ---------------------------------------------------------------- PostgREST
  private async relation(tx: Transaction, parent: string, child: string, hint: string | null): Promise<Relation> {
    const cacheKey = `${parent}|${child}|${hint ?? ''}`;
    const known = this.relations.get(cacheKey); if (known) return known;
    const { rows } = await tx.query<{ conname: string; from_table: string; to_table: string; from_cols: string[]; to_cols: string[] }>(`
      select c.conname, cf.relname as from_table, ct.relname as to_table,
        array(select a.attname from unnest(c.conkey) with ordinality k(n,i) join pg_attribute a on a.attrelid=c.conrelid and a.attnum=k.n order by k.i)::text[] as from_cols,
        array(select a.attname from unnest(c.confkey) with ordinality k(n,i) join pg_attribute a on a.attrelid=c.confrelid and a.attnum=k.n order by k.i)::text[] as to_cols
      from pg_constraint c join pg_class cf on cf.oid=c.conrelid join pg_class ct on ct.oid=c.confrelid join pg_namespace n on n.oid=cf.relnamespace
      where c.contype='f' and n.nspname='public' and ((cf.relname=$1 and ct.relname=$2) or (cf.relname=$2 and ct.relname=$1))`, [parent, child]);
    const candidates = rows.filter((row) => !hint || row.conname === hint || row.from_cols.includes(hint));
    // A self-reference or two keys between the same tables needs a hint, as PostgREST requires (PGRST201).
    if (candidates.length !== 1) throw new PostgrestHttpError(300, { code: 'PGRST201', message: `Could not embed ${child} into ${parent}: ${candidates.length} relationships` });
    const fk = candidates[0]!;
    const relation: Relation = fk.from_table === parent
      ? { kind: 'to-one', pairs: fk.from_cols.map((column, index) => ({ parent: column, child: fk.to_cols[index]! })) }
      : { kind: 'to-many', pairs: fk.to_cols.map((column, index) => ({ parent: column, child: fk.from_cols[index]! })) };
    this.relations.set(cacheKey, relation);
    return relation;
  }

  /** `jsonb` of one row of `alias` per the select list, with embedded resources as correlated subqueries. */
  private async objectSql(tx: Transaction, builder: SqlBuilder, table: string, alias: string, items: SelectItem[], filters: Filters, depth: number): Promise<{ sql: string; inner: string[] }> {
    const parts: string[] = []; const inner: string[] = [];
    let star = false;
    for (const item of items) {
      if (item.kind === 'star') { star = true; continue; }
      if (item.kind === 'column') { parts.push(`${literalKey(item.alias)}, ${columnSql(alias, item.expr)}`); continue; }
      const child = `t${depth + 1}`;
      const relation = await this.relation(tx, table, item.table, item.hint);
      const join = relation.pairs.map((pair) => `${child}.${ident(pair.child)} = ${alias}.${ident(pair.parent)}`).join(' and ');
      const childFilters = [...(filters.embedded.get(item.alias) ?? []), ...(item.alias !== item.table ? filters.embedded.get(item.table) ?? [] : [])];
      const where = [join, ...filterSql(builder, child, childFilters)].join(' and ');
      const nested = await this.objectSql(tx, builder, item.table, child, item.items, { own: [], embedded: new Map() }, depth + 1);
      const body = relation.kind === 'to-one'
        ? `(select ${nested.sql} from public.${ident(item.table)} ${child} where ${where} limit 1)`
        : `(select coalesce(jsonb_agg(${nested.sql}), '[]'::jsonb) from public.${ident(item.table)} ${child} where ${where})`;
      parts.push(`${literalKey(item.alias)}, ${body}`);
      if (item.inner) inner.push(`exists(select 1 from public.${ident(item.table)} ${child} where ${where})`);
    }
    const object = parts.length ? `jsonb_build_object(${parts.join(', ')})` : null;
    return { sql: star ? (object ? `(to_jsonb(${alias}) || ${object})` : `to_jsonb(${alias})`) : (object ?? `'{}'::jsonb`), inner };
  }

  private orderSql(alias: string, raw: string | null): string {
    if (!raw) return '';
    return ` order by ${splitTop(raw).map((part) => {
      const pieces = part.split('.');
      const column = columnSql(alias, parseColumnExpr(pieces[0]!));
      const direction = pieces.includes('desc') ? 'desc' : 'asc';
      const nulls = pieces.includes('nullsfirst') ? ' nulls first' : pieces.includes('nullslast') ? ' nulls last' : '';
      return `${column} ${direction}${nulls}`;
    }).join(', ')}`;
  }

  private async rest(request: Request, url: URL): Promise<Response> {
    const name = url.pathname.slice('/rest/v1/'.length);
    const role = this.role(request);
    if (name.startsWith('rpc/')) return this.rpc(request, role, name.slice(4));
    const table = decodeURIComponent(name); ident(table);
    const prefer = request.headers.get('prefer') ?? '';
    const representation = /return=representation/.test(prefer);
    const items = parseSelect(url.searchParams.get('select') ?? '*');
    const embeds = items.flatMap((item) => item.kind === 'embed' ? [item.alias, item.table] : []);
    const filters = splitFilters(url.searchParams, embeds);
    const single = (request.headers.get('accept') ?? '').includes('application/vnd.pgrst.object+json');
    const method = request.method.toUpperCase();
    const body = method === 'GET' || method === 'HEAD' || method === 'DELETE' ? null : await request.text();
    const rows = await this.serialized(role, async (tx) => {
      const builder = new SqlBuilder();
      if (method === 'GET' || method === 'HEAD') {
        const object = await this.objectSql(tx, builder, table, 't0', items, filters, 0);
        const where = [...filterSql(builder, 't0', filters.own), ...object.inner];
        const limit = url.searchParams.get('limit'), offset = url.searchParams.get('offset');
        const sql = `select ${object.sql} as row from public.${ident(table)} t0${where.length ? ` where ${where.join(' and ')}` : ''}${this.orderSql('t0', url.searchParams.get('order'))}`
          + `${limit !== null ? ` limit ${Number.parseInt(limit, 10)}` : ''}${offset !== null ? ` offset ${Number.parseInt(offset, 10)}` : ''}`;
        return (await tx.query<{ row: unknown }>(sql, builder.params)).rows.map((row) => row.row);
      }
      let mutation: string;
      if (method === 'POST') {
        const value = JSON.parse(body || 'null') as unknown;
        const records = (Array.isArray(value) ? value : [value]) as Array<Record<string, unknown>>;
        if (!records.length) return [];
        const columns = url.searchParams.get('columns')?.split(',').map((column) => unquote(column)) ?? [...new Set(records.flatMap((record) => Object.keys(record)))];
        const list = columns.map(ident).join(',');
        const conflict = url.searchParams.get('on_conflict');
        let onConflict = '';
        if (/resolution=merge-duplicates/.test(prefer)) {
          const target = (conflict ?? 'id').split(',').map(ident).join(',');
          const updates = columns.filter((column) => !(conflict ?? 'id').split(',').includes(column)).map((column) => `${ident(column)}=excluded.${ident(column)}`);
          onConflict = ` on conflict (${target}) do ${updates.length ? `update set ${updates.join(',')}` : 'nothing'}`;
        } else if (/resolution=ignore-duplicates/.test(prefer)) onConflict = ` on conflict${conflict ? ` (${conflict.split(',').map(ident).join(',')})` : ''} do nothing`;
        mutation = `insert into public.${ident(table)} (${list}) select ${list} from jsonb_populate_recordset(null::public.${ident(table)}, ${builder.bind(JSON.stringify(records))}::jsonb)${onConflict} returning *`;
      } else if (method === 'PATCH') {
        const value = JSON.parse(body || '{}') as Record<string, unknown>;
        const columns = Object.keys(value);
        if (!columns.length) unsupported('empty update');
        const where = filterSql(builder, `public.${ident(table)}`, filters.own);
        mutation = `update public.${ident(table)} set (${columns.map(ident).join(',')}) = (select ${columns.map(ident).join(',')} from jsonb_populate_record(null::public.${ident(table)}, ${builder.bind(JSON.stringify(value))}::jsonb))`
          + `${where.length ? ` where ${where.join(' and ')}` : ''} returning *`;
      } else if (method === 'DELETE') {
        const where = filterSql(builder, `public.${ident(table)}`, filters.own);
        mutation = `delete from public.${ident(table)}${where.length ? ` where ${where.join(' and ')}` : ''} returning *`;
      } else return unsupported(`method ${method}`);
      const object = await this.objectSql(tx, builder, table, 't0', items, { own: [], embedded: filters.embedded }, 0);
      const sql = `with m as (${mutation}) select ${object.sql} as row from m t0`;
      return (await tx.query<{ row: unknown }>(sql, builder.params)).rows.map((row) => row.row);
    }).catch((error: unknown) => { throw error instanceof PostgrestHttpError ? error : databaseError(error); });
    if (method !== 'GET' && !representation) return new Response(null, { status: method === 'POST' ? 201 : 204 });
    if (single) {
      if (rows.length !== 1) throw new PostgrestHttpError(406, { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned', details: `The result contains ${rows.length} rows`, hint: null });
      return Response.json(rows[0], { status: method === 'POST' ? 201 : 200 });
    }
    return Response.json(rows, { status: method === 'POST' ? 201 : 200 });
  }

  private async rpc(request: Request, role: Role, name: string): Promise<Response> {
    ident(name);
    const args = (request.method === 'GET' ? Object.fromEntries(new URL(request.url).searchParams) : JSON.parse((await request.text()) || '{}')) as Record<string, unknown>;
    const result = await this.serialized(role, async (tx) => {
      const overloads = await this.functionInfo(tx, name);
      const keys = Object.keys(args);
      const fn = overloads.find((candidate) => keys.every((key) => candidate.args.includes(key)) && candidate.args.slice(0, candidate.args.length - candidate.defaults).every((arg) => keys.includes(arg)));
      if (!fn) throw new PostgrestHttpError(404, { code: 'PGRST202', message: `Could not find the function public.${name}(${keys.join(', ')}) in the schema cache`, details: null, hint: null });
      const builder = new SqlBuilder();
      const call = `public.${ident(name)}(${keys.map((key) => {
        const type = fn.types[fn.args.indexOf(key)]!;
        const value = args[key];
        const bound = value === null || value === undefined ? null
          : type === 'json' || type === 'jsonb' ? JSON.stringify(value)
            : type.endsWith('[]') ? (Array.isArray(value) ? `{${value.map((item) => `"${String(item).replace(/(["\\])/g, '\\$1')}"`).join(',')}}` : String(value))
              : typeof value === 'object' ? JSON.stringify(value) : String(value);
        return `${ident(key)} => ${builder.bind(bound)}::${type}`;
      }).join(', ')})`;
      if (fn.returns === 'void') { await tx.query(`select ${call}`, builder.params); return null; }
      const sql = fn.retset ? `select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) as r from ${call} r` : `select to_jsonb(${call}) as r`;
      return (await tx.query<{ r: unknown }>(sql, builder.params)).rows[0]?.r ?? null;
    }).catch((error: unknown) => { throw error instanceof PostgrestHttpError ? error : databaseError(error); });
    return result === null ? new Response(null, { status: 204 }) : Response.json(result);
  }

  private async functionInfo(tx: Transaction, name: string) {
    const known = this.functions.get(name); if (known) return known;
    const { rows } = await tx.query<{ args: string[] | null; types: string[]; defaults: number; retset: boolean; returns: string; composite: boolean }>(`
      select p.proargnames as args, array(select format_type(t, null) from unnest(p.proargtypes) t)::text[] as types, p.pronargdefaults::int as defaults,
        p.proretset as retset, format_type(p.prorettype, null) as returns, (select typtype='c' from pg_type where oid=p.prorettype) as composite
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=$1`, [name]);
    const overloads = rows.map((row) => ({ ...row, args: (row.args ?? []).slice(0, row.types.length) }));
    this.functions.set(name, overloads);
    return overloads;
  }

  // ---------------------------------------------------------------- Storage
  signToken(bucket: string, path: string, expiresIn: number): string {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const now = Math.floor(this.clock().getTime() / 1000);
    const payload = Buffer.from(JSON.stringify({ url: `${bucket}/${path}`, iat: now, exp: now + expiresIn })).toString('base64url');
    const signature = createHmac('sha256', this.signingSecret).update(`${header}.${payload}`).digest('base64url');
    return `${header}.${payload}.${signature}`;
  }
  private verifyToken(token: string, bucket: string, path: string): boolean {
    const [header, payload, signature] = token.split('.');
    if (!header || !payload || !signature || createHmac('sha256', this.signingSecret).update(`${header}.${payload}`).digest('base64url') !== signature) return false;
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { url?: string; exp?: number };
    return claims.url === `${bucket}/${path}` && typeof claims.exp === 'number' && claims.exp * 1000 > this.clock().getTime();
  }

  private async storage(request: Request, url: URL): Promise<Response> {
    const role = this.role(request);
    const segments = url.pathname.slice('/storage/v1/'.length).split('/').map(decodeURIComponent);
    const method = request.method.toUpperCase();
    const storageError = (status: number, error: string, message: string) => Response.json({ statusCode: String(status), error, message }, { status: status === 404 ? 400 : status });
    if (segments[0] === 'bucket' && segments.length === 2 && method === 'GET') {
      const rows = await this.serialized(role, (tx) => tx.query<{ row: unknown }>('select to_jsonb(b) as row from storage.buckets b where id=$1', [segments[1]]));
      return rows.rows[0] ? Response.json(rows.rows[0].row) : storageError(404, 'Bucket not found', 'Bucket not found');
    }
    if (segments[0] !== 'object') return Response.json({ message: `supabase emulator: storage route ${url.pathname}` }, { status: 501 });
    // Signed download: no credentials, the token is the authority.
    if (segments[1] === 'sign' && method === 'GET') {
      const [bucket, ...path] = segments.slice(2);
      if (!bucket || !this.verifyToken(url.searchParams.get('token') ?? '', bucket, path.join('/'))) return storageError(400, 'InvalidJWT', 'invalid signature');
      return this.download(bucket, path.join('/'), { role: 'service_role', sub: null }, method);
    }
    if (role.role !== 'service_role') return storageError(403, 'Unauthorized', 'the emulator serves the service role only');
    if (segments[1] === 'info') return this.info(segments[2]!, segments.slice(3).join('/'), role);
    if (segments[1] === 'sign' && method === 'POST') {
      const body = JSON.parse(await request.text()) as { expiresIn: number; paths?: string[] };
      const bucket = segments[2]!; const path = segments.slice(3).join('/');
      if (path) {
        const exists = await this.objectRow(bucket, path, role);
        if (!exists) return storageError(404, 'not_found', 'Object not found');
        return Response.json({ signedURL: `/object/sign/${bucket}/${path}?token=${this.signToken(bucket, path, body.expiresIn)}` });
      }
      const result = [];
      for (const item of body.paths ?? []) {
        const exists = await this.objectRow(bucket, item, role);
        result.push(exists ? { error: null, path: item, signedURL: `/object/sign/${bucket}/${item}?token=${this.signToken(bucket, item, body.expiresIn)}` }
          : { error: 'Either the object does not exist or you do not have access to it', path: item, signedURL: null });
      }
      return Response.json(result);
    }
    const authenticated = segments[1] === 'authenticated' ? 2 : 1;
    const bucket = segments[authenticated]!; const path = segments.slice(authenticated + 1).join('/');
    if (method === 'DELETE' && !path) {
      const { prefixes } = JSON.parse(await request.text()) as { prefixes: string[] };
      const removed = await this.serialized(role, (tx) => tx.query<{ row: unknown }>('delete from storage.objects where bucket_id=$1 and name = any($2::text[]) returning jsonb_build_object(\'name\',name,\'bucket_id\',bucket_id) as row', [bucket, prefixes]));
      return Response.json(removed.rows.map((row) => row.row));
    }
    if (method === 'GET' || method === 'HEAD') return this.download(bucket, path, role, method);
    if (method === 'POST' || method === 'PUT') {
      const bytes = Buffer.from(await request.arrayBuffer());
      const contentType = (request.headers.get('content-type') ?? 'application/octet-stream').split(';')[0]!.trim();
      const metadata = request.headers.get('x-metadata') ? JSON.parse(Buffer.from(request.headers.get('x-metadata')!, 'base64').toString('utf8')) : {};
      const upsert = method === 'PUT' || request.headers.get('x-upsert') === 'true';
      return this.serialized(role, async (tx) => {
        const config = (await tx.query<{ public: boolean; file_size_limit: number | null; allowed_mime_types: string[] | null }>('select public,file_size_limit,allowed_mime_types from storage.buckets where id=$1', [bucket])).rows[0];
        if (!config) return storageError(404, 'Bucket not found', 'Bucket not found');
        if (config.file_size_limit !== null && bytes.length > Number(config.file_size_limit)) return storageError(413, 'Payload too large', 'The object exceeded the maximum allowed size');
        if (config.allowed_mime_types?.length && !config.allowed_mime_types.includes(contentType)) return storageError(415, 'invalid_mime_type', `mime type ${contentType} is not supported`);
        const existing = (await tx.query('select 1 from storage.objects where bucket_id=$1 and name=$2', [bucket, path])).rows.length > 0;
        if (existing && !upsert) return storageError(409, 'Duplicate', 'The resource already exists');
        const system = { size: bytes.length, mimetype: contentType, eTag: `"${createHash('md5').update(bytes).digest('hex')}"`, cacheControl: request.headers.get('cache-control') ?? 'no-cache' };
        const id = randomUUID();
        await tx.query(`insert into storage.objects(id,bucket_id,name,metadata,user_metadata,bytes) values($1,$2,$3,$4,$5,$6)
          on conflict(bucket_id,name) do update set metadata=excluded.metadata,user_metadata=excluded.user_metadata,bytes=excluded.bytes,updated_at=now()`,
        [id, bucket, path, JSON.stringify(system), JSON.stringify(metadata), bytes]);
        return Response.json({ Id: id, Key: `${bucket}/${path}` });
      });
    }
    return Response.json({ message: `supabase emulator: storage ${method} ${url.pathname}` }, { status: 501 });
  }
  private async objectRow(bucket: string, path: string, role: Role) {
    const { rows } = await this.serialized(role, (tx) => tx.query<{ id: string; name: string; bucket_id: string; metadata: Record<string, unknown>; user_metadata: Record<string, unknown>; bytes: Uint8Array; created_at: string; updated_at: string }>(
      'select id,name,bucket_id,metadata,user_metadata,bytes,created_at::text,updated_at::text from storage.objects where bucket_id=$1 and name=$2', [bucket, path]));
    return rows[0] ?? null;
  }
  private async info(bucket: string, path: string, role: Role): Promise<Response> {
    const row = await this.objectRow(bucket, path, role);
    if (!row) return Response.json({ statusCode: '404', error: 'not_found', message: 'Object not found' }, { status: 400 });
    return Response.json({ id: row.id, name: row.name, version: row.id, bucket_id: row.bucket_id, size: row.metadata.size, content_type: row.metadata.mimetype, cache_control: row.metadata.cacheControl,
      etag: row.metadata.eTag, metadata: row.user_metadata, created_at: row.created_at, last_modified: row.updated_at });
  }
  private async download(bucket: string, path: string, role: Role, method: string): Promise<Response> {
    const row = await this.objectRow(bucket, path, role);
    if (!row) return Response.json({ statusCode: '404', error: 'not_found', message: 'Object not found' }, { status: 400 });
    const headers = { 'content-type': String(row.metadata.mimetype), 'content-length': String(row.bytes.length), etag: String(row.metadata.eTag) };
    return new Response(method === 'HEAD' ? null : new Uint8Array(row.bytes), { headers });
  }
}

function databaseError(error: unknown): PostgrestHttpError {
  const value = error as { code?: string; message?: string; detail?: string; hint?: string };
  const status = value.code === '23505' ? 409 : value.code === '42501' ? 403 : value.code === 'P0002' ? 404 : 400;
  return new PostgrestHttpError(status, { code: value.code ?? 'XX000', message: value.message ?? String(error), details: value.detail ?? null, hint: value.hint ?? null });
}
