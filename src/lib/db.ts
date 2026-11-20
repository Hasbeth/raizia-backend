import { AsyncLocalStorage } from "node:async_hooks";
import { createDatabase, dataDir } from "../../scripts/lib/database.mjs";
import { SEED_CATEGORIES } from "./seed-categories";

export const DATA_DIR = dataDir();
export type SqlValue = string | number | boolean | null;
export interface Database {
  query<T = Record<string, unknown>>(sql: string, params?: SqlValue[]): Promise<T[]>;
  exec(sql: string): Promise<void>;
  transaction<T>(fn: (database: Database) => Promise<T>): Promise<T>;
  close?(): Promise<void>;
  kind?: string;
}
const g = globalThis as unknown as { __raiziaPg?: Promise<Database> };
const scope = new AsyncLocalStorage<Database>();
export async function db(): Promise<Database> {
  if (scope.getStore()) return scope.getStore()!;
  g.__raiziaPg ??= createDatabase().then(async connection => {
    const database = connection as Database;
    if (connection.kind === "pglite") await seedCategories(database);
    return database;
  }).catch(error => { g.__raiziaPg = undefined; throw error; });
  return g.__raiziaPg;
}
function placeholders(sql: string): string {
  let n = 0;
  return sql.replace(/'(?:''|[^'])*'|\?/g, match => match === "?" ? `$${++n}` : match);
}
export async function query<T = Record<string, unknown>>(sql: string, params: SqlValue[] = []): Promise<T[]> {
  return (await db()).query<T>(placeholders(sql), params);
}
export const all = <T>(sql: string, ...params: SqlValue[]) => query<T>(sql, params);
export async function get<T>(sql: string, ...params: SqlValue[]): Promise<T | undefined> {
  return (await query<T>(sql, params))[0];
}
export async function run(sql: string, ...params: SqlValue[]) {
  const records = await query<{ id?: number }>(sql, params);
  return { changes: records.length, lastInsertRowid: records[0]?.id };
}
export async function tx<T>(fn: (database: Database) => Promise<T>): Promise<T> {
  if (scope.getStore()) return fn(scope.getStore()!);
  return (await db()).transaction(database => scope.run(database, () => fn(database)));
}
export async function closeDatabase() {
  const database = await g.__raiziaPg;
  g.__raiziaPg = undefined;
  await database?.close?.();
}
async function seedCategories(database: Database) {
  await database.transaction(async d => {
    if ((await d.query<{ n: number }>("SELECT count(*)::int n FROM categories"))[0].n) return;
    for (const [i,c] of SEED_CATEGORIES.entries()) {
      const [parent] = await d.query<{ id: number }>("INSERT INTO categories(name,slug,description,keywords,sort) VALUES($1,$2,$3,$4,$5) RETURNING id", [c.name,c.slug,c.description,c.keywords,i+1]);
      for (const [j,s] of c.children.entries()) {
        await d.query("INSERT INTO categories(parent_id,name,slug,keywords,sort) VALUES($1,$2,$3,$4,$5)", [parent.id,s.name,`${c.slug}--${slugify(s.name)}`,s.keywords ?? "",j+1]);
      }
    }
  });
}
export function slugify(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0,80);
}
