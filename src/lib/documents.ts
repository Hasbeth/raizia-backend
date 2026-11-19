/**
 * Repositorio documental: alta, clasificación, indexación, consulta y baja.
 * Toda la lógica de datos vive aquí para que las rutas y pantallas sean delgadas.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { all, FILES_DIR, get, run, slugify, tx } from "./db";
import { chunkText, detectKind, extractText, toUtf8Html } from "./ingest";
import { detectTopics, fold, queryTerms, searchDocumentsByContent } from "./search";
import { fetchOfficial } from "./fetcher";
import type { Category, CategoryNode, DocStatus, DocumentSummary } from "./constants";
import { MARK_OPEN, STATUSES } from "./constants";

type DocRow = {
  id: number;
  title: string;
  entity: string;
  doc_type: string;
  doc_date: string;
  official_url: string;
  summary: string;
  status: DocStatus;
  file_name: string;
  file_path: string;
  mime: string;
  file_size: number;
  source_kind: "upload" | "url";
  content_hash: string;
  text_chars: number;
  review_note: string;
  created_at: string;
  updated_at: string;
  chunk_count: number;
};

const DOC_SELECT = `SELECT d.*, (SELECT COUNT(*) FROM chunks c WHERE c.document_id = d.id) AS chunk_count FROM documents d`;

function mapDocs(rows: DocRow[]): DocumentSummary[] {
  if (!rows.length) return [];
  const cats = all<{ document_id: number; id: number; name: string; parent_id: number | null }>(
    `SELECT dc.document_id, c.id, c.name, c.parent_id
       FROM document_categories dc JOIN categories c ON c.id = dc.category_id
      ORDER BY c.parent_id IS NOT NULL, c.sort`,
  );
  const byDoc = new Map<number, DocumentSummary["categories"]>();
  for (const c of cats) {
    const list = byDoc.get(c.document_id) || [];
    list.push({ id: c.id, name: c.name, parentId: c.parent_id });
    byDoc.set(c.document_id, list);
  }
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    entity: r.entity,
    docType: r.doc_type,
    docDate: r.doc_date,
    officialUrl: r.official_url,
    summary: r.summary,
    status: r.status,
    fileName: r.file_name,
    mime: r.mime,
    fileSize: r.file_size,
    sourceKind: r.source_kind,
    textChars: r.text_chars,
    chunkCount: r.chunk_count,
    reviewNote: r.review_note,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    categories: byDoc.get(r.id) || [],
  }));
}

/* ----------------------------- Consulta ----------------------------- */

export type ListOptions = {
  q?: string;
  categoryId?: number;
  docType?: string;
  entity?: string;
  status?: DocStatus;
  /** true = solo documentos aprobados (vista pública). */
  publicOnly?: boolean;
};

export function listDocuments(opts: ListOptions = {}): DocumentSummary[] {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (opts.publicOnly) where.push("d.status = 'aprobado'");
  else if (opts.status) {
    where.push("d.status = ?");
    params.push(opts.status);
  }
  if (opts.categoryId) {
    where.push(
      `d.id IN (SELECT dc.document_id FROM document_categories dc JOIN categories c ON c.id = dc.category_id
                 WHERE c.id = ? OR c.parent_id = ?)`,
    );
    params.push(opts.categoryId, opts.categoryId);
  }
  if (opts.docType) {
    where.push("d.doc_type = ?");
    params.push(opts.docType);
  }
  if (opts.entity) {
    where.push("d.entity = ?");
    params.push(opts.entity);
  }
  const sql = `${DOC_SELECT} ${where.length ? "WHERE " + where.join(" AND ") : ""}
               ORDER BY ${
                 opts.publicOnly
                   ? `CASE d.doc_type WHEN 'Constitución' THEN 0 WHEN 'Ley' THEN 1 WHEN 'Decreto' THEN 2
                        WHEN 'Sentencia' THEN 3 WHEN 'Auto' THEN 5 ELSE 4 END,
                      d.weight DESC, d.doc_date DESC, d.title COLLATE NOCASE`
                   : "d.created_at DESC, d.id DESC"
               }`;
  let docs = mapDocs(all<DocRow>(sql, ...params));

  const q = (opts.q || "").trim();
  if (q) {
    const terms = queryTerms(q);
    const words = terms.length ? terms : [fold(q)];
    const content = searchDocumentsByContent(q, !!opts.publicOnly);
    const ranked: { doc: DocumentSummary; order: number }[] = [];
    for (const doc of docs) {
      const meta = fold(
        `${doc.title} ${doc.entity} ${doc.docType} ${doc.categories.map((c) => c.name).join(" ")}`,
      );
      const metaMatch = words.every((w) => meta.includes(w));
      const hit = content.get(doc.id);
      if (!metaMatch && !hit) continue;
      ranked.push({
        doc: { ...doc, snippet: hit?.snippet.includes(MARK_OPEN) ? hit.snippet : undefined },
        order: (metaMatch ? -1000 : 0) + (hit?.rank ?? 0),
      });
    }
    ranked.sort((a, b) => a.order - b.order);
    docs = ranked.map((r) => r.doc);
  }
  return docs;
}

