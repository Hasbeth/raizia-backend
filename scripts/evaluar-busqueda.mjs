/** Evaluación offline del código real de recuperación, con corpus completo en PGlite. */
import '../tests/support/runtime.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { backfillChunkSearch } from './backfill-chunk-search.mjs';

const backend = fileURLToPath(new URL('../', import.meta.url));
process.chdir(backend);
const args = process.argv.slice(2);
if (args.some(a => !['--solo-lexico', '--recargar'].includes(a))) throw new Error('Opciones: --solo-lexico, --recargar');
const hybrid = !args.includes('--solo-lexico');
const output = path.join(backend, 'data/evaluacion');
fs.mkdirSync(output, { recursive: true });
Object.assign(process.env, {
  RAIZIA_MODO: 'local', LLM_PROVIDER: 'none', GEMINI_API_KEY: '', DATABASE_URL: '', SUPABASE_URL: '',
  EMBED_PROVIDER: 'local', RAIZIA_EMBED_DISABLED: hybrid ? '0' : '1',
  RAIZIA_PGLITE_DIR: path.join(output, 'pglite'), RAIZIA_STORAGE_DIR: path.join(output, 'storage'),
  RAIZIA_MODELOS_DIR: path.join(backend, 'data/modelos'),
});
globalThis.fetch = async () => { throw new Error('Evaluación sin red: fetch prohibido'); };
const readJSON = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const fixture = readJSON('tests/fixtures/evaluacion.json');
const stubs = readJSON('tests/fixtures/reformulaciones.json');
const { parseReformulation, createReformulator } = await import('../src/lib/reformulation.ts');
const { searchChunks, detectTopics } = await import('../src/lib/search.ts');
const { retrieve } = await import('../src/lib/rag.ts');
const { searchChunks: baseline } = await import('../tests/fixtures/search-before.ts');
const { db, closeDatabase } = await import('../src/lib/db.ts');
const { embedQuery } = await import('../src/lib/embeddings.ts');
const { loadLibrary, parseArgs } = await import('./cargar-supabase.mjs');

const source = new DatabaseSync('data/staging/biblioteca.db', { readOnly: true });
source.exec('PRAGMA query_only=ON');
const expectedDocuments = {};
try {
  for (const p of fixture.preguntas) {
    if (!parseReformulation(JSON.stringify(stubs.respuestas[p.id]))) throw new Error('Stub inválido: ' + p.id);
    for (const id of p.esperados) {
      const doc = source.prepare('SELECT id,title,status FROM documents WHERE id=?').get(id);
      if (!doc || doc.status !== 'aprobado') throw new Error('Documento esperado inexistente/no aprobado: ' + id);
      expectedDocuments[id] = doc.title;
    }
  }
} finally { source.close(); }

const fingerprint = ['biblioteca.db', 'vectores-e5.db'].map(name => {
  const s = fs.statSync('data/staging/' + name);
  return { name, bytes: s.size, mtime: s.mtimeMs };
});
const marker = path.join(output, 'corpus.json');
if (args.includes('--recargar') || !fs.existsSync(marker) || JSON.stringify(readJSON(marker)) !== JSON.stringify(fingerprint)) {
  let lastLog = 0;
  const loaded = await loadLibrary(parseArgs(['--sin-archivos', '--informe', path.join(output, 'carga.json')]), line => {
    if (Date.now() - lastLog > 15_000 || line.startsWith('Destino:')) { console.log(line); lastLog = Date.now(); }
  });
  if (loaded.failures.length) throw new Error('Carga incompleta: consultar data/evaluacion/carga.json');
  fs.writeFileSync(marker, JSON.stringify(fingerprint));
}

const report = { fecha: new Date().toISOString(), top: 6, metrica: 'Al menos un esperado en los primeros seis fragmentos; no se deduplican documentos.',
  offline: true, reformulacion: stubs.descripcion, corpus: fingerprint, esperadosVerificados: expectedDocuments,
  baselineSha256: createHash('sha256').update(fs.readFileSync('tests/fixtures/search-before.ts')).digest('hex'),
  variantes: {}, detalles: [] };
