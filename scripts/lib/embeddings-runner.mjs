import { embeddingRequest, float32ToBlob, normalizeVector, parse429, rateLimit, ENDPOINT, MODEL } from "./embeddings-core.mjs";

// Dependencias inyectadas: las pruebas no necesitan red, SQLite, claves ni reloj real.
export async function runEmbeddingQueue({ take, commit, counts, persist, request, wait, now = Date.now,
  signal, apiKey, dims = 384, batchSize = 30, limit = Infinity, history = [], log = console.log }) {
  if (!Number.isInteger(batchSize) || batchSize < 20 || batchSize > 50) throw new Error("EMBED_BATCH debe estar entre 20 y 50");
  const started = now();
  let completed = 0;
  let lastError = null;
  let phase = "principal";
  let attempts = history.filter((h) => Number.isFinite(h.at) && Number.isInteger(h.count) && h.count > 0 && h.count <= 90);
  let stats = counts();
  const progress = (status, extra = {}) => {
    stats = counts();
    const elapsedMinutes = (now() - started) / 60_000;
    const speed = elapsedMinutes > 0 ? completed / elapsedMinutes : 0;
    const remaining = stats.total - stats.done;
    const scopeRemaining = Math.min(remaining, limit - completed);
    const etaRate = Math.min(90, speed);
    const value = {
      updated_at: new Date(now()).toISOString(), model: MODEL, dims, estado: status,
      hechos: stats.done, total: stats.total, porcentaje: stats.total ? stats.done / stats.total * 100 : 100,
      hechos_sesion: completed, limite: Number.isFinite(limit) ? limit : null,
      ritmo_textos_min: speed, eta_segundos: etaRate > 0 ? Math.ceil(remaining / etaRate * 60) : null,
      eta_sesion_segundos: etaRate > 0 ? Math.ceil(scopeRemaining / etaRate * 60) : null,
      fase: phase, ultimo_error: lastError, solicitudes_recientes: attempts, ...extra,
    };
    persist(value);
    return value;
  };
  progress("iniciando");
  while (completed < limit && !signal?.aborted) {
    let rows = take(Math.min(batchSize, limit - completed));
    if (!rows.length) break;
    const principal = rows[0].weight >= 1;
    rows = rows.filter((row) => (row.weight >= 1) === principal);
    phase = principal ? "principal" : "masivas";
    let retries = 0;
    while (!signal?.aborted) {
      const rate = rateLimit(attempts, rows.length, now());
      attempts = rate.history;
      if (rate.waitMs) {
        progress("esperando_limite", { espera_ms: rate.waitMs });
        await wait(rate.waitMs, signal);
        if (signal?.aborted) break;
        continue;
      }
      attempts.push({ at: now(), count: rows.length });
      progress("solicitando"); // Persistir cuota consumida incluso si se interrumpe o falla el HTTP.
      let response;
      let body;
      try {
        response = await request(ENDPOINT, {
          method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
          body: JSON.stringify(embeddingRequest(rows, dims)), signal,
        });
        body = await response.json();
      } catch {
        if (signal?.aborted) break;
        lastError = "Fallo de red, timeout o respuesta JSON inválida; el lote sigue pendiente";
        retries++;
        progress("reintentando");
        if (retries > 8) throw new Error(lastError);
        await wait(Math.min(300_000, 5000 * 2 ** (retries - 1)), signal);
        continue;
      }
      if (!response.ok) {
        if (response.status === 429) {
          const quota = parse429(body);
          if (quota.daily) {
            lastError = "cuota diaria agotada, reintentar mañana";
            progress("cuota_diaria_agotada");
            log(lastError);
            return { status: "daily_quota", completed };
          }
          lastError = `HTTP 429: límite temporal; espera ${Math.ceil(quota.retryMs / 1000)} s`;
          retries++;
          progress("esperando_429", { espera_ms: quota.retryMs });
          if (retries > 8) throw new Error("HTTP 429 persistente tras 8 reintentos; avance guardado");
          log(lastError);
          await wait(quota.retryMs, signal);
          continue;
        }
        lastError = `Gemini respondió HTTP ${response.status}; el lote sigue pendiente`;
        progress("error");
        if (response.status >= 500 && ++retries <= 8) {
          await wait(Math.min(300_000, 5000 * 2 ** (retries - 1)), signal);
          continue;
        }
        throw new Error(lastError);
      }
      try {
        if (!Array.isArray(body.embeddings) || body.embeddings.length !== rows.length) throw new Error("Cantidad de embeddings inesperada");
        // Se valida TODO el lote antes de guardar: nunca queda un lote parcialmente confirmado.
        const vectors = body.embeddings.map((e) => float32ToBlob(normalizeVector(e.values, dims)));
        commit(rows, vectors, new Date(now()).toISOString());
      } catch (error) {
        lastError = error.message;
        progress("error");
        throw error;
      }
      completed += rows.length;
      lastError = null;
      const p = progress("procesando");
      log(`${p.hechos}/${p.total} (${p.porcentaje.toFixed(2)} %); ${phase}; ${p.ritmo_textos_min.toFixed(1)} textos/min; ETA ${p.eta_segundos === null ? "calculando" : `${Math.ceil(p.eta_segundos / 60)} min`}`);
      break;
    }
  }
  const status = signal?.aborted ? "interrumpido" : counts().done >= counts().total ? "completo" : "limite_alcanzado";
  progress(status);
  log(`${status}: ${completed} vectores guardados en esta ejecución`);
  return { status, completed };
}
