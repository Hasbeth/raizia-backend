import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import postgres from 'postgres';

export const isLocal = () => process.env.RAIZIA_MODO === 'local';
export const dataDir = () => path.resolve(/* turbopackIgnore: true */ process.env.RAIZIA_DATA_DIR || 'data');

export async function createDatabase({ url = process.env.DATABASE_URL, directory = process.env.RAIZIA_PGLITE_DIR || path.join(dataDir(), 'pglite'), memory = false } = {}) {
  if (url && !isLocal()) {
    const connect = () => postgres(url, { prepare: false, max: 3, idle_timeout: 20, connect_timeout: 15,
      types: { bigint: { to: 20, from: [20], serialize: String, parse: Number } } });
    let sql = connect();
    // En Vercel una función congelada puede dejar un socket colgado: sin este límite,
    // las consultas siguientes esperan una conexión hasta agotar los 300 s de la función.
    const limitMs = process.env.VERCEL ? Number(process.env.DB_QUERY_TIMEOUT_MS || 25_000) : 0;
    const guarded = (start, ms = limitMs) => {
      if (!ms) return start();
      const owner = sql;
      let timer;
      const expired = new Promise((_, reject) => {
        timer = setTimeout(() => {
          if (owner === sql) { sql = connect(); owner.end({ timeout: 0 }).catch(() => {}); }
          reject(new Error('db_timeout'));
        }, ms);
      });
      return Promise.race([start(), expired]).finally(() => clearTimeout(timer));
    };
    const wrap = client => ({
      query: async (statement, params = []) => Array.from(await guarded(() => client().unsafe(statement, params))),
      exec: async statement => { await guarded(() => client().unsafe(statement).simple()); },
      transaction: fn => guarded(() => client().begin(t => fn(wrap(() => t))), limitMs * 4),
    });
    // Producción: conexión diferida SIN DDL. applySchema es exclusivo del cargador/
    // mantenimiento explícito; GIN/HNSW y DROP INDEX no pertenecen al arranque frío.
    return { ...wrap(() => sql), kind: 'postgres', close: () => sql.end({ timeout: 5 }) };
  }
  if ((process.env.VERCEL || process.env.NODE_ENV === 'production') && !isLocal()) throw new Error('Configura DATABASE_URL en producción: PGlite es solo local.');
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
