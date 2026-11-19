// Descarga UNA VEZ las fuentes oficiales de la colección (Constitución, códigos, leyes, decretos
// y sentencias base), verifica que cada texto corresponda a la norma esperada y las guarda en
// RAIZIA como archivos locales. Después RAIZIA no necesita esas páginas para funcionar.
//
// Uso (desde la carpeta raizia, con la aplicación CERRADA):  node scripts/importar-normas.mjs
// Es seguro repetirlo: omite lo que ya está cargado.
import fs from "node:fs";
import path from "node:path";
import { registerHooks } from "node:module";

const RAIZ = path.resolve(import.meta.dirname, "..");
process.chdir(RAIZ);
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

const { get, DB_PATH } = await import("../src/lib/db.ts");
const { seedOfficialSources, SEED_SOURCES, MULTIPART_SOURCES } = await import("../src/lib/seed.ts");
const { SEED_NORMAS } = await import("../src/lib/seed-normas.ts");

const respaldo = path.join(path.dirname(DB_PATH), `respaldo-antes-normas-${new Date().toISOString().slice(0, 10)}`);
if (!fs.existsSync(respaldo)) {
  fs.mkdirSync(respaldo, { recursive: true });
  for (const f of ["raizia.db", "raizia.db-wal", "raizia.db-shm"]) {
    const p = path.join(path.dirname(DB_PATH), f);
    if (fs.existsSync(p)) fs.copyFileSync(p, path.join(respaldo, f));
  }
  console.log(`Respaldo de la base en ${respaldo}`);
}

const total = SEED_SOURCES.length + SEED_NORMAS.length + MULTIPART_SOURCES.length;
const marks = { importado: "✔ importado ", ya_existe: "• ya existe ", omitido: "– omitido   ", error: "✖ error     " };
const tot = {};
let n = 0;
const t0 = Date.now();
console.log(`\nRevisando ${total} fuentes oficiales…\n`);
for await (const ev of seedOfficialSources()) {
  n++;
  tot[ev.outcome] = (tot[ev.outcome] || 0) + 1;
  const pct = Math.round((n / total) * 100);
  const falta = Math.ceil((((Date.now() - t0) / n) * (total - n)) / 60000);
  console.log(`${String(pct).padStart(3)}% ${marks[ev.outcome] || ev.outcome} ${ev.title}${ev.detail ? `  (${ev.detail})` : ""}  · faltan ~${falta} min`);
}
console.log("\nResumen:", Object.entries(tot).map(([k, v]) => `${v} ${k}`).join(", "));
console.log(`Documentos aprobados en la biblioteca: ${get("SELECT COUNT(*) AS n FROM documents WHERE status = 'aprobado'").n}\n`);
