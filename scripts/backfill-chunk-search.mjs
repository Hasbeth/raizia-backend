import { pathToFileURL } from 'node:url';
import { createDatabase } from './lib/database.mjs';

/** --after-id es el último id confirmado; repetir un lote es seguro. */
export async function backfillChunkSearch(database, { afterId = 0, onBatch = () => {} } = {}) {
  if (!Number.isSafeInteger(afterId) || afterId < 0) throw new Error('afterId debe ser un entero no negativo.');
  let lastId = afterId, total = 0;
  for (;;) {
    const [batch] = await database.query(`WITH batch AS MATERIALIZED (
      SELECT id, heading, content FROM chunks
      WHERE id > $1 AND content IS NOT NULL ORDER BY id LIMIT 2000 FOR SHARE
    ), written AS (
      INSERT INTO chunk_search(chunk_id, tsv)
      SELECT id, to_tsvector('simple', f_fold(heading || ' ' || content)) FROM batch
      ON CONFLICT (chunk_id) DO UPDATE SET tsv = EXCLUDED.tsv
      RETURNING chunk_id
    ) SELECT max(chunk_id)::integer AS last_id, count(*)::integer AS count FROM written`, [lastId]);
    // FOR SHARE evita sobrescribir con texto antiguo una actualización concurrente del trigger.
    if (!batch.count) return { lastId, total };
    lastId = batch.last_id;
    total += batch.count;
    onBatch({ lastId, count: batch.count, total });
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== '--after-id' || !/^\d+$/.test(args[1]))) {
    throw new Error('Uso: node scripts/backfill-chunk-search.mjs [--after-id ID]');
  }
  if (!process.env.DATABASE_URL) throw new Error('Falta DATABASE_URL.');
  const afterId = args.length ? Number(args[1]) : 0;
  if (!Number.isSafeInteger(afterId)) throw new Error('ID fuera de rango.');
  const database = await createDatabase({ url: process.env.DATABASE_URL });
  try {
    await backfillChunkSearch(database, { afterId, onBatch: batch => console.log(JSON.stringify(batch)) });
  } finally { await database.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    // Los errores de conexión pueden incluir credenciales; nunca imprimir el error original.
    console.error('No se completó el relleno. Revisa DATABASE_URL, el esquema y --after-id; reanuda desde el último lastId confirmado.');
    process.exitCode = 1;
  });
}
