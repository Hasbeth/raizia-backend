import path from 'node:path';
import { normalizeVector, MODEL, embeddingRequest } from './embeddings-core.mjs';
import { isLocal, dataDir } from './database.mjs';

export const EMBED_DIMS = 384;
export const LOCAL_MODEL = 'multilingual-e5-small';
export const providerName = () => process.env.EMBED_PROVIDER || 'local';
export const embeddingModel = () => providerName() === 'gemini' ? MODEL : LOCAL_MODEL;
let pipelinePromise;
let inferenceTail = Promise.resolve();
async function localPipeline() {
  pipelinePromise ??= (async () => {
    const { env, pipeline } = await import('@huggingface/transformers');
    const local = isLocal() || !process.env.VERCEL || !!process.env.RAIZIA_MODELOS_DIR;
    env.allowRemoteModels = !local;
    env.allowLocalModels = local;
    env.localModelPath = process.env.RAIZIA_MODELOS_DIR || path.join(dataDir(),'modelos');
    env.cacheDir = process.env.VERCEL ? '/tmp/raizia-modelos' : path.join(dataDir(),'model-cache');
    env.useFSCache = !local; // modelo preinstalado: no escribe en su carpeta
    return pipeline('feature-extraction', 'Xenova/'+LOCAL_MODEL, { dtype: 'q8', device: 'cpu' });
  })().catch(error => { pipelinePromise = undefined; throw error; });
  return pipelinePromise;
}
async function localEmbed(texts, query) {
  const embed = await localPipeline();
  // Una sesión ONNX por proceso; evita multiplicar memoria con consultas concurrentes.
  const operation = inferenceTail.then(async () => {
    const output = await embed(texts.map(t => (query ? 'query: ' : 'passage: ')+t), { pooling: 'mean', normalize: true });
    return texts.map((_,i) => normalizeVector(output.data.slice(i*EMBED_DIMS,(i+1)*EMBED_DIMS),EMBED_DIMS));
  });
  inferenceTail = operation.then(() => {}, () => {});
  return operation;
}
async function geminiEmbed(texts, query, signal) {
  if (isLocal()) throw new Error('Gemini deshabilitado en RAIZIA_MODO=local.');
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('Gemini no está configurado.');
  const single = query && texts.length === 1;
  const operation = single ? 'embedContent' : 'batchEmbedContents';
  const queryRequests = () => texts.map(text => ({ model: MODEL, content: { parts: [{text}] }, outputDimensionality: EMBED_DIMS, taskType: 'RETRIEVAL_QUERY' }));
  const payload = query ? (single ? queryRequests()[0] : { requests: queryRequests() })
    : embeddingRequest(texts.map(content => ({content})), EMBED_DIMS);
  const response = await fetch('https://generativelanguage.googleapis.com/v1beta/'+MODEL+':'+operation, {
    method:'POST', headers:{'Content-Type':'application/json','x-goog-api-key':key}, body:JSON.stringify(payload),
    signal: signal ? AbortSignal.any([signal,AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error('Embeddings Gemini no disponibles ('+response.status+').');
  const data = await response.json();
  const vectors = single ? [data.embedding] : data.embeddings;
  if (!Array.isArray(vectors) || vectors.length !== texts.length) throw new Error('Respuesta de embeddings incompleta.');
  return vectors.map(v => normalizeVector(v.values, EMBED_DIMS));
}
export async function embedDocuments(texts, { signal } = {}) {
  if (!texts.length) return [];
  if (process.env.RAIZIA_EMBED_DISABLED === '1') throw new Error('Embeddings deshabilitados.');
  if (!['local','gemini'].includes(providerName())) throw new Error('EMBED_PROVIDER no válido.');
  const out = [];
  for (let i=0;i<texts.length;i+=32) {
    signal?.throwIfAborted();
    const batch = texts.slice(i,i+32);
    out.push(...await (providerName() === 'local' ? localEmbed(batch,false) : geminiEmbed(batch,false,signal)));
  }
  return out;
}
const queryCache = new Map();
let unavailableUntil = 0;
export async function embedQuery(text, { signal } = {}) {
  return (await embedQueries([text], { signal }))[0];
}

/** Conserva orden, caché y degradación léxica, pero infiere juntas las consultas pendientes. */
export async function embedQueries(texts, { signal } = {}) {
  if (!texts.length) return [];
  if (process.env.RAIZIA_EMBED_DISABLED === '1' || Date.now() < unavailableUntil) return texts.map(() => null);
  const keys = texts.map(text => embeddingModel()+':'+text.trim());
  const missing = new Map(), resolved = new Map();
  keys.forEach((key, i) => {
    const hit = queryCache.get(key);
    if (hit) { queryCache.delete(key); queryCache.set(key,hit); resolved.set(key,hit); }
    else if (!missing.has(key)) missing.set(key,texts[i]);
  });
  try {
    const entries = [...missing];
    for (let i=0;i<entries.length;i+=32) {
      signal?.throwIfAborted();
      const batch = entries.slice(i,i+32);
      const inputs = batch.map(([,text]) => text);
      const vectors = await (providerName() === 'local' ? localEmbed(inputs,true) : geminiEmbed(inputs,true,signal));
      batch.forEach(([key], index) => {
        queryCache.set(key,vectors[index]); resolved.set(key,vectors[index]);
        if (queryCache.size>128) queryCache.delete(queryCache.keys().next().value);
      });
    }
  } catch {
    unavailableUntil = Date.now()+30_000;
  }
  return keys.map(key => resolved.get(key) ?? null); // El usuario sigue recibiendo búsqueda léxica.
}
