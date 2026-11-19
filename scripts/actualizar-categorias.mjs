// Sincroniza las palabras clave y subcategorías de src/lib/seed-categories.ts con la base
// (sin borrar categorías creadas a mano) y asigna subcategorías a todos los documentos.
// Uso (desde la carpeta raizia):  node scripts/actualizar-categorias.mjs
import path from "node:path";
import { registerHooks } from "node:module";

process.chdir(path.resolve(import.meta.dirname, ".."));
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

const { all, get, run, tx } = await import("../src/lib/db.ts");
const { SEED_CATEGORIES } = await import("../src/lib/seed-categories.ts");
const { assignSubcategories, createCategory } = await import("../src/lib/documents.ts");

let nuevas = 0, actualizadas = 0;
for (const c of SEED_CATEGORIES) {
  const root = get("SELECT id FROM categories WHERE slug = ?", c.slug);
  if (!root) continue;
  run("UPDATE categories SET keywords = ?, description = ? WHERE id = ?", c.keywords, c.description, root.id);
  for (const s of c.children) {
    const cur = get("SELECT id FROM categories WHERE parent_id = ? AND name = ?", root.id, s.name);
    if (cur) {
      run("UPDATE categories SET keywords = ? WHERE id = ?", s.keywords ?? "", cur.id);
      actualizadas++;
    } else {
      createCategory({ name: s.name, parentId: root.id, keywords: s.keywords ?? "" });
      nuevas++;
    }
  }
}
console.log(`Subcategorías: ${actualizadas} actualizadas, ${nuevas} nuevas.`);

const ids = all("SELECT id FROM documents").map((r) => r.id);
let asignaciones = 0;
tx(() => {
  for (const id of ids) asignaciones += assignSubcategories(id);
});
console.log(`Documentos revisados: ${ids.length}. Subcategorías añadidas: ${asignaciones}.\n`);

const rows = all(`SELECT p.name AS cat, c.name AS sub,
  (SELECT COUNT(*) FROM document_categories dc JOIN documents d ON d.id = dc.document_id
    WHERE dc.category_id = c.id AND d.status = 'aprobado') AS n
  FROM categories c JOIN categories p ON p.id = c.parent_id ORDER BY p.sort, c.sort`);
for (const r of rows) console.log(`${String(r.n).padStart(5)}  ${r.cat} › ${r.sub}`);