export function getDocument(id: number, publicOnly = false): DocumentSummary | null {
  const row = get<DocRow>(
    `${DOC_SELECT} WHERE d.id = ? ${publicOnly ? "AND d.status = 'aprobado'" : ""}`,
    id,
  );
  return row ? mapDocs([row])[0] : null;
}

export function getDocumentChunks(id: number): { id: number; heading: string; content: string }[] {
  return all("SELECT id, heading, content FROM chunks WHERE document_id = ? ORDER BY ord", id);
}

export function getDocumentFile(id: number): { absPath: string; fileName: string; mime: string } | null {
  const row = get<{ file_path: string; file_name: string; mime: string }>(
    "SELECT file_path, file_name, mime FROM documents WHERE id = ?",
    id,
  );
  if (!row?.file_path) return null;
  const absPath = path.join(FILES_DIR, path.basename(row.file_path));
  if (!fs.existsSync(absPath)) return null;
  return { absPath, fileName: row.file_name, mime: row.mime };
}

export function listFacets(publicOnly: boolean): { entities: string[]; docTypes: string[] } {
  const w = publicOnly ? "WHERE status = 'aprobado'" : "";
  const entities = all<{ v: string }>(
    `SELECT DISTINCT entity AS v FROM documents ${w} ORDER BY entity COLLATE NOCASE`,
  );
  const docTypes = all<{ v: string }>(
    `SELECT DISTINCT doc_type AS v FROM documents ${w} ORDER BY doc_type COLLATE NOCASE`,
  );
  return {
    entities: entities.map((e) => e.v).filter(Boolean),
    docTypes: docTypes.map((e) => e.v).filter(Boolean),
  };
}

export function getStats() {
  const s = get<{ approved: number; total: number; pending: number }>(
    `SELECT SUM(status = 'aprobado') AS approved, COUNT(*) AS total,
            SUM(status != 'aprobado') AS pending FROM documents`,
  )!;
  const chunks = get<{ n: number }>(
    "SELECT COUNT(*) AS n FROM chunks c JOIN documents d ON d.id = c.document_id WHERE d.status = 'aprobado'",
  )!;
  const cats = get<{ n: number }>("SELECT COUNT(*) AS n FROM categories WHERE parent_id IS NULL")!;
  return {
    approved: s.approved || 0,
    total: s.total || 0,
    pending: s.pending || 0,
    chunks: chunks.n,
    categories: cats.n,
  };
}

/* ---------------------------- Categorías ---------------------------- */

export function listCategories(publicOnly = false): Category[] {
  const rows = all<{
    id: number;
    parent_id: number | null;
    name: string;
    slug: string;
    description: string;
    keywords: string;
    sort: number;
  }>("SELECT * FROM categories ORDER BY parent_id IS NOT NULL, sort, name");
  const links = all<{ document_id: number; category_id: number }>(
    `SELECT dc.document_id, dc.category_id FROM document_categories dc
       JOIN documents d ON d.id = dc.document_id ${publicOnly ? "WHERE d.status = 'aprobado'" : ""}`,
  );
  const sets = new Map<number, Set<number>>();
  const parentOf = new Map(rows.map((r) => [r.id, r.parent_id]));
  for (const l of links) {
    for (const cid of [l.category_id, parentOf.get(l.category_id)]) {
      if (!cid) continue;
      if (!sets.has(cid)) sets.set(cid, new Set());
      sets.get(cid)!.add(l.document_id);
    }
  }
  return rows.map((r) => ({
    id: r.id,
    parentId: r.parent_id,
    name: r.name,
    slug: r.slug,
    description: r.description,
    keywords: r.keywords,
    sort: r.sort,
    docCount: sets.get(r.id)?.size || 0,
  }));
}

