import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const directory = dirname(fileURLToPath(import.meta.url));

// Load the actual handlers with isolated auth/repository adapters. No database,
// session, environment file, network request, or original document is changed.
function harness({ admin = true, configured = true, documents = {} } = {}) {
  const cookieWrites = [];
  const auth = {
    isAdmin: async () => admin,
    adminConfigured: () => configured,
    checkPassword: (password) => password === "clave-de-prueba",
    createSessionValue: () => "sesion-firmada-de-prueba",
    SESSION_COOKIE: "raizia_admin",
    sessionCookieOptions: { httpOnly: true, sameSite: "lax", path: "/", maxAge: 28800 },
  };
  const repository = new Proxy(documents, { get: (target, key) => target[key] || (() => { throw new Error(`Acceso inesperado al repositorio: ${String(key)}`); }) });
  const cache = new Map();
  function load(path) {
    if (cache.has(path)) return cache.get(path).exports;
    const loadedModule = { exports: {} };
    cache.set(path, loadedModule);
    const code = ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const localRequire = (specifier) => {
      if (specifier === "@/lib/auth") return auth;
      if (specifier === "@/lib/documents") return repository;
      if (specifier === "@/lib/constants") return load(resolve(directory, "../../lib/constants.ts"));
      if (specifier === "next/headers") return { cookies: async () => ({ set: (...args) => cookieWrites.push(args) }) };
      if (specifier.startsWith(".")) return load(resolve(dirname(path), `${specifier}.ts`));
      return require(specifier);
    };
    new Function("require", "module", "exports", code)(localRequire, loadedModule, loadedModule.exports);
    return loadedModule.exports;
  }
  return { route: (name) => load(resolve(directory, name, "route.ts")), cookieWrites };
}

const context = (id = "7") => ({ params: Promise.resolve({ id }) });
const request = (value, method = "POST") => new Request("http://localhost/api/admin/test", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) });

test("all private methods reject unauthenticated requests before parsing or accessing data", async () => {
  const { route } = harness({ admin: false });
  const methods = { logout: ["POST"], documents: ["GET", "POST"], "import-url": ["POST"], "documents/[id]": ["GET", "PATCH", "DELETE"], "documents/[id]/file": ["POST"], "documents/[id]/reindex": ["POST"], categories: ["GET", "POST"], "categories/[id]": ["PATCH", "DELETE"] };
  for (const [path, verbs] of Object.entries(methods)) {
    const handler = route(path);
    assert.equal(handler.dynamic, "force-dynamic");
    for (const verb of verbs) {
      const response = await handler[verb](new Request("http://localhost/"), context());
      assert.equal(response.status, 401, `${verb} ${path}`);
      assert.equal(typeof (await response.json()).error, "string");
      assert.match(response.headers.get("cache-control"), /no-store/);
    }
  }
});

test("login requires configuration, delays invalid passwords, and sets the shared session cookie", async () => {
  assert.equal((await harness({ configured: false }).route("login").POST(request({ password: "x" }))).status, 503);
  const h = harness();
  const start = performance.now();
  assert.equal((await h.route("login").POST(request({ password: "incorrecta" }))).status, 401);
  assert.ok(performance.now() - start >= 380);
  assert.equal(h.cookieWrites.length, 0);
  assert.equal((await h.route("login").POST(request({ password: "clave-de-prueba" }))).status, 200);
  assert.deepEqual(h.cookieWrites[0], ["raizia_admin", "sesion-firmada-de-prueba", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 28800 }]);
  assert.equal((await h.route("logout").POST()).status, 200);
  assert.equal(h.cookieWrites[1][2].maxAge, 0);
});

test("uploads isolate rejected and unreadable files, preserve duplicates, and ingest sequentially", async () => {
  const calls = [];
  let active = 0;
  const { route } = harness({ documents: { createDocument: async (input) => {
    assert.equal(active++, 0);
    calls.push(input);
    await Promise.resolve();
    active--;
    if (input.fileName === "dañado.pdf") throw new Error("No se pudo leer dañado.pdf. El archivo puede estar dañado o protegido.");
    return { document: { id: calls.length, status: "revision" }, duplicate: input.fileName === "duplicado.pdf", warning: input.fileName === "aviso.docx" ? "No se encontró texto legible." : undefined };
  } } });
  const form = new FormData();
  for (const name of ["primero.pdf", "prohibido.html", "dañado.pdf", "duplicado.pdf", "aviso.docx", "ultimo.pdf"]) form.append("files", new File(["contenido"], name));
  form.append("files", new File([new Uint8Array(30 * 1024 * 1024 + 1)], "grande.pdf"));
  form.append("categoryIds", "[2,3]");
  const response = await route("documents").POST({ formData: async () => form });
  const { results } = await response.json();
  assert.equal(response.status, 200);
  assert.equal(results.length, 7);
  assert.deepEqual(results.map((result) => result.ok), [true, false, false, true, true, true, false]);
  assert.equal(results[3].duplicate, true);
  assert.ok(results[4].warning);
  assert.match(results[6].error, /30 MB/);
  assert.deepEqual(calls.map((call) => call.fileName), ["primero.pdf", "dañado.pdf", "duplicado.pdf", "aviso.docx", "ultimo.pdf"]);
  assert.deepEqual(calls[0].meta, { categoryIds: [2, 3], status: "revision" });
  assert.equal(calls[0].sourceKind, "upload");
  assert.ok(Buffer.isBuffer(calls[0].buffer));
});

