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
  const operation = query ? 'embedContent' : 'batchEmbedContents';
  const payload = query ? { model: MODEL, content: { parts: [{text:texts[0]}] }, outputDimensionality: EMBED_DIMS, taskType: 'RETRIEVAL_QUERY' }
    : embeddingRequest(texts.map(content => ({content})), EMBED_DIMS);
  const response = await fetch('https://generativelanguage.googleapis.com/v1beta/'+MODEL+':'+operation, {
    method:'POST', headers:{'Content-Type':'application/json','x-goog-api-key':key}, body:JSON.stringify(payload),
    signal: signal ? AbortSignal.any([signal,AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error('Embeddings Gemini no disponibles ('+response.status+').');
  const data = await response.json();
  const vectors = query ? [data.embedding] : data.embeddings;
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
  if (process.env.RAIZIA_EMBED_DISABLED === '1' || Date.now() < unavailableUntil) return null;
  const key = embeddingModel()+':'+text.trim();
  const hit = queryCache.get(key);
  if (hit) { queryCache.delete(key); queryCache.set(key,hit); return hit; }
  try {
    const [vector] = await (providerName() === 'local' ? localEmbed([text],true) : geminiEmbed([text],true,signal));
    queryCache.set(key,vector);
    if (queryCache.size>128) queryCache.delete(queryCache.keys().next().value);
    return vector;
  } catch {
    unavailableUntil = Date.now()+30_000;
    return null; // El usuario sigue recibiendo búsqueda léxica.
  }
}
