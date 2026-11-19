import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { SEED_CATEGORIES } from "./seed-categories";

export const DATA_DIR = process.env.RAIZIA_DATA_DIR || path.join(process.cwd(), "data");
export const FILES_DIR = path.join(DATA_DIR, "files");
export const DB_PATH = path.join(DATA_DIR, "raizia.db");

const g = globalThis as unknown as { __raiziaDb?: DatabaseSync };

export function db(): DatabaseSync {
  if (g.__raiziaDb) return g.__raiziaDb;
  // Permite verificar una colección existente sin crear carpetas ni migrar su base.
  const readOnly = process.env.RAIZIA_READ_ONLY === "1";
  if (!readOnly) fs.mkdirSync(FILES_DIR, { recursive: true });
  const d = new DatabaseSync(DB_PATH, { readOnly });
  d.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  if (readOnly) d.exec("PRAGMA query_only = ON;");
  else {
    d.exec("PRAGMA journal_mode = WAL;");
    migrate(d);
  }
  g.__raiziaDb = d;
  return d;
}

/** Devuelve filas como objetos planos (node:sqlite usa prototipo nulo). */
export function all<T>(sql: string, ...params: SQLInputValue[]): T[] {
  return db()
    .prepare(sql)
    .all(...params)
    .map((r) => ({ ...r }) as T);
}

export function get<T>(sql: string, ...params: SQLInputValue[]): T | undefined {
  const r = db().prepare(sql).get(...params);
  return r ? ({ ...r } as T) : undefined;
}

export function run(sql: string, ...params: SQLInputValue[]) {
  return db().prepare(sql).run(...params);
}

export function tx<T>(fn: () => T): T {
  const d = db();
  d.exec("BEGIN IMMEDIATE");
  try {
    const out = fn();
    d.exec("COMMIT");
    return out;
  } catch (e) {
    d.exec("ROLLBACK");
    throw e;
  }
}

function migrate(d: DatabaseSync) {
  d.exec(`
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      parent_id INTEGER REFERENCES categories(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL DEFAULT '',
      keywords TEXT NOT NULL DEFAULT '',
      sort INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      entity TEXT NOT NULL DEFAULT '',
      doc_type TEXT NOT NULL DEFAULT 'Otro',
      doc_date TEXT NOT NULL DEFAULT '',
      official_url TEXT NOT NULL DEFAULT '',
      summary TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'revision',
      file_name TEXT NOT NULL DEFAULT '',
      file_path TEXT NOT NULL DEFAULT '',
      mime TEXT NOT NULL DEFAULT '',
      file_size INTEGER NOT NULL DEFAULT 0,
      source_kind TEXT NOT NULL DEFAULT 'upload',
      content_hash TEXT NOT NULL DEFAULT '',
      text_chars INTEGER NOT NULL DEFAULT 0,
      review_note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_documents_status ON documents(status);
    CREATE INDEX IF NOT EXISTS idx_documents_hash ON documents(content_hash);

    CREATE TABLE IF NOT EXISTS document_categories (
      document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
      PRIMARY KEY (document_id, category_id)
    );

    CREATE TABLE IF NOT EXISTS chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      ord INTEGER NOT NULL,
      heading TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_chunks_doc ON chunks(document_id, ord);

    CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
      content, heading, title,
      tokenize = 'unicode61 remove_diacritics 2'
    );
  `);

  // Peso del documento en la búsqueda del asistente (1 = normal). Las sentencias importadas en
  // bloque por el Vigía de Sentencias pesan menos que las normas y la colección curada.
  const cols = d.prepare("PRAGMA table_info(documents)").all() as { name: string }[];
  if (!cols.some((c) => c.name === "weight")) {
    d.exec("ALTER TABLE documents ADD COLUMN weight REAL NOT NULL DEFAULT 1");
  }

  const count = d.prepare("SELECT COUNT(*) AS n FROM categories").get() as { n: number };
  if (count.n === 0) {
    const ins = d.prepare(
      "INSERT INTO categories (parent_id, name, slug, description, keywords, sort) VALUES (?, ?, ?, ?, ?, ?)",
    );
    SEED_CATEGORIES.forEach((c, i) => {
      const r = ins.run(null, c.name, c.slug, c.description, c.keywords, i + 1);
      const parentId = Number(r.lastInsertRowid);
      c.children.forEach((s, j) => {
        ins.run(parentId, s.name, `${c.slug}--${slugify(s.name)}`, "", s.keywords ?? "", j + 1);
      });
    });
  }
}

export function slugify(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}