test("document filters and preview use private data and await dynamic params", async () => {
  let options;
  let publicOnly;
  const chunks = Array.from({ length: 20 }, (_, id) => ({ id, heading: "Título", content: "Contenido" }));
  const { route } = harness({ documents: {
    listDocuments: (input) => { options = input; return []; }, getStats: () => ({ total: 4 }), listFacets: (value) => { publicOnly = value; return {}; },
    getDocument: (id) => { assert.equal(id, 7); return { id }; }, getDocumentChunks: () => chunks,
  } });
  await route("documents").GET(new Request("http://localhost/?q=tierra&status=revision&categoryId=2&docType=Ley"));
  assert.deepEqual(options, { q: "tierra", status: "revision", categoryId: 2, docType: "Ley" });
  assert.equal(publicOnly, false);
  const result = await (await route("documents/[id]").GET(null, context())).json();
  assert.equal(result.chunks.length, 12);
  assert.equal(result.totalChunks, 20);
});

test("metadata validates input, ignores private fields, and returns repository validation errors", async () => {
  let received;
  const { route } = harness({ documents: { updateDocument: (id, patch) => {
    received = { id, patch };
    if (patch.status === "aprobado") throw new Error("No se puede aprobar un documento sin texto indexado.");
    return { id };
  } } });
  const handler = route("documents/[id]");
  assert.equal((await handler.PATCH(request({ title: "Nueva ley", categoryIds: [3], filePath: "/secret" }), context())).status, 200);
  assert.deepEqual(received, { id: 7, patch: { title: "Nueva ley", categoryIds: [3] } });
  for (const patch of [{ status: "incorrecto" }, { title: 3 }, { title: " " }, { categoryIds: ["2"] }, { officialUrl: "javascript:alert(1)" }]) {
    assert.equal((await handler.PATCH(request(patch), context())).status, 400);
  }
  const invalidApproval = await handler.PATCH(request({ status: "aprobado" }), context());
  assert.equal(invalidApproval.status, 400);
  assert.match((await invalidApproval.json()).error, /sin texto indexado/);
  assert.equal((await handler.GET(null, context("NaN"))).status, 400);
});

test("replacement validates the same size and format limits before calling the repository", async () => {
  const { route } = harness({ documents: { getDocument: () => ({ id: 7 }) } });
  const form = new FormData();
  form.append("file", new File(["<html>"], "pagina.html", { type: "text/html" }));
  assert.equal((await route("documents/[id]/file").POST({ formData: async () => form }, context())).status, 415);
});

test("URL import passes category metadata and shows safe importer messages", async () => {
  const { route } = harness({ documents: { importFromUrl: async (url, meta) => {
    assert.equal(url, "https://ejemplo.gov.co/documento.pdf");
    assert.deepEqual(meta, { categoryIds: [2] });
    throw new Error("El sitio no permite la descarga automática de esta dirección (robots.txt).");
  } } });
  const response = await route("import-url").POST(request({ url: "https://ejemplo.gov.co/documento.pdf", categoryIds: [2] }));
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /robots.txt/);
});

test("missing records return 404 and unexpected failures never disclose internals", async () => {
  const { route } = harness({ documents: {
    getDocument: () => null, deleteDocument: () => false, reindexDocument: async () => null,
    updateCategory: () => null, deleteCategory: () => false,
    listDocuments: () => { throw new Error("SQLITE private/path stack details"); },
  } });
  assert.equal((await route("documents/[id]").GET(null, context())).status, 404);
  assert.equal((await route("documents/[id]").DELETE(null, context())).status, 404);
  assert.equal((await route("documents/[id]/reindex").POST(null, context())).status, 404);
  assert.equal((await route("categories/[id]").PATCH(request({ name: "Tema" }), context())).status, 404);
  assert.equal((await route("categories/[id]").DELETE(null, context())).status, 404);
  const failed = await route("documents").GET(new Request("http://localhost/"));
  assert.equal(failed.status, 500);
  assert.doesNotMatch((await failed.json()).error, /SQLITE|private|stack/);
});

test("malformed bodies and category metadata return Spanish validation errors", async () => {
  const { route } = harness();
  for (const value of [null, [], "texto"]) assert.equal((await route("categories").POST(request(value))).status, 400);
  assert.equal((await route("categories").POST(request({ name: "Tema", parentId: "2" }))).status, 400);
  assert.equal((await route("categories").POST(request({ name: " " }))).status, 400);
  const form = new FormData();
  form.append("categoryIds", "no es JSON");
  assert.equal((await route("documents").POST({ formData: async () => form })).status, 400);
});
