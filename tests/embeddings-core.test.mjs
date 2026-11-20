import test from "node:test";
import assert from "node:assert/strict";
import { batches, rateLimit, parse429, normalizeVector, float32ToBlob, blobToFloat32, toPgvector, embeddingRequest, parseLimit, MODEL, ENDPOINT } from "../scripts/lib/embeddings-core.mjs";
import { runEmbeddingQueue } from "../scripts/lib/embeddings-runner.mjs";

test("Lotes conservan orden y último lote incompleto", () => {
  assert.deepEqual(batches([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(batches([], 30), []);
  assert.throws(() => batches([1], 0));
});

test("El limitador cuenta textos en ventana móvil y espacia las solicitudes", () => {
  assert.equal(rateLimit([], 30, 0).waitMs, 0);
  assert.equal(rateLimit([{ at: 0, count: 30 }], 30, 0).waitMs, 20_000);
  assert.equal(rateLimit([{ at: 0, count: 90 }], 1, 1000).waitMs, 59_000);
  assert.equal(rateLimit([{ at: 0, count: 90 }], 30, 60_000).waitMs, 0);
  assert.throws(() => rateLimit([], 91, 0));
});

test("Ninguna ventana de un minuto excede 90 textos con lotes irregulares", () => {
  let history = [];
  let now = 0;
  const sent = [];
  for (let i = 0; i < 80; i++) {
    const count = [20, 50, 30][i % 3];
    let plan;
    do { plan = rateLimit(history, count, now); now += plan.waitMs; } while (plan.waitMs);
    history = [...plan.history, { at: now, count }];
    sent.push({ at: now, count });
    assert.ok(sent.filter((h) => h.at > now - 60_000).reduce((n, h) => n + h.count, 0) <= 90);
  }
});

test("429 lee RetryInfo fraccional y cuota por minuto", () => {
  const parsed = parse429({ error: { details: [
    { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "34.125s" },
    { violations: [{ quotaId: "EmbedContentRequestsPerMinutePerUserPerProjectPerModel-FreeTier" }] },
  ] } });
  assert.equal(parsed.retryMs, 34125);
  assert.equal(parsed.daily, false);
});

test("429 reconoce cuota diaria y duración estructurada", () => {
  assert.equal(parse429({ error: { details: [{ violations: [{ quotaId: "EmbedContentRequestsPerDayPerProject" }] }] } }).daily, true);
  assert.equal(parse429({ error: { message: "Daily quota exhausted" } }).daily, true);
  assert.equal(parse429({ details: [{ "@type": "google.rpc.RetryInfo", retryDelay: { seconds: "3", nanos: 500_000_000 } }] }).retryMs, 3500);
  assert.equal(parse429({}).retryMs, 60_000);
  assert.equal(parse429({ error: { message: "429 Resource exhausted" } }).daily, false);
});

test("Normalización L2 estable, serialización little-endian y pgvector", () => {
  const vector = normalizeVector([3, 4]);
  assert.ok(Math.abs(Math.hypot(...vector) - 1) < 1e-6);
  const blob = float32ToBlob(vector);
  assert.equal(blob.length, 8);
  assert.deepEqual(blobToFloat32(blob), vector);
  const padded = Buffer.concat([Buffer.from([0]), blob]);
  assert.deepEqual(blobToFloat32(padded.subarray(1)), vector);
  assert.equal(toPgvector([0.6, 0.8]), "[0.6,0.8]");
  assert.ok(Math.abs(Math.hypot(...normalizeVector([1e300, 1e300])) - 1) < 1e-6);
});

test("Se rechazan vectores vacíos, cero, dimensiones erradas y no finitos", () => {
  for (const v of [[], [0, 0], [NaN, 1], [Infinity, 1], ["1", 2]]) assert.throws(() => normalizeVector(v));
  assert.throws(() => normalizeVector([1, 2], 3));
  assert.throws(() => blobToFloat32(Buffer.alloc(7)));
  assert.throws(() => float32ToBlob([1e300]));
  assert.throws(() => toPgvector([NaN]));
});

test("El cuerpo usa el modelo, título, tarea y dimensiones requeridos", () => {
  assert.deepEqual(embeddingRequest([{ title: "Título", content: "Texto" }], 384), { requests: [{ model: MODEL,
    content: { parts: [{ text: "Texto" }] }, outputDimensionality: 384, taskType: "RETRIEVAL_DOCUMENT", title: "Título" }] });
  assert.ok(ENDPOINT.endsWith("/models/gemini-embedding-2:batchEmbedContents"));
});

test("--limite solo acepta enteros no negativos sin argumentos sobrantes", () => {
  assert.equal(parseLimit([]), Infinity);
  assert.equal(parseLimit(["--limite", "0"]), 0);
  assert.equal(parseLimit(["--limite", "37"]), 37);
  for (const args of [["--limite"], ["--limite", "-1"], ["--limite", "3.5"], ["--limite", "2", "extra"]]) assert.throws(() => parseLimit(args));
});

function harness(size = 4) {
  let time = 0;
  const rows = Array.from({ length: size }, (_, id) => ({ id, title: `Documento ${id}`, content: `Texto ${id}`, weight: id < 2 ? 1 : 0.5 }));
  const saved = new Set();
  const progress = [];
  const calls = [];
  const opts = {
    dims: 2, batchSize: 20, limit: Infinity, apiKey: "clave-ficticia", now: () => time,
    wait: async (ms) => { time += ms; }, log: () => {},
    counts: () => ({ total: rows.length, done: saved.size }), take: (n) => rows.filter((r) => !saved.has(r.id)).slice(0, n),
    commit: (batch, vectors) => { batch.forEach((r, i) => { assert.ok(Math.abs(Math.hypot(...blobToFloat32(vectors[i])) - 1) < 1e-6); saved.add(r.id); }); },
    persist: (p) => progress.push(p),
    request: async (url, options) => { calls.push({ url, options }); return { ok: true, json: async () => ({ embeddings: JSON.parse(options.body).requests.map(() => ({ values: [3, 4] })) }) }; },
  };
  return { opts, saved, progress, calls };
}

test("Cola confirma cada lote, prioriza principal y respeta límite y reanudación", async () => {
  const h = harness();
  await runEmbeddingQueue({ ...h.opts, limit: 3 });
  assert.equal(h.saved.size, 3);
  assert.deepEqual(h.calls.map((c) => JSON.parse(c.options.body).requests.map((r) => r.title)), [["Documento 0", "Documento 1"], ["Documento 2"]]);
  assert.equal(h.calls[0].options.headers["x-goog-api-key"], "clave-ficticia");
  assert.equal(h.progress.at(-1).estado, "limite_alcanzado");
  await runEmbeddingQueue({ ...h.opts, history: h.progress.at(-1).solicitudes_recientes });
  assert.equal(h.saved.size, 4);
  assert.equal(h.progress.at(-1).porcentaje, 100);
});

test("429 diario guarda avance y termina exitosamente sin más peticiones", async () => {
  const h = harness();
  let requests = 0;
  const real = h.opts.request;
  h.opts.request = async (...args) => ++requests === 1 ? real(...args) : {
    ok: false, status: 429, json: async () => ({ error: { details: [{ violations: [{ quotaId: "RequestsPerDay" }] }] } }),
  };
  const result = await runEmbeddingQueue(h.opts);
  assert.equal(result.status, "daily_quota");
  assert.equal(h.saved.size, 2);
  assert.equal(requests, 2);
  assert.equal(h.progress.at(-1).ultimo_error, "cuota diaria agotada, reintentar mañana");
});

test("429 temporal espera RetryInfo y reintenta el mismo lote", async () => {
  const h = harness(2);
  const real = h.opts.request;
  let tries = 0;
  h.opts.request = async (...args) => ++tries === 1 ? { ok: false, status: 429,
    json: async () => ({ error: { details: [{ "@type": "google.rpc.RetryInfo", retryDelay: "70s" }] } }) } : real(...args);
  await runEmbeddingQueue(h.opts);
  assert.equal(tries, 2);
  assert.equal(h.saved.size, 2);
  assert.ok(h.opts.now() >= 70_000);
});

test("Un vector inválido no confirma parte del lote y persiste el error", async () => {
  const h = harness(2);
  h.opts.request = async () => ({ ok: true, json: async () => ({ embeddings: [{ values: [3, 4] }, { values: [0, 0] }] }) });
  await assert.rejects(runEmbeddingQueue(h.opts), /norma cero/);
  assert.equal(h.saved.size, 0);
  assert.equal(h.progress.at(-1).estado, "error");
});

test("Interrupción conserva los lotes confirmados y finaliza sin volver a solicitar", async () => {
  const h = harness();
  const controller = new AbortController();
  const realCommit = h.opts.commit;
  h.opts.commit = (...args) => { realCommit(...args); controller.abort(); };
  const result = await runEmbeddingQueue({ ...h.opts, signal: controller.signal });
  assert.equal(result.status, "interrumpido");
  assert.equal(h.saved.size, 2);
  assert.equal(h.calls.length, 1);
});

test("--limite 0 no usa el transporte", async () => {
  const h = harness();
  await runEmbeddingQueue({ ...h.opts, limit: 0 });
  assert.equal(h.calls.length, 0);
});