const started = Date.now();
try {
  const database = await db();
  // También migra la copia persistida de evaluaciones anteriores, sin tocar chunks.
  await backfillChunkSearch(database);
  // Las variantes repiten consultas SQL idénticas sobre un corpus inmutable.
  // Memoizar solo durante cada pregunta reduce el coste sin cambiar candidatos ni puntajes.
  const query = database.query.bind(database);
  const queryCache = new Map();
  database.query = (sql, params = []) => {
    const key = JSON.stringify([sql, params]);
    if (!queryCache.has(key)) queryCache.set(key, query(sql, params));
    return queryCache.get(key);
  };
  report.conteos = (await database.query(`SELECT (SELECT count(*)::int FROM documents) documentos,
    count(*)::int fragmentos,count(embedding)::int vectores FROM chunks`))[0];
  if (hybrid && !(await embedQuery('consulta previa'))) throw new Error('Modelo e5 local no disponible; usa --solo-lexico explícitamente.');
  for (const p of [...fixture.preguntas].sort((a,b) => Number(b.id===31)-Number(a.id===31) || a.id-b.id)) {
    queryCache.clear();
    const profile = p.perfil;
    const topics = await detectTopics(p.pregunta);
    const opts = { limit: 6, topicIds: topics.map(t => t.id), boostText: profile ? profile.community + ' ' + profile.territory : '' };
    const reformulate = createReformulator(async () => JSON.stringify(stubs.respuestas[p.id]));
    const variants = {};
    for (const mode of hybrid ? ['lexico', 'hibrido'] : ['lexico']) {
      process.env.RAIZIA_EMBED_DISABLED = mode === 'lexico' ? '1' : '0';
      variants['antes_' + mode] = await baseline(p.pregunta, opts);
      variants['despues_' + mode] = (await retrieve(p.pregunta, '', profile, [], { reformulate: async () => null })).hits.slice(0, 6);
      variants['reformulado_' + mode] = (await retrieve(p.pregunta, '', profile, [], { reformulate })).hits.slice(0, 6);
    }
    const detail = { id: p.id, tipo: p.tipo, pregunta: p.pregunta, esperados: p.esperados, resultados: {} };
    for (const [name, hits] of Object.entries(variants)) {
      const ids = hits.map(h => h.documentId);
      const hit = ids.some(id => p.esperados.includes(id));
      report.variantes[name] ??= {};
      for (const group of new Set(['total', p.id <= 30 ? 'originales30' : 'beneficios10', p.tipo])) {
        const count = report.variantes[name][group] ??= { aciertos: 0, preguntas: 0 };
        count.preguntas++; count.aciertos += Number(hit);
      }
      detail.resultados[name] = { acierto: hit, documentos: ids, fragmentos: hits.map(h => h.chunkId) };
    }
    report.detalles.push(detail);
    fs.writeFileSync(path.join(output,'progreso.json'), JSON.stringify(report,null,2)+'\n');
    console.log(`${p.id}/${fixture.preguntas.length}: ${Object.entries(detail.resultados).map(([name, r]) => name + '=' + Number(r.acierto)).join(' ')}`);
  }
  // Regresiones fuera del conjunto puntuado; no inflan la métrica.
  report.regresiones = {};
  for (const [q, expected] of [['ley 1482 de 2011 discriminación',1516], ['T-129/11',41], ['decreto 1953',29]]) {
    const hits = await searchChunks(q, { limit: 9 });
    report.regresiones[q] = { esperado: expected, primero: hits[0]?.documentId, correcto: hits[0]?.documentId === expected };
  }
  report.segundos = (Date.now() - started) / 1000;
  report.detalles.sort((a,b)=>a.id-b.id);
  const reportFile = path.join(output, hybrid ? 'resultados.json' : 'resultados-lexico.json');
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ variantes: report.variantes, regresiones: report.regresiones, informe: reportFile }, null, 2));
  if (Object.values(report.regresiones).some(r => !r.correcto)) throw new Error('Falló una regresión de prioridad por ficha.');
  if (hybrid && (report.variantes.reformulado_hibrido.originales30.aciertos < 29 ||
    report.variantes.reformulado_hibrido.beneficios10.aciertos < 10)) {
    throw new Error('Regresión de recuperación con stubs: se requieren al menos 29/30 y 10/10.');
  }
} finally { await closeDatabase(); }
