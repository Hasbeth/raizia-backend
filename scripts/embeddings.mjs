import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parseEnv } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { MODEL, parseLimit } from "./lib/embeddings-core.mjs";
import { runEmbeddingQueue } from "./lib/embeddings-runner.mjs";
import { ROOT, DATA, STAGING, assertWritable, acquireLock, recoverPublication, writeJson, isMain } from "./lib/biblioteca-io.mjs";

export async function main() {
  const limit = parseLimit(process.argv.slice(2));
  // No se imprime, no se carga en el entorno global y no se importa ningún SDK.
  const envPath = path.join(ROOT, ".env.local");
  const local = fs.existsSync(envPath) ? parseEnv(fs.readFileSync(envPath, "utf8")) : {};
  const apiKey = process.env.GEMINI_API_KEY || local.GEMINI_API_KEY;
  const dims = Number(process.env.EMBED_DIMS || local.EMBED_DIMS || 384);
  const batchSize = Number(process.env.EMBED_BATCH || local.EMBED_BATCH || 30);
  if (!Number.isSafeInteger(dims) || dims < 1 || dims > 65_536) throw new Error("EMBED_DIMS debe ser un entero positivo válido");
  if (!Number.isInteger(batchSize) || batchSize < 20 || batchSize > 50) throw new Error("EMBED_BATCH debe estar entre 20 y 50");
  const release = acquireLock(DATA);
  let db;
  let lastProgress;
  const controller = new AbortController();
  const interrupt = () => { console.log("Interrupción solicitada; conservando los lotes confirmados..."); controller.abort(); };
  process.on("SIGINT", interrupt); process.on("SIGTERM", interrupt);
  const progressPath = assertWritable(path.join(STAGING, "progreso.json"));
  try {
    recoverPublication(STAGING);
    const dbPath = assertWritable(path.join(STAGING, "biblioteca.db"));
    if (!fs.existsSync(dbPath)) throw new Error("Falta el staging; ejecuta npm run construir primero");
    db = new DatabaseSync(dbPath);
    db.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
    const existing = fs.existsSync(progressPath) ? JSON.parse(fs.readFileSync(progressPath, "utf8")) : {};
    const compatible = "e.model=? AND e.dims=? AND length(e.vector)=e.dims*4";
    const pending = db.prepare(`SELECT c.id,c.content,d.title,d.weight FROM chunks c JOIN documents d ON d.id=c.document_id
      LEFT JOIN embeddings e ON e.chunk_id=c.id AND ${compatible}
      WHERE c.indexed=1 AND e.chunk_id IS NULL ORDER BY (d.weight>=1) DESC,d.weight DESC,d.id,c.ord LIMIT ?`);
    const totals = db.prepare(`SELECT COUNT(*) total,COUNT(e.chunk_id) done FROM chunks c
      LEFT JOIN embeddings e ON e.chunk_id=c.id AND ${compatible} WHERE c.indexed=1`);
    const counts = () => totals.get(MODEL, dims);
    if (counts().done < counts().total && limit > 0 && !apiKey) throw new Error("Falta GEMINI_API_KEY en .env.local o en el entorno");
    const insert = db.prepare(`INSERT INTO embeddings(chunk_id,model,dims,vector,created_at) VALUES (?,?,?,?,?)
      ON CONFLICT(chunk_id) DO UPDATE SET model=excluded.model,dims=excluded.dims,vector=excluded.vector,created_at=excluded.created_at`);
    await runEmbeddingQueue({
      dims, batchSize, limit, apiKey, signal: controller.signal, history: existing.solicitudes_recientes ?? [], counts,
      take: (n) => pending.all(MODEL, dims, n),
      commit: (rows, vectors, createdAt) => {
        db.exec("BEGIN IMMEDIATE");
        try {
          rows.forEach((row, i) => insert.run(row.id, MODEL, dims, vectors[i], createdAt));
          db.exec("COMMIT");
        } catch (error) { db.exec("ROLLBACK"); throw error; }
      },
      persist: (value) => { lastProgress = value; writeJson(progressPath, value); },
      request: (url, options) => fetch(url, { ...options, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(90_000)]) }),
      wait: async (ms, signal) => { try { await delay(ms, undefined, { signal }); } catch (error) { if (!signal.aborted) throw error; } },
    });
  } catch (error) {
    if (lastProgress) writeJson(progressPath, { ...lastProgress, estado: "error", ultimo_error: error.message, updated_at: new Date().toISOString() });
    throw error;
  } finally {
    db?.close();
    process.off("SIGINT", interrupt); process.off("SIGTERM", interrupt);
    release();
  }
}

if (isMain(import.meta.url)) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
