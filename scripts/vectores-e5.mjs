// Calcula embeddings locales (Xenova/multilingual-e5-small, q8, 384 dims, normalizados) para los
// fragmentos indexados del staging y los guarda en data/staging/vectores-e5.db (reanudable).
// Tabla: vectores(chunk_id PK, content_hash, model, dims, vector BLOB float32).
// Orden: colección principal primero, luego sentencias masivas por peso.
// Uso: node scripts/vectores-e5.mjs [--limite N]
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { env, pipeline } from "@huggingface/transformers";

const root = path.resolve(import.meta.dirname, "..");
const MODEL = "Xenova/multilingual-e5-small";
const DIMS = 384;
const BATCH = 32;
const limitArg = process.argv.indexOf("--limite");
const limit = limitArg > 0 ? Number(process.argv[limitArg + 1]) : Infinity;

env.localModelPath = process.env.RAIZIA_MODELOS_DIR || path.join(root, "data", "modelos");
const staging = new DatabaseSync(path.join(root, "data", "staging", "biblioteca.db"), { readOnly: true });
const out = new DatabaseSync(path.join(root, "data", "staging", "vectores-e5.db"));
out.exec(`PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS vectores (chunk_id INTEGER PRIMARY KEY, content_hash TEXT NOT NULL,
    model TEXT NOT NULL, dims INTEGER NOT NULL, vector BLOB NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
  CREATE INDEX IF NOT EXISTS vectores_hash ON vectores(content_hash);`);

const done = new Set(out.prepare("SELECT chunk_id FROM vectores").all().map((r) => r.chunk_id));
const pending = staging.prepare(`
  SELECT c.id, c.content_hash, c.content FROM chunks c JOIN documents d ON d.id = c.document_id
   WHERE c.indexed = 1
   ORDER BY (COALESCE(d.weight, 1) >= 1) DESC, COALESCE(d.weight, 1) DESC, c.document_id, c.ord`).all()
  .filter((r) => !done.has(r.id));
const total = done.size + pending.length;
const todo = pending.slice(0, limit);
console.log(`Ya calculados: ${done.size}. Pendientes: ${pending.length}. En esta ejecución: ${todo.length}.`);

const embed = await pipeline("feature-extraction", MODEL, { dtype: "q8" });
const insert = out.prepare("INSERT OR REPLACE INTO vectores (chunk_id, content_hash, model, dims, vector) VALUES (?, ?, ?, ?, ?)");
const t0 = performance.now();
let count = 0;
for (let i = 0; i < todo.length; i += BATCH) {
  const batch = todo.slice(i, i + BATCH);
  const res = await embed(batch.map((r) => "passage: " + r.content), { pooling: "mean", normalize: true });
  out.exec("BEGIN");
  batch.forEach((r, k) => {
    const v = res.data.slice(k * DIMS, (k + 1) * DIMS);
    insert.run(r.id, r.content_hash, "multilingual-e5-small", DIMS, Buffer.from(v.buffer, v.byteOffset, v.byteLength));
  });
  out.exec("COMMIT");
  count += batch.length;
  if (count % (BATCH * 20) === 0 || count === todo.length) {
    const rate = count / ((performance.now() - t0) / 1000);
    const left = (todo.length - count) / rate / 60;
    console.log(`${done.size + count}/${total} (${(((done.size + count) / total) * 100).toFixed(1)} %) · ${rate.toFixed(1)}/s · faltan ~${left.toFixed(0)} min`);
  }
}
console.log("Terminado.");
