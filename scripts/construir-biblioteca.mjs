import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { detectKind, extractText } from "../src/lib/ingest.ts";
import { fragmentDocument, selectChunks, headingKey, RULES_VERSION } from "./lib/biblioteca-core.mjs";
import { DOCUMENT_COLUMNS, SCHEMA, SOURCE, STAGING, assertWritable, acquireLock, recoverPublication, publishDirectory, sha256, writeJson, isMain } from "./lib/biblioteca-io.mjs";

function analyzeSource(db) {
  const headings = db.prepare(`SELECT c.heading, COUNT(*) AS fragments, COUNT(DISTINCT document_id) AS documents
    FROM chunks c JOIN documents d ON d.id=c.document_id WHERE d.weight<1 GROUP BY c.heading ORDER BY fragments DESC, c.heading`).all();
  const lines = new Map();
  for (const row of db.prepare("SELECT c.content FROM chunks c JOIN documents d ON d.id=c.document_id WHERE d.weight<1").iterate()) {
    for (const line of row.content.split("\n")) {
      const key = headingKey(line);
      if (line.length < 180 && /^(?:antecedentes|hechos|consideraciones|fundamentos|resuelve|decision|sintesis|problema juridico|intervenci|concepto|pruebas|tramite|actuaci|salvamento|aclaracion|nota de relator|tabla de contenido|indice)/.test(key)) {
        lines.set(key, (lines.get(key) ?? 0) + 1);
      }
    }
  }
  return { note: "Frecuencias observadas antes de reconstruir; las líneas candidatas pueden incluir prosa y no se excluyen solo por aparecer aquí.", headings,
    lines: [...lines].map(([heading, occurrences]) => ({ heading, occurrences })).sort((a, b) => b.occurrences - a.occurrences || a.heading.localeCompare(b.heading)) };
}

function copyCards(source, target) {
  for (const [table, columns] of [
    ["categories", ["id", "parent_id", "name", "slug", "description", "keywords", "sort"]],
    ["documents", DOCUMENT_COLUMNS], ["document_categories", ["document_id", "category_id"]],
  ]) {
    const names = columns.join(",");
    const insert = target.prepare(`INSERT INTO ${table} (${names}) VALUES (${columns.map(() => "?").join(",")})`);
    for (const row of source.prepare(`SELECT ${names} FROM ${table}`).iterate()) insert.run(...columns.map((column) => row[column]));
  }
}