export function categoryTree(publicOnly = false): CategoryNode[] {
  const cats = listCategories(publicOnly);
  return cats
    .filter((c) => c.parentId === null)
    .map((c) => ({ ...c, children: cats.filter((s) => s.parentId === c.id) }));
}

export function createCategory(input: {
  name: string;
  parentId?: number | null;
  description?: string;
  keywords?: string;
}): Category {
  const name = input.name.trim();
  if (!name) throw new Error("El nombre de la categoría es obligatorio.");
  const parentId = input.parentId || null;
  if (parentId) {
    const parent = get<{ parent_id: number | null }>("SELECT parent_id FROM categories WHERE id = ?", parentId);
    if (!parent) throw new Error("La categoría principal no existe.");
    if (parent.parent_id) throw new Error("Solo se admiten dos niveles: categoría y subcategoría.");
  }
  let slug = slugify(name) || "categoria";
  if (parentId) slug = `${parentId}--${slug}`;
  let n = 1;
  const base = slug;
  while (get("SELECT 1 AS x FROM categories WHERE slug = ?", slug)) slug = `${base}-${++n}`;
  const max = get<{ m: number | null }>(
    "SELECT MAX(sort) AS m FROM categories WHERE parent_id IS ?",
    parentId,
  );
  const r = run(
    "INSERT INTO categories (parent_id, name, slug, description, keywords, sort) VALUES (?, ?, ?, ?, ?, ?)",
    parentId,
    name,
    slug,
    input.description?.trim() || "",
    input.keywords?.trim() || "",
    (max?.m || 0) + 1,
  );
  return listCategories().find((c) => c.id === Number(r.lastInsertRowid))!;
}

export function updateCategory(
  id: number,
  patch: { name?: string; description?: string; keywords?: string },
): Category | null {
  const cur = get<{ name: string; description: string; keywords: string }>(
    "SELECT name, description, keywords FROM categories WHERE id = ?",
    id,
  );
  if (!cur) return null;
  const name = patch.name?.trim() || cur.name;
  run(
    "UPDATE categories SET name = ?, description = ?, keywords = ? WHERE id = ?",
    name,
    patch.description?.trim() ?? cur.description,
    patch.keywords?.trim() ?? cur.keywords,
    id,
  );
  return listCategories().find((c) => c.id === id) || null;
}

/** Elimina la categoría y sus subcategorías. Los documentos se conservan. */
export function deleteCategory(id: number): boolean {
  return run("DELETE FROM categories WHERE id = ?", id).changes > 0;
}

/* ------------------------- Alta e indexación ------------------------ */

export type DocumentMeta = {
  title?: string;
  entity?: string;
  docType?: string;
  docDate?: string;
  officialUrl?: string;
  summary?: string;
  status?: DocStatus;
  reviewNote?: string;
  categoryIds?: number[];
  /** Peso en la búsqueda del asistente (1 = normal; menor = aparece después). */
  weight?: number;
};

export type CreateResult = { document: DocumentSummary; duplicate: boolean; warning?: string };

function guessMeta(title: string, text: string, url: string): Required<Pick<DocumentMeta, "title" | "entity" | "docType" | "docDate">> {
  const head = `${title}\n${text.slice(0, 1500)}`;
  let docType = "Otro";
  let entity = "";
  let docDate = "";
  let host = "";
  try {
    host = url ? new URL(url).hostname : "";
  } catch {
    /* sin URL */
  }
  const sent = /\b(?:Sentencia\s+)?(SU|T|C)[-\s]?(\d{1,4})(?:\/|\s+de\s+)(\d{2,4})\b/i.exec(head);
  const auto = /\bAuto\s+(?:No\.\s*)?(\d{1,4})(?:\/|\s+de\s+)(\d{2,4})\b/i.exec(head);
  const ley = /\bLEY\s+(?:ESTATUTARIA\s+)?(\d{1,4})\s+DE\s+(\d{4})\b/i.exec(head);
  const dec = /\bDECRETO\s+(?:LEY\s+|[ÚU]NICO\s+REGLAMENTARIO\s+)?(\d{1,4})\s+DE\s+(\d{4})\b/i.exec(head);
  const year = (y: string) => (y.length === 2 ? (Number(y) > 80 ? "19" : "20") + y : y);

  if (/constituci[óo]n pol[íi]tica/i.test(title)) {
    docType = "Constitución";
    entity = "Asamblea Nacional Constituyente";
    docDate = "1991";
  } else if (host.includes("corteconstitucional") && sent) {
    docType = "Sentencia";
    entity = "Corte Constitucional";
    docDate = year(sent[3]);
  } else if (host.includes("corteconstitucional") && auto) {
    docType = "Auto";
    entity = "Corte Constitucional";
    docDate = year(auto[2]);
  } else if (ley && (!dec || ley.index <= dec.index)) {
    docType = "Ley";
    entity = "Congreso de la República";
    docDate = ley[2];
  } else if (dec) {
    docType = "Decreto";
    entity = "Presidencia de la República";
    docDate = dec[2];
  } else if (sent && /corte constitucional/i.test(head)) {
    docType = "Sentencia";
    entity = "Corte Constitucional";
    docDate = year(sent[3]);
  }
  return { title, entity, docType, docDate };
}

