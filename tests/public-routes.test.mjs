import assert from "node:assert/strict";
import test from "node:test";
import { routeHarness } from "./support/route-harness.mjs";

const request = (query = "") => new Request(`http://localhost/api/library${query}`);
const context = (id) => ({ params: Promise.resolve({ id }) });
const documents = Array.from({ length: 61 }, (_, i) => ({ id: i + 1, title: `Documento ${i + 1}`, status: "aprobado" }));
const stats = { total: 70, approved: 61, pending: 9, chunks: 100, categories: 1 };
const categories = [{ id: 3, name: "Territorio", children: [], docCount: 61 }];
const facets = { entities: ["Congreso"], docTypes: ["Ley"] };

function repository(overrides = {}) {
  return {
    listDocuments: (options) => { assert.equal(options.publicOnly, true); return documents; },
    getStats: () => stats,
    categoryTree: (publicOnly) => { assert.equal(publicOnly, true); return categories; },
    listFacets: (publicOnly) => { assert.equal(publicOnly, true); return facets; },
    hydrateLibraryPage: async (docs) => docs,
    ...overrides,
  };
}

async function json(response, status = 200) {
  response = await response;
  assert.equal(response.status, status);
  assert.match(response.headers.get("cache-control"), /no-store/);
  return response.json();
}

test("biblioteca pública: 25 documentos por página y totales completos", async () => {
  const route = routeHarness({ documents: repository() })("library");
  assert.equal(route.dynamic, "force-dynamic");
  assert.deepEqual(await json(route.GET(request())), {
    documents: documents.slice(0, 25), total: 61, approved: 61, page: 1, pages: 3, categories, facets,
  });
  const second = await json(route.GET(request("?pagina=2")));
  assert.deepEqual(second.documents, documents.slice(25, 50));
  assert.equal(second.page, 2);
});

test("biblioteca: filtros públicos y número de coincidencias independiente de aprobados", async () => {
  const route = routeHarness({ documents: repository({ listDocuments: (options) => {
    assert.deepEqual(options, { publicOnly: true, q: "consulta previa", categoryId: 3, docType: "Ley", entity: "Congreso" });
    return documents.slice(0, 2);
  } }) })("library");
  const result = await json(route.GET(request("?q=consulta%20previa&categoria=3&tipo=Ley&entidad=Congreso")));
  assert.equal(result.total, 2);
  assert.equal(result.approved, 61);
});

test("biblioteca: páginas fuera del rango, vacía y tamaños inválidos", async () => {
  const route = routeHarness({ documents: repository() })("library");
  for (const value of ["0", "-10", "no-numero"]) {
    assert.equal((await json(route.GET(request(`?pagina=${value}`)))).page, 1);
  }
  const last = await json(route.GET(request("?pagina=999")));
  assert.equal(last.page, 3);
  assert.deepEqual(last.documents, documents.slice(50));
  for (const value of ["0", "no-numero"]) {
    assert.equal((await json(route.GET(request(`?tamano=${value}`)))).documents.length, 25);
  }
  assert.equal((await json(route.GET(request("?tamano=-1")))).documents.length, 1);
  const empty = routeHarness({ documents: repository({ listDocuments: () => [] }) })("library");
  const result = await json(empty.GET(request("?pagina=999")));
  assert.deepEqual(result.documents, []);
  assert.equal(result.total, 0);
  assert.equal(result.page, 1);
  assert.equal(result.pages, 1);
});

test("biblioteca: tamaño configurable con máximo de 100", async () => {
  const many = Array.from({ length: 201 }, (_, id) => ({ id }));
  const route = routeHarness({ documents: repository({ listDocuments: () => many }) })("library");
  const result = await json(route.GET(request("?tamano=999&pagina=2")));
  assert.equal(result.documents.length, 100);
  assert.deepEqual(result.documents, many.slice(100, 200));
  assert.equal(result.pages, 3);
  const small = await json(route.GET(request("?tamano=10&pagina=3")));
  assert.deepEqual(small.documents, many.slice(20, 30));
});

test("ficha: consulta solo aprobados y devuelve todos sus fragmentos", async () => {
  const chunks = [{ id: 4, heading: "Artículo 1", content: "Texto" }];
  const route = routeHarness({ documents: {
    getDocument: (id, publicOnly) => { assert.equal(id, 1); assert.equal(publicOnly, true); return documents[0]; },
    getDocumentChunks: (id) => { assert.equal(id, 1); return chunks; },
  } })("documents/[id]");
  assert.equal(route.dynamic, "force-dynamic");
  assert.deepEqual(await json(await route.GET(null, context("1"))), { document: documents[0], chunks });
});

test("ficha: inexistentes o no aprobados son 404 sin leer fragmentos", async () => {
  const route = routeHarness({ documents: {
    getDocument: (id, publicOnly) => { assert.equal(id, 9); assert.equal(publicOnly, true); return null; },
  } })("documents/[id]");
  const result = await json(await route.GET(null, context("9")), 404);
  assert.equal(result.error, "Documento no encontrado.");
});

test("ficha: identificadores inválidos son 404 antes de consultar datos", async () => {
  const route = routeHarness()("documents/[id]");
  for (const id of ["texto", "0", "-1", "1.5", "Infinity"]) {
    await json(await route.GET(null, context(id)), 404);
  }
});

test("inicio: estadísticas completas y categorías públicas sin caché", async () => {
  const route = routeHarness({ documents: repository() })("home");
  assert.equal(route.dynamic, "force-dynamic");
  assert.deepEqual(await json(route.GET()), { stats, categories });
});

test("sesión: sin configuración no consulta autenticación", async () => {
  const route = routeHarness({ auth: { adminConfigured: () => false } })("admin/session");
  assert.equal(route.dynamic, "force-dynamic");
  assert.deepEqual(await json(await route.GET()), { configured: false, admin: false });
});

test("sesión: espera la autenticación y devuelve estados separados sin caché", async () => {
  for (const admin of [false, true]) {
    const route = routeHarness({ auth: { adminConfigured: () => true, isAdmin: async () => admin } })("admin/session");
    assert.deepEqual(await json(await route.GET()), { configured: true, admin });
  }
});
