import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { postgresEstimate } from "./lib/biblioteca-core.mjs";
import { STAGING, DOCUMENT_COLUMNS, acquireLock, assertWritable, isMain, writeJson, recoverPublication } from "./lib/biblioteca-io.mjs";

const mb = (n) => (n / 1e6).toFixed(2);
const pct = (n, capacity) => (n / capacity * 100).toFixed(2);
const cell = (s) => String(s).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");

export function measureLibrary(destination = STAGING) {
  const release = acquireLock(path.dirname(destination));
  let db;
  try {
    recoverPublication(destination);
    const build = JSON.parse(fs.readFileSync(path.join(destination, "construccion.json"), "utf8"));
    db = new DatabaseSync(path.join(destination, "biblioteca.db"), { readOnly: true });
    const groups = db.prepare(`SELECT CASE WHEN d.weight>=1 THEN 'principal' ELSE 'masivas' END collection,
      COUNT(*) total, SUM(c.indexed) AS "indexed", SUM(CASE WHEN c.indexed=1 THEN length(CAST(c.content AS BLOB)) ELSE 0 END) bytes
      FROM chunks c JOIN documents d ON d.id=c.document_id GROUP BY collection`).all();
    const stats = db.prepare(`SELECT COUNT(*) count, COALESCE(SUM(length(CAST(content AS BLOB))),0) textBytes,
      COALESCE(SUM(length(CAST(heading AS BLOB))+length(CAST(section AS BLOB))+length(CAST(content_hash AS BLOB))),0) metadataBytes,
      COALESCE(MAX(length(CAST(content AS BLOB))),0) maxTextBytes,
      SUM(CASE WHEN length(CAST(content AS BLOB))>=2000 THEN 1 ELSE 0 END) over2k,
      SUM(CASE WHEN length(CAST(content||heading||section||content_hash AS BLOB))+96>=2000 THEN 1 ELSE 0 END) rowsOver2k
      FROM chunks WHERE indexed=1`).get();
    let catalogBytes = 0;
    let catalogRows = 0;
    for (const [table, columns] of [["documents", DOCUMENT_COLUMNS], ["categories", ["name", "slug", "description", "keywords"]], ["document_categories", []]]) {
      for (const row of db.prepare(`SELECT * FROM ${table}`).iterate()) {
        catalogRows++;
        for (const col of columns) if (typeof row[col] === "string") catalogBytes += Buffer.byteLength(row[col]);
      }
    }
    const input = { ...stats, catalogBytes, catalogRows };
    const estimates = [384, 256].map((dims) => postgresEstimate(input, dims));
    const files = fs.readdirSync(path.join(destination, "textos")).filter((f) => f.endsWith(".json"));
    const jsonBytes = files.reduce((sum, file) => sum + fs.statSync(path.join(destination, "textos", file)).size, 0);
    const storageBytes = jsonBytes + build.original_files_bytes;
    const embeddings = db.prepare("SELECT model,dims,COUNT(*) count FROM embeddings GROUP BY model,dims").all();
    const sections = db.prepare('SELECT section,COUNT(*) total,SUM(indexed) AS "indexed" FROM chunks GROUP BY section ORDER BY total DESC').all();
    const beforeCount = build.baseline.reduce((n, row) => n + row.chunks, 0);
    const total = groups.reduce((n, row) => n + row.total, 0);
    const lines = ["# Informe de biblioteca nueva", "", `Generado: ${new Date().toISOString()}. Reglas v${build.rules_version}.`, "",
      `Documentos: **${build.documents} fichas; ${build.processed} procesados; ${build.failures.length} fallidos**.`, "",
      "## Fragmentos", "", "| Colección | Base vieja | Reextraídos completos (visor) | Indexados (Postgres) | Texto indexado MB |", "| --- | ---: | ---: | ---: | ---: |"];
    for (const name of ["principal", "masivas"]) {
      const old = build.baseline.find((r) => r.collection === name);
      const row = groups.find((r) => r.collection === name) ?? { total: 0, indexed: 0, bytes: 0 };
      lines.push(`| ${name} | ${old?.chunks ?? 0} | ${row.total} | ${row.indexed} | ${mb(row.bytes)} |`);
    }
    lines.push(`| **Total** | **${beforeCount}** | **${total}** | **${stats.count}** | **${mb(stats.textBytes)}** |`, "",
      `Reducción frente a los fragmentos antiguos: ${pct(beforeCount - stats.count, beforeCount)} %. Excluidos del nuevo índice: ${total - stats.count}.`, "",
      "## Exclusiones", "", "Una sola regla por fragmento, en orden: sección excluida, solo encabezado, menos de 80 letras/dígitos, duplicado local/global. No se borran del visor.", "",
      "| Regla | Fragmentos |", "| --- | ---: |");
    for (const [rule, count] of Object.entries(build.exclusions).sort((a, b) => b[1] - a[1])) lines.push(`| ${rule} | ${count} |`);
    lines.push("", "## Secciones", "", "| Sección | Completos | Indexados |", "| --- | ---: | ---: |");
    for (const row of sections) lines.push(`| ${row.section} | ${row.total} | ${row.indexed} |`);
    lines.push("", "## Estimación de Postgres", "",
      "MB decimales (1 MB = 1.000.000 bytes), límite de 500 MB. Solo indexed=1 y todas las fichas/categorías. Sin compresión TOAST ni índice HNSW. No es el tamaño de SQLite ni una medición de un servidor Postgres.", "",
      `Máximo UTF-8 por fragmento: ${stats.maxTextBytes} bytes; ${stats.over2k ?? 0} fragmentos con texto ≥ 2.000 bytes. Con metadatos y 96 B de overhead, ${stats.rowsOver2k ?? 0} filas podrían superar 2.000 bytes. Se cuenta todo sin descontar compresión TOAST.`, "",
      "Modelo explícito: texto UTF-8 + encabezado/sección/hash reales + 96 B/fila de chunks; 96 B/fila de índices B-tree; fichas y categorías reales + 160 B/fila; GIN de expresión to_tsvector('spanish', ...) en 40–60 % del texto, sin columna tsvector adicional; embeddings separados halfvec(d) con 2×d + 128 B/fila (vector, modelo, fecha, PK); reserva de páginas/alineación 10 % sobre el subtotal. No se cuenta el BLOB float32 de SQLite como halfvec.", "",
      "| Componente (MB) | 384 dimensiones | 256 dimensiones |", "| --- | ---: | ---: |");
    for (const [label, key] of [["Chunks: texto, metadatos y filas", "heap"], ["B-tree chunks", "btree"], ["Fichas y categorías", "catalogs"], ["halfvec + filas/PK embeddings", "vectors"]]) {
      lines.push(`| ${label} | ${mb(estimates[0][key])} | ${mb(estimates[1][key])} |`);
    }
    lines.push(`| GIN español (40–60 %) | ${mb(estimates[0].ginLow)}–${mb(estimates[0].ginHigh)} | ${mb(estimates[1].ginLow)}–${mb(estimates[1].ginHigh)} |`);
    lines.push(`| **Total con reserva 10 %** | **${mb(estimates[0].low)}–${mb(estimates[0].high)}** | **${mb(estimates[1].low)}–${mb(estimates[1].high)}** |`);
    lines.push(`| **% de 500 MB** | **${estimates[0].percentLow.toFixed(2)}–${estimates[0].percentHigh.toFixed(2)} %** | **${estimates[1].percentLow.toFixed(2)}–${estimates[1].percentHigh.toFixed(2)} %** |`, "",
      `Escenario alternativo con columna tsvector almacenada (reserva adicional de 60 % del texto, más 10 % de páginas): 384 dimensiones **${mb(estimates[0].withStoredTsvectorLow)}–${mb(estimates[0].withStoredTsvectorHigh)} MB**; 256 dimensiones **${mb(estimates[1].withStoredTsvectorLow)}–${mb(estimates[1].withStoredTsvectorHigh)} MB**.`, "",
      "La ocupación real variará por distribución de lexemas, páginas e índices. El límite también debe dejar espacio para otras tablas, extensiones y crecimiento del proyecto.", "",
      "## Storage", "", `- ${files.length} textos JSON completos: **${mb(jsonBytes)} MB**.`,
      `- ${build.original_files_count} archivos originales únicos existentes: **${mb(build.original_files_bytes)} MB** (bytes reales, sin copiarlos).`,
      `- Total: **${mb(storageBytes)} MB; ${pct(storageBytes, 1e9)} % de 1 GB**. Sin compresión. Los originales faltantes no se cuentan.`, "",
      "## Integridad y embeddings", "", `- SHA-256 antes: \`${build.sha256_before}\`.`, `- SHA-256 después: \`${build.sha256_after}\`.`,
      `- Base original abierta con { readOnly: true }; no se ejecutan checkpoints ni escrituras sobre su WAL.`,
      `- Vectores conservados por hash en esta construcción: ${build.restored_embeddings}.`,
      `- Vectores actuales: ${embeddings.length ? embeddings.map((e) => `${e.count} (${e.model}, ${e.dims} dimensiones)`).join("; ") : "0; Gemini no se ha ejecutado"}.`, "",
      "## Archivos fallidos", "");
    if (!build.failures.length) lines.push("Ninguno.");
    else {
      lines.push("| ID | Título | Archivo | Error |", "| --- | --- | --- | --- |");
      for (const failure of build.failures) lines.push(`| ${failure.id} | ${cell(failure.title)} | ${cell(failure.file_path)} | ${cell(failure.error)} |`);
    }
    const report = lines.join("\n") + "\n";
    fs.writeFileSync(assertWritable(path.join(destination, "informe.md")), report);
    writeJson(path.join(destination, "medicion.json"), { input, estimates, groups, sections, jsonBytes, storageBytes, embeddings });
    return report;
  } finally { db?.close(); release(); }
}

if (isMain(import.meta.url)) {
  try { console.log(measureLibrary()); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