export async function buildLibrary({ sourceDir = SOURCE, destination = STAGING, log = console.log } = {}) {
  assertWritable(destination);
  const release = acquireLock(path.dirname(destination));
  const next = assertWritable(`${destination}.next`);
  let source;
  let previous;
  let target;
  let transaction = false;
  let stop = false;
  const interrupt = () => { stop = true; };
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", interrupt);
  const sourcePath = path.join(sourceDir, "raizia.db");
  try {
    recoverPublication(destination);
    if (fs.existsSync(next)) fs.rmSync(next, { recursive: true });
    fs.mkdirSync(path.join(next, "textos"), { recursive: true });
    const before = await sha256(sourcePath);
    source = new DatabaseSync(sourcePath, { readOnly: true });
    source.exec("PRAGMA query_only=ON; BEGIN;"); // Snapshot consistente, WAL original solo leído.
    const baseline = source.prepare(`SELECT CASE WHEN d.weight>=1 THEN 'principal' ELSE 'masivas' END AS collection,
      COUNT(DISTINCT d.id) documents, COUNT(c.id) chunks, COALESCE(SUM(length(CAST(c.content AS BLOB))),0) bytes
      FROM documents d LEFT JOIN chunks c ON c.document_id=d.id GROUP BY collection`).all();
    log("Analizando frecuencias de encabezados de la base original (solo lectura)...");
    writeJson(path.join(next, "frecuencias-encabezados.json"), analyzeSource(source));
    const previousPath = path.join(destination, "biblioteca.db");
    let cached;
    if (fs.existsSync(previousPath)) {
      previous = new DatabaseSync(previousPath, { readOnly: true });
      cached = previous.prepare(`SELECT e.model,e.dims,e.vector,e.created_at FROM chunks c JOIN embeddings e ON e.chunk_id=c.id
        WHERE c.content_hash=? ORDER BY e.created_at DESC LIMIT 1`);
    }
    target = new DatabaseSync(path.join(next, "biblioteca.db"));
    target.exec(SCHEMA);
    target.exec("BEGIN IMMEDIATE");
    transaction = true;
    copyCards(source, target);
    const insertChunk = target.prepare("INSERT INTO chunks VALUES (?,?,?,?,?,?,?,?)");
    const insertVector = target.prepare("INSERT INTO embeddings VALUES (?,?,?,?,?)");
    const docs = source.prepare("SELECT * FROM documents ORDER BY (weight>=1) DESC, weight DESC, id").all();
    const seen = new Map();
    const originalFiles = new Map();
    const failures = [];
    const perDocument = [];
    const exclusions = {};
    let id = 0;
    let restored = 0;
    const started = Date.now();
    for (const [index, doc] of docs.entries()) {
      if (stop) throw new Error("Construcción interrumpida; el staging anterior permanece intacto");
      const bulk = doc.weight < 1;
      let selected = [];
      let fileBytes = 0;
      let failure = null;
      try {
        // Misma convención que documents.ts:getDocumentFile; nunca sigue rutas de la ficha fuera de files/.
        if (!doc.file_path) throw new Error("Ficha sin archivo original");
        const file = path.join(sourceDir, "files", path.basename(doc.file_path));
        const real = fs.realpathSync(file);
        const filesRoot = fs.realpathSync(path.join(sourceDir, "files"));
        const relative = path.relative(filesRoot, real);
        if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Archivo fuera de files/");
        fileBytes = fs.statSync(real).size;
        originalFiles.set(real, fileBytes);
        const kind = detectKind(doc.file_name || doc.file_path, doc.mime);
        if (!kind) throw new Error("Formato de archivo no soportado");
        const { text } = await extractText(fs.readFileSync(real), kind, doc.mime);
        if (!text.trim()) throw new Error("Extracción sin texto");
        selected = selectChunks(fragmentDocument(text, bulk), doc.id, bulk, seen);
      } catch (error) {
        failure = { id: doc.id, title: doc.title, file_path: doc.file_path, error: error.message };
        failures.push(failure);
      }
      // Errores de escritura/SQL son fatales: no confundirlos con una extracción fallida.
      fs.writeFileSync(path.join(next, "textos", `${doc.id}.json`), JSON.stringify({
        id: doc.id, title: doc.title, chunks: selected.map(({ ord, heading, content }) => ({ ord, heading, content })),
      }));
      for (const chunk of selected) {
        insertChunk.run(++id, doc.id, chunk.ord, chunk.heading, chunk.section, chunk.content, chunk.content_hash, chunk.indexed);
        if (chunk.reason) exclusions[chunk.reason] = (exclusions[chunk.reason] ?? 0) + 1;
        const embedding = cached?.get(chunk.content_hash);
        if (embedding) {
          insertVector.run(id, embedding.model, embedding.dims, embedding.vector, embedding.created_at);
          restored++;
        }
      }
      perDocument.push({ id: doc.id, collection: bulk ? "masivas" : "principal", processed: !failure,
        chunks: selected.length, indexed: selected.filter((c) => c.indexed).length, fileBytes });
      if ((index + 1) % 50 === 0 || index === docs.length - 1) {
        log(`${index + 1}/${docs.length} documentos; ${id} fragmentos completos; ${failures.length} fallidos; ${Math.round((Date.now() - started) / 1000)} s`);
      }
      // Permite recibir Ctrl-C incluso si todos los documentos son HTML.
      await new Promise((resolve) => setImmediate(resolve));
    }
    if (target.prepare("PRAGMA foreign_key_check").all().length) throw new Error("Referencias inválidas en staging");
    target.exec("COMMIT");
    transaction = false;
    target.close(); target = null;
    previous?.close(); previous = null;
    source.exec("ROLLBACK");
    source.close(); source = null;
    const after = await sha256(sourcePath);
    if (before !== after) throw new Error("El SHA-256 de la base vieja cambió durante la lectura; no se publica el staging");
    writeJson(path.join(next, "construccion.json"), {
      created_at: new Date().toISOString(), rules_version: RULES_VERSION, source: sourcePath,
      sha256_before: before, sha256_after: after, baseline, documents: docs.length,
      processed: docs.length - failures.length, failures, perDocument, exclusions,
      restored_embeddings: restored, original_files_count: originalFiles.size,
      original_files_bytes: [...originalFiles.values()].reduce((a, b) => a + b, 0),
    });
    if (stop) throw new Error("Construcción interrumpida antes de publicar");
    const priorProgress = path.join(destination, "progreso.json");
    if (fs.existsSync(priorProgress)) {
      const progress = JSON.parse(fs.readFileSync(priorProgress, "utf8"));
      writeJson(path.join(next, "progreso.json"), { estado: "reconstruido", solicitudes_recientes: progress.solicitudes_recientes ?? [] });
    }
    publishDirectory(next, destination);
    log(`Staging listo: ${docs.length - failures.length}/${docs.length} documentos; ${restored} vectores conservados por content_hash. SHA-256 original sin cambios: ${after}`);
  } finally {
    if (transaction) target?.exec("ROLLBACK");
    target?.close(); previous?.close(); source?.close();
    process.off("SIGINT", interrupt); process.off("SIGTERM", interrupt);
    release();
  }
}

if (isMain(import.meta.url)) {
  buildLibrary().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