function indexDocument(id: number, title: string, text: string): number {
  const chunks = chunkText(text);
  run("DELETE FROM chunks_fts WHERE rowid IN (SELECT id FROM chunks WHERE document_id = ?)", id);
  run("DELETE FROM chunks WHERE document_id = ?", id);
  chunks.forEach((c, i) => {
    const r = run(
      "INSERT INTO chunks (document_id, ord, heading, content) VALUES (?, ?, ?, ?)",
      id,
      i,
      c.heading,
      c.content,
    );
    run(
      "INSERT INTO chunks_fts (rowid, content, heading, title) VALUES (?, ?, ?, ?)",
      Number(r.lastInsertRowid),
      c.content,
      c.heading,
      title,
    );
  });
  return chunks.length;
}

function setCategories(id: number, categoryIds: number[]) {
  run("DELETE FROM document_categories WHERE document_id = ?", id);
  for (const cid of new Set(categoryIds)) {
    if (get("SELECT 1 AS x FROM categories WHERE id = ?", cid)) {
      run("INSERT OR IGNORE INTO document_categories (document_id, category_id) VALUES (?, ?)", id, cid);
    }
  }
}

/**
 * Añade las subcategorías que correspondan (sin quitar las que ya tiene), con reglas:
 * - Coincidencia de una palabra clave de la subcategoría en el título o el resumen, o
 * - al menos dos apariciones en el inicio del texto, si el documento ya está en la categoría principal.
 * - Jurisprudencia: SU, T, C y autos según el número de la providencia.
 */
export function assignSubcategories(id: number): number {
  const doc = get<{ title: string; summary: string; doc_type: string }>(
    "SELECT title, summary, doc_type FROM documents WHERE id = ?",
    id,
  );
  if (!doc) return 0;
  const words = (s: string) => ` ${fold(s).replace(/[^a-z0-9]+/g, " ").trim()} `;
  const head = words(`${doc.title} ${doc.summary}`);
  const body = words(
    all<{ content: string }>("SELECT content FROM chunks WHERE document_id = ? ORDER BY ord LIMIT 15", id)
      .map((c) => c.content)
      .join(" "),
  );
  const cats = all<{ id: number; parent_id: number | null; name: string; keywords: string }>(
    "SELECT id, parent_id, name, keywords FROM categories",
  );
  const current = new Set(
    all<{ category_id: number }>("SELECT category_id FROM document_categories WHERE document_id = ?", id).map(
      (r) => r.category_id,
    ),
  );
  const parentOf = new Map(cats.map((c) => [c.id, c.parent_id ?? c.id]));
  const myRoots = new Set([...current].map((c) => parentOf.get(c)));
  const count = (hay: string, k: string) => hay.split(k).length - 1;

  const add: number[] = [];
  for (const c of cats) {
    if (c.parent_id === null || current.has(c.id)) continue;
    const kws = c.keywords.split(",").map((k) => words(k).trim()).filter(Boolean).map((k) => ` ${k} `);
    let match = false;
    if (kws.length) {
      match = kws.some((k) => head.includes(k)) || (myRoots.has(c.parent_id) && kws.reduce((n, k) => n + count(body, k), 0) >= 2);
    } else if (doc.doc_type === "Sentencia" || doc.doc_type === "Auto") {
      const t = doc.title;
      match =
        (/unificaci/i.test(c.name) && /\bSU[-.\s]?\d/i.test(t)) ||
        (/tutela \(T\)/.test(c.name) && /\bT[-\s]\d/.test(t)) ||
        (/constitucionalidad \(C\)/.test(c.name) && /\bC[-\s]\d/.test(t)) ||
        (/^Autos/.test(c.name) && doc.doc_type === "Auto");
    }
    if (match) add.push(c.id);
  }
  for (const cid of add) run("INSERT OR IGNORE INTO document_categories (document_id, category_id) VALUES (?, ?)", id, cid);
  return add.length;
}

