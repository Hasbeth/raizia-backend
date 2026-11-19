// Importa a la biblioteca de RAIZIA, ya aprobadas, las sentencias descargadas por el
// Vigía de Sentencias (../vigia-sentencias). Sin IA ni tokens y sin re-descargar nada:
// lee las copias locales y usa el mismo proceso de extracción e indexación de la app.
//
// Uso (desde la carpeta raizia, con la aplicación CERRADA):
//   node scripts/importar-vigia.mjs              importa todo lo relevante que aún no esté
//   node scripts/importar-vigia.mjs --max 20     prueba con 20
import fs from "node:fs";
import path from "node:path";
import { registerHooks } from "node:module";

const RAIZ = path.resolve(import.meta.dirname, "..");
const VIGIA = path.resolve(RAIZ, "..", "vigia-sentencias");
process.chdir(RAIZ); // db.ts ubica data/ a partir de la carpeta actual

// Resuelve el alias "@/" y los imports sin extensión del código TypeScript de src/
// (Node 26 ejecuta TypeScript directamente eliminando los tipos).
const src = new URL("../src/", import.meta.url);
registerHooks({
  resolve(spec, ctx, next) {
    let target;
    if (spec.startsWith("@/")) target = new URL(spec.slice(2), src);
    else if (spec.startsWith(".") && ctx.parentURL?.startsWith(src.href)) target = new URL(spec, ctx.parentURL);
    if (target && !path.extname(target.pathname)) target.pathname += ".ts";
    return target ? next(target.href, ctx) : next(spec, ctx);
  },
});

const { all, get, DB_PATH } = await import("../src/lib/db.ts");
const { createDocument } = await import("../src/lib/documents.ts");

const args = process.argv.slice(2);
const MAX = args.includes("--max") ? Number(args[args.indexOf("--max") + 1]) : Infinity;

// Respaldo de la base antes de tocarla.
const respaldo = path.join(path.dirname(DB_PATH), `respaldo-antes-vigia-${new Date().toISOString().slice(0, 10)}`);
if (!fs.existsSync(respaldo)) {
  fs.mkdirSync(respaldo, { recursive: true });
  for (const f of ["raizia.db", "raizia.db-wal", "raizia.db-shm"]) {
    const p = path.join(path.dirname(DB_PATH), f);
    if (fs.existsSync(p)) fs.copyFileSync(p, path.join(respaldo, f));
  }
  console.log(`Respaldo de la base en ${respaldo}`);
}

// Temas del Vigía → categorías de RAIZIA (por nombre).
const MAPA = {
  "Consulta previa": "Consulta previa",
  "Territorio y tierras": "Resguardos y titulación",
  "Jurisdicción especial indígena": "Jurisdicción especial indígena",
  "Autonomía y gobierno propio": "Cabildos y autoridades",
  Salud: "Salud propia e intercultural",
  "Educación": "Educación propia e intercultural",
  "Agua, alimentación y niñez": "Derechos fundamentales",
  "Ambiente, minería y megaproyectos": "Recursos naturales",
  "Conflicto armado y desplazamiento": "Víctimas y desplazamiento",
  "Identidad y diversidad cultural": "Derechos culturales",
  "Mujeres indígenas": "Igualdad y no discriminación",
  "Participación política": "Participación",
  "Trabajo y seguridad social": "Derechos fundamentales",
  "Reconocimiento de comunidades": "Derechos colectivos y autonomía",
};
const catId = (nombre) => get("SELECT id FROM categories WHERE name = ? ORDER BY parent_id IS NULL LIMIT 1", nombre)?.id;
const catTipo = (s) =>
  /^SU/.test(s) ? "Sentencias de unificación (SU)" : /^T-/.test(s) ? "Sentencias de tutela (T)" : /^C-/.test(s) ? "Sentencias de constitucionalidad (C)" : "Autos de seguimiento";
const PESO = { "Muy importante": 0.9, Importante: 0.75, Relevante: 0.6 }; // < 1 = importada en bloque

const estado = JSON.parse(fs.readFileSync(path.join(VIGIA, "datos", "estado.json"), "utf8"));
const yaEstan = new Set(all("SELECT official_url AS u FROM documents").map((r) => r.u));
const lista = Object.values(estado.sentencias)
  .filter((s) => s.relevante && s.archivo && s.url && !yaEstan.has(s.url))
  .sort((a, b) => b.puntaje - a.puntaje)
  .slice(0, MAX);

console.log(`\nImportando ${lista.length} sentencias a RAIZIA (aprobadas, visibles en la biblioteca)…\n`);
const t0 = Date.now();
const tot = { importado: 0, duplicado: 0, error: 0 };
for (const [i, s] of lista.entries()) {
  try {
    const nombre = s.sentencia.replace(/^A\.\s*/, "Auto ").replace(/^SU\./, "SU-");
    const esAuto = /^A/.test(s.sentencia);
    const r = await createDocument({
      buffer: fs.readFileSync(path.join(VIGIA, s.archivo)),
      fileName: path.basename(s.archivo),
      mime: "text/html",
      charsetHint: "text/html; charset=windows-1252",
      sourceKind: "url",
      meta: {
        title: `${esAuto ? "" : "Sentencia "}${nombre}${s.tema ? ` — ${s.tema.slice(0, 180).toLowerCase()}` : ""}`,
        entity: "Corte Constitucional",
        docType: esAuto ? "Auto" : "Sentencia",
        docDate: s.fecha || String(s.anio || ""),
        officialUrl: s.url,
        summary: s.sintesis.replace(/\s+/g, " ").slice(0, 900),
        status: "aprobado",
        reviewNote: `Importada por Vigía de Sentencias (${s.nivel}, puntaje ${s.puntaje}). Clasificación automática por palabras clave.`,
        categoryIds: [...new Set([...s.temas.slice(0, 3).map((t) => catId(MAPA[t])), catId(catTipo(s.sentencia))].filter(Boolean))],
        weight: PESO[s.nivel] ?? 0.6,
      },
    });
    tot[r.duplicate ? "duplicado" : "importado"]++;
  } catch (e) {
    tot.error++;
    console.log(`\n  ✖ ${s.sentencia}: ${e.message}`);
  }
  const h = i + 1, pct = Math.round((h / lista.length) * 100);
  const falta = Math.ceil((((Date.now() - t0) / h) * (lista.length - h)) / 60000);
  process.stdout.write(`  [${"█".repeat(pct / 5 | 0)}${"░".repeat(20 - (pct / 5 | 0))}] ${pct}% (${h}/${lista.length}) · faltan ~${falta} min   \r`);
}
console.log(`\n\nListo en ${Math.round((Date.now() - t0) / 1000)} s: ${tot.importado} importadas, ${tot.duplicado} ya existían, ${tot.error} con error.`);
const n = get("SELECT COUNT(*) AS n FROM documents WHERE status = 'aprobado'").n;
console.log(`Documentos aprobados en la biblioteca: ${n}\n`);
