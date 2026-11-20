import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import postgres from 'postgres';

export const isLocal = () => process.env.RAIZIA_MODO === 'local';
export const dataDir = () => path.resolve(/* turbopackIgnore: true */ process.env.RAIZIA_DATA_DIR || 'data');

export async function createDatabase({ url = process.env.DATABASE_URL, directory = process.env.RAIZIA_PGLITE_DIR || path.join(dataDir(), 'pglite'), memory = false } = {}) {
  if (url && !isLocal()) {
    const sql = postgres(url, { prepare: false, max: 3, idle_timeout: 20, connect_timeout: 15,
      types: { bigint: { to: 20, from: [20], serialize: String, parse: Number } } });
    const wrap = client => ({
      query: async (statement, params = []) => Array.from(await client.unsafe(statement, params)),
      exec: async statement => { await client.unsafe(statement).simple(); },
      transaction: fn => client.begin(t => fn(wrap(t))),
    });
    return { ...wrap(sql), kind: 'postgres', close: () => sql.end({ timeout: 5 }) };
  }
  if (process.env.VERCEL && !isLocal()) throw new Error('Configura DATABASE_URL en Vercel: PGlite es solo local.');
  const { PGlite } = await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ '@electric-sql/pglite');
  let vector;
  if (process.env.RAIZIA_PGLITE_VECTOR) {
    vector = { name: 'vector', setup: async () => ({ bundlePath: pathToFileURL(path.resolve(/* turbopackIgnore: true */ process.env.RAIZIA_PGLITE_VECTOR)) }) };
  } else {
    try {
      ({ vector } = await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ '@electric-sql/pglite/vector'));
    } catch {
      try {
        ({ vector } = await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ '@electric-sql/pglite-pgvector'));
      } catch { throw new Error('Falta pgvector para PGlite. Instala @electric-sql/pglite-pgvector o define RAIZIA_PGLITE_VECTOR con la ruta a vector.tar.gz.'); }
    }
  }
  if (!memory && directory !== ':memory:') await fs.mkdir(directory, { recursive: true });
  const p = new PGlite({ dataDir: memory || directory === ':memory:' ? undefined : directory, extensions: { vector } });
  const wrap = client => ({
    query: async (statement, params = []) => (await client.query(statement, params)).rows,
    exec: async statement => { await client.exec(statement); },
    transaction: fn => client.transaction(t => fn(wrap(t))),
  });
  const database = { ...wrap(p), kind: 'pglite', close: () => p.close() };
  await applySchema(database);
  return database;
}
export async function applySchema(database) {
  await database.exec(await fs.readFile(path.join(process.cwd(), 'supabase', 'schema.sql'), 'utf8'));
}
export async function resetSequences(database) {
  for (const name of ['categories', 'documents', 'chunks']) {
    await database.query(`SELECT setval(pg_get_serial_sequence('${name}','id'), COALESCE(MAX(id),1), MAX(id) IS NOT NULL) FROM ${name}`);
  }
}