function storeFile(buffer: Buffer, hash: string, fileName: string): string {
  const ext = (path.extname(fileName) || ".bin").toLowerCase();
  const stored = `${hash.slice(0, 16)}${ext}`;
  fs.mkdirSync(FILES_DIR, { recursive: true });
  fs.writeFileSync(path.join(FILES_DIR, stored), buffer);
  return stored;
}

const MIME: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  html: "text/html; charset=utf-8",
  txt: "text/plain; charset=utf-8",
};

/** Registra un archivo: extrae el texto, lo fragmenta, lo indexa y lo deja en revisión. */
export async function createDocument(input: {
  buffer: Buffer;
  fileName: string;
  mime?: string;
  sourceKind: "upload" | "url";
  charsetHint?: string;
  meta?: DocumentMeta;
}): Promise<CreateResult> {
  const kind = detectKind(input.fileName, input.mime || "");
  if (!kind) throw new Error(`Formato no admitido: ${input.fileName}. Usa PDF o DOCX.`);
  const hash = crypto.createHash("sha256").update(input.buffer).digest("hex");
  const meta = input.meta || {};

  const dupe =
    get<{ id: number }>("SELECT id FROM documents WHERE content_hash = ?", hash) ||
    (meta.officialUrl
      ? get<{ id: number }>("SELECT id FROM documents WHERE official_url = ?", meta.officialUrl)
      : undefined);
  if (dupe) return { document: getDocument(dupe.id)!, duplicate: true };

  // Los HTML se guardan ya convertidos a UTF-8 para poder releerlos y mostrarlos sin errores.
  const buffer = kind === "html" ? toUtf8Html(input.buffer, input.charsetHint) : input.buffer;
  let extracted;
  try {
    extracted = await extractText(buffer, kind);
  } catch {
    throw new Error(`No se pudo leer ${input.fileName}. El archivo puede estar dañado o protegido.`);
  }
  const baseTitle =
    meta.title?.trim() ||
    extracted.title ||
    path.basename(input.fileName, path.extname(input.fileName)).replace(/[_-]+/g, " ");
  const guess = guessMeta(baseTitle, extracted.text, meta.officialUrl || "");
  const title = guess.title.slice(0, 300);
  const empty = extracted.text.length < 200;
  const warning = empty
    ? "No se encontró texto legible. Si es un PDF escaneado, necesita reconocimiento de texto (OCR) antes de poder consultarse."
    : undefined;

  const stored = storeFile(buffer, hash, input.fileName);
  const status: DocStatus = empty ? "borrador" : meta.status && STATUSES.includes(meta.status) ? meta.status : "revision";

  const id = tx(() => {
    const r = run(
      `INSERT INTO documents (title, entity, doc_type, doc_date, official_url, summary, status,
                              file_name, file_path, mime, file_size, source_kind, content_hash,
                              text_chars, review_note, weight)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      title,
      meta.entity?.trim() || guess.entity,
      meta.docType?.trim() || guess.docType,
      meta.docDate?.trim() || guess.docDate,
      meta.officialUrl?.trim() || "",
      meta.summary?.trim() || "",
      status,
      input.fileName,
      stored,
      MIME[kind],
      buffer.length,
      input.sourceKind,
      hash,
      extracted.text.length,
      meta.reviewNote?.trim() || warning || "",
      meta.weight && meta.weight > 0 ? meta.weight : 1,
    );
    const docId = Number(r.lastInsertRowid);
    indexDocument(docId, title, extracted.text);
    const cats = meta.categoryIds?.length
      ? meta.categoryIds
      : detectTopics(`${title} ${extracted.text.slice(0, 4000)}`, 2).map((t) => t.id);
    setCategories(docId, cats);
    assignSubcategories(docId);
    return docId;
  });
  return { document: getDocument(id)!, duplicate: false, warning };
}

/** Importa un documento desde una dirección oficial (dominios permitidos). */
export async function importFromUrl(url: string, meta: DocumentMeta = {}): Promise<CreateResult> {
  const existing = get<{ id: number }>("SELECT id FROM documents WHERE official_url = ?", url.trim());
  if (existing) return { document: getDocument(existing.id)!, duplicate: true };
  const f = await fetchOfficial(url);
  return createDocument({
    buffer: f.buffer,
    fileName: f.fileName,
    mime: f.contentType,
    charsetHint: f.contentType,
    sourceKind: "url",
    meta: { ...meta, officialUrl: meta.officialUrl || url.trim() },
  });
}

export function updateDocument(id: number, patch: DocumentMeta): DocumentSummary | null {
  const cur = getDocument(id);
  if (!cur) return null;
  if (patch.status && !STATUSES.includes(patch.status)) throw new Error("Estado no válido.");
  if (patch.status === "aprobado" && cur.chunkCount === 0) {
    throw new Error("No se puede aprobar un documento sin texto indexado.");
  }
  const title = patch.title?.trim() || cur.title;
  tx(() => {
    run(
      `UPDATE documents SET title = ?, entity = ?, doc_type = ?, doc_date = ?, official_url = ?,
              summary = ?, status = ?, review_note = ?, updated_at = datetime('now') WHERE id = ?`,
      title,
      patch.entity?.trim() ?? cur.entity,
      patch.docType?.trim() || cur.docType,
      patch.docDate?.trim() ?? cur.docDate,
      patch.officialUrl?.trim() ?? cur.officialUrl,
      patch.summary?.trim() ?? cur.summary,
      patch.status || cur.status,
      patch.reviewNote?.trim() ?? cur.reviewNote,
      id,
    );
    if (title !== cur.title) {
      run(
        "UPDATE chunks_fts SET title = ? WHERE rowid IN (SELECT id FROM chunks WHERE document_id = ?)",
        title,
        id,
      );
    }
    if (patch.categoryIds) setCategories(id, patch.categoryIds);
  });
  return getDocument(id);
}

/** Sustituye el archivo original. El documento vuelve a revisión porque su contenido cambió. */
export async function replaceDocumentFile(
  id: number,
  input: { buffer: Buffer; fileName: string; mime?: string },
): Promise<CreateResult | null> {
  const cur = get<{ title: string; file_path: string }>(
    "SELECT title, file_path FROM documents WHERE id = ?",
    id,
  );
  if (!cur) return null;
  const kind = detectKind(input.fileName, input.mime || "");
  if (!kind) throw new Error(`Formato no admitido: ${input.fileName}. Usa PDF o DOCX.`);
  const hash = crypto.createHash("sha256").update(input.buffer).digest("hex");
  const other = get<{ id: number }>("SELECT id FROM documents WHERE content_hash = ? AND id != ?", hash, id);
  if (other) throw new Error("Ese archivo ya existe en la biblioteca como otro documento.");
  const buffer = kind === "html" ? toUtf8Html(input.buffer) : input.buffer;
  const extracted = await extractText(buffer, kind);
  const stored = storeFile(buffer, hash, input.fileName);
  tx(() => {
    run(
      `UPDATE documents SET file_name = ?, file_path = ?, mime = ?, file_size = ?, content_hash = ?,
              text_chars = ?, status = 'revision', updated_at = datetime('now') WHERE id = ?`,
      input.fileName,
      stored,
      MIME[kind],
      input.buffer.length,
      hash,
      extracted.text.length,
      id,
    );
    indexDocument(id, cur.title, extracted.text);
  });
  if (cur.file_path && cur.file_path !== stored) {
    fs.rmSync(path.join(FILES_DIR, path.basename(cur.file_path)), { force: true });
  }
  return { document: getDocument(id)!, duplicate: false };
}

/** Vuelve a extraer el texto del archivo guardado y reconstruye el índice. */
export async function reindexDocument(id: number): Promise<DocumentSummary | null> {
  const cur = get<{ title: string; file_name: string; mime: string }>(
    "SELECT title, file_name, mime FROM documents WHERE id = ?",
    id,
  );
  const file = getDocumentFile(id);
  if (!cur || !file) return null;
  const kind = detectKind(cur.file_name, cur.mime);
  if (!kind) return null;
  const extracted = await extractText(fs.readFileSync(file.absPath), kind);
  tx(() => {
    indexDocument(id, cur.title, extracted.text);
    run("UPDATE documents SET text_chars = ?, updated_at = datetime('now') WHERE id = ?", extracted.text.length, id);
  });
  return getDocument(id);
}

export function deleteDocument(id: number): boolean {
  const cur = get<{ file_path: string }>("SELECT file_path FROM documents WHERE id = ?", id);
  if (!cur) return false;
  tx(() => {
    run("DELETE FROM chunks_fts WHERE rowid IN (SELECT id FROM chunks WHERE document_id = ?)", id);
    run("DELETE FROM documents WHERE id = ?", id);
  });
  if (cur.file_path) fs.rmSync(path.join(FILES_DIR, path.basename(cur.file_path)), { force: true });
  return true;
}
