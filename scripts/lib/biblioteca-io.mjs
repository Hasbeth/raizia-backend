import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash } from "node:crypto";

export const ROOT = fileURLToPath(new URL("../../", import.meta.url));
export const DATA = path.join(ROOT, "data");
export const STAGING = path.join(DATA, "staging");
export const SOURCE = path.resolve(ROOT, "../raizia/data");

export function isMain(url) {
  return Boolean(process.argv[1]) && pathToFileURL(path.resolve(process.argv[1])).href === url;
}

export function assertWritable(target) {
  const root = fs.realpathSync(ROOT);
  const absolute = path.resolve(target);
  const inside = (p) => { const rel = path.relative(root, p); return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel); };
  if (!inside(absolute)) throw new Error("La escritura debe permanecer dentro de raizia-backend");
  let existing = absolute;
  while (!fs.existsSync(existing)) existing = path.dirname(existing);
  const real = fs.realpathSync(existing);
  if (real !== root && !inside(real)) throw new Error("Destino fuera del backend mediante enlace simbólico");
  return absolute;
}

export function writeJson(target, value) {
  assertWritable(target);
  const tmp = `${target}.tmp`;
  assertWritable(tmp);
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n");
  fs.renameSync(tmp, target);
}

export async function sha256(file) {
  const hash = createHash("sha256");
  for await (const buffer of fs.createReadStream(file)) hash.update(buffer);
  return hash.digest("hex");
}

export function acquireLock(directory = DATA) {
  assertWritable(directory);
  fs.mkdirSync(directory, { recursive: true });
  const lock = assertWritable(path.join(directory, ".biblioteca.lock"));
  try {
    const fd = fs.openSync(lock, "wx");
    fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, created_at: new Date().toISOString() }));
    fs.closeSync(fd);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const owner = JSON.parse(fs.readFileSync(lock, "utf8"));
    try { process.kill(owner.pid, 0); }
    catch (probe) {
      if (probe.code === "ESRCH") {
        fs.unlinkSync(lock);
        return acquireLock(directory);
      }
    }
    throw new Error(`Otro proceso de biblioteca está activo (PID ${owner.pid})`);
  }
  return () => fs.unlinkSync(lock);
}

export function recoverPublication(destination) {
  const previous = assertWritable(`${destination}.previous`);
  assertWritable(destination);
  if (fs.existsSync(previous) && !fs.existsSync(destination)) fs.renameSync(previous, destination);
  if (fs.existsSync(previous) && fs.existsSync(destination)) fs.rmSync(previous, { recursive: true });
}

export function publishDirectory(next, destination) {
  assertWritable(next);
  assertWritable(destination);
  const previous = assertWritable(`${destination}.previous`);
  if (fs.existsSync(destination)) fs.renameSync(destination, previous);
  try { fs.renameSync(next, destination); }
  catch (error) {
    if (fs.existsSync(previous)) fs.renameSync(previous, destination);
    throw error;
  }
  if (fs.existsSync(previous)) fs.rmSync(previous, { recursive: true });
}

export const DOCUMENT_COLUMNS = ["id", "title", "entity", "doc_type", "doc_date", "official_url", "summary", "status", "file_name", "file_path", "mime", "file_size", "source_kind", "content_hash", "text_chars", "review_note", "created_at", "updated_at", "weight"];

export const SCHEMA = `
PRAGMA foreign_keys=ON;
CREATE TABLE categories (
  id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES categories(id) DEFERRABLE INITIALLY DEFERRED,
  name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, description TEXT NOT NULL,
  keywords TEXT NOT NULL, sort INTEGER NOT NULL
);
CREATE TABLE documents (
  id INTEGER PRIMARY KEY, title TEXT NOT NULL, entity TEXT NOT NULL, doc_type TEXT NOT NULL,
  doc_date TEXT NOT NULL, official_url TEXT NOT NULL, summary TEXT NOT NULL, status TEXT NOT NULL,
  file_name TEXT NOT NULL, file_path TEXT NOT NULL, mime TEXT NOT NULL, file_size INTEGER NOT NULL,
  source_kind TEXT NOT NULL, content_hash TEXT NOT NULL, text_chars INTEGER NOT NULL,
  review_note TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, weight REAL NOT NULL
);
CREATE TABLE document_categories (
  document_id INTEGER NOT NULL REFERENCES documents(id), category_id INTEGER NOT NULL REFERENCES categories(id),
  PRIMARY KEY(document_id,category_id)
);
CREATE TABLE chunks (
  id INTEGER PRIMARY KEY, document_id INTEGER NOT NULL REFERENCES documents(id), ord INTEGER NOT NULL,
  heading TEXT NOT NULL, section TEXT NOT NULL, content TEXT NOT NULL, content_hash TEXT NOT NULL,
  indexed INTEGER NOT NULL CHECK(indexed IN (0,1)), UNIQUE(document_id,ord)
);
CREATE INDEX chunks_hash ON chunks(content_hash);
CREATE INDEX chunks_pending ON chunks(indexed,document_id,id);
CREATE TABLE embeddings (
  chunk_id INTEGER PRIMARY KEY REFERENCES chunks(id), model TEXT NOT NULL, dims INTEGER NOT NULL CHECK(dims>0),
  vector BLOB NOT NULL CHECK(length(vector)=dims*4), created_at TEXT NOT NULL
);
`;
