export const MODEL = "models/gemini-embedding-2";
export const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/${MODEL}:batchEmbedContents`;

export function batches(items, size = 30) {
  if (!Number.isInteger(size) || size < 1) throw new Error("Tamaño de lote inválido");
  return Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size));
}

// Ventana móvil real, contando TEXTOS incluso en peticiones fallidas. Además
// espacia los lotes para no consumir los 90 textos en una sola ráfaga.
export function rateLimit(history, count, now, limit = 90, windowMs = 60_000) {
  if (!Number.isInteger(count) || count < 1 || count > limit) throw new Error("Lote fuera del límite");
  const active = history.filter((h) => h.at > now - windowMs).sort((a, b) => a.at - b.at);
  let used = active.reduce((n, h) => n + h.count, 0);
  let availableAt = now;
  for (const h of active) {
    if (used + count <= limit) break;
    availableAt = Math.max(availableAt, h.at + windowMs);
    used -= h.count;
  }
  const last = active.at(-1);
  if (last) availableAt = Math.max(availableAt, last.at + last.count * windowMs / limit);
  return { waitMs: Math.max(0, Math.ceil(availableAt - now)), history: active };
}

export function parse429(body) {
  const error = body?.error ?? body ?? {};
  const details = Array.isArray(error.details) ? error.details : [];
  const quotaIds = details.flatMap((d) => (d.violations ?? []).map((v) => String(v.quotaId ?? v.quotaMetric ?? "")));
  const daily = quotaIds.some((id) => /per.?day|daily|requests?\/?day/i.test(id)) ||
    /per\s+day|daily\s+(?:quota|limit)|quota.*\bday\b/i.test(String(error.message ?? ""));
  const delays = details.filter((d) => String(d["@type"]).endsWith("RetryInfo")).map((d) => {
    const value = d.retryDelay;
    if (typeof value === "string" && /^\d+(?:\.\d+)?s$/.test(value)) return parseFloat(value) * 1000;
    if (value && typeof value === "object") return Number(value.seconds ?? 0) * 1000 + Number(value.nanos ?? 0) / 1e6;
    return 0;
  }).filter((n) => Number.isFinite(n) && n > 0);
  return { daily, retryMs: delays.length ? Math.ceil(Math.max(...delays)) : 60_000, quotaIds };
}

export function normalizeVector(vector, dims = vector?.length) {
  if (!vector || vector.length !== dims || !Number.isInteger(dims) || dims < 1) throw new Error("Dimensiones del vector inválidas");
  const values = Array.from(vector);
  if (values.some((x) => typeof x !== "number" || !Number.isFinite(x))) throw new Error("Vector no finito");
  const scale = Math.max(...values.map(Math.abs));
  if (!scale) throw new Error("Vector de norma cero");
  const norm = Math.sqrt(values.reduce((sum, x) => sum + (x / scale) ** 2, 0));
  return Float32Array.from(values, (x) => (x / scale) / norm);
}

// Little-endian explícito: independiente de alineación y arquitectura del host.
export function float32ToBlob(vector) {
  const blob = Buffer.alloc(vector.length * 4);
  Array.from(vector).forEach((x, i) => {
    if (!Number.isFinite(x) || !Number.isFinite(Math.fround(x))) throw new Error("Float32 no finito");
    blob.writeFloatLE(x, i * 4);
  });
  return blob;
}

export function blobToFloat32(blob, dims = blob.byteLength / 4) {
  if (!Number.isInteger(dims) || dims < 1 || blob.byteLength !== dims * 4) throw new Error("BLOB/dimensiones incompatibles");
  const buffer = Buffer.from(blob.buffer, blob.byteOffset, blob.byteLength);
  const vector = Float32Array.from({ length: dims }, (_, i) => buffer.readFloatLE(i * 4));
  if (vector.some((x) => !Number.isFinite(x))) throw new Error("BLOB no finito");
  return vector;
}

export function toPgvector(vector) {
  if (!vector.length || Array.from(vector).some((x) => !Number.isFinite(x))) throw new Error("Vector inválido para Postgres");
  return `[${Array.from(vector).join(",")}]`;
}

export function embeddingRequest(rows, dims, model = MODEL) {
  return { requests: rows.map((row) => ({
    model, content: { parts: [{ text: row.content }] }, outputDimensionality: dims,
    taskType: "RETRIEVAL_DOCUMENT", title: row.title,
  })) };
}

export function parseLimit(args) {
  if (!args.length) return Infinity;
  if (args.length !== 2 || args[0] !== "--limite" || !/^\d+$/.test(args[1]) || !Number.isSafeInteger(Number(args[1]))) {
    throw new Error("Uso: npm run embeddings -- [--limite N] (N entero no negativo)");
  }
  return Number(args[1]);
}
