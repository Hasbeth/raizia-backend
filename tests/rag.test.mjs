import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createReformulator, parseReformulation, createGeminiBudget } from '../src/lib/reformulation.ts';
import { buildMessages, SYSTEM_PROMPT, retrieve, supportsSubtopic, reformulateQuery } from '../src/lib/rag.ts';
import { documentMatch, legalReferences, fuseQueryHits } from '../src/lib/search.ts';

const result = { intencion: 'Acceso a educación superior', subtemas: ['cupos especiales universidad indígenas', 'financiación educación superior ICETEX'], falta: '¿En qué universidad quieres estudiar?' };
const raw = JSON.stringify(result);
const hit = (id, doc = id, extra = {}) => ({ chunkId: id, documentId: doc, ord: 0, heading: '',
  content: 'Cupos especiales universidad indígenas y financiación educación superior ICETEX.', title: 'Fuente', entity: '', docType: 'Ley', docDate: '', officialUrl: '',
  score: 1, coverage: 1, weight: 1, ...extra });

test('JSON estricto: tipos, campos, longitudes, duplicados y pregunta única', () => {
  assert.deepEqual(parseReformulation(raw), result);
  assert.equal(parseReformulation(JSON.stringify({ ...result, falta: null })).falta, null);
  for (const invalid of ['', 'null', '{}', '[]', '```json\n'+raw+'\n```', raw+' texto',
    JSON.stringify({ ...result, subtemas: ['solo uno'] }),
    JSON.stringify({ ...result, subtemas: ['Salud propia', 'salúd propia!'] }),
    JSON.stringify({ ...result, subtemas: ['', 'salud'] }),
    JSON.stringify({ ...result, subtemas: Array(5).fill('salud') }),
    JSON.stringify({ ...result, intencion: 8 }),
    JSON.stringify({ ...result, intencion: 'a'.repeat(181) }),
    JSON.stringify({ ...result, falta: '' }),
    JSON.stringify({ ...result, falta: '¿Dónde? ¿Cuándo?' }),
    JSON.stringify({ ...result, extra: true })]) assert.equal(parseReformulation(invalid), null, invalid);
});

test('Reintenta una vez el JSON vacío/inválido y envía solo los últimos dos turnos', async () => {
  const calls = [];
  const reformulate = createReformulator(async (system, input) => { calls.push({ system, input }); return calls.length === 1 ? '' : raw; });
  const profile = { group: 'Indígena', community: 'Nasa', territory: 'Cauca' };
  const history = [{ role: 'user', content: 'antiguo' }, { role: 'assistant', content: 'universidad' }, { role: 'user', content: 'costos' }];
  assert.deepEqual(await reformulate('¿Beneficios?', profile, history), result);
  assert.equal(calls.length, 2);
  assert.deepEqual(JSON.parse(calls[0].input).turnos, history.slice(-2));
  assert.deepEqual(JSON.parse(calls[0].input).perfil, profile);
  assert.match(calls[1].system, /inválida/);
});

test('La caché normaliza preguntas y separa perfiles e historial; incluye llamadas simultáneas', async () => {
  let calls = 0;
  const reformulate = createReformulator(async () => { calls++; return raw; });
  await Promise.all([reformulate('¿EDUCACIÓN?'), reformulate(' educacion ')]);
  assert.equal(calls, 1);
  await reformulate('educacion', { group: 'Otro', community: '', territory: '' });
  await reformulate('educacion', undefined, [{ role: 'user', content: 'otro contexto' }]);
  assert.equal(calls, 3);
});

test('Errores, cancelación, dos JSON inválidos y plazo total producen fallback', async () => {
  let calls = 0;
  const invalid = createReformulator(async () => { calls++; return '{}'; });
  assert.equal(await invalid('prueba'), null); assert.equal(calls, 2);
  assert.equal(await createReformulator(async () => { throw new Error('offline'); })('prueba'), null);
  let aborted;
  const slow = createReformulator(async (_s, _u, signal) => { aborted = signal; return new Promise(() => {}); }, { timeoutMs: 30 });
  const start = Date.now();
  assert.equal(await slow('prueba'), null); assert.ok(Date.now() - start < 500); assert.ok(aborted.aborted);
  const controller = new AbortController(); controller.abort();
  assert.equal(await invalid('cancelada', undefined, [], controller.signal), null);
  assert.equal(calls, 2);
});

test('Ventana móvil RPM cuenta cada intento y respeta Retry-After', () => {
  let now = 0;
  const budget = createGeminiBudget(2, () => now);
  assert.equal(budget.take(), true); assert.equal(budget.take(), true); assert.equal(budget.take(), false);
  now = 60_000; assert.equal(budget.take(), true);
  budget.block('120'); now = 120_000; assert.equal(budget.take(), false);
  now = 180_000; assert.equal(budget.take(), true);
  budget.block(null); assert.equal(budget.take(), false);
  assert.equal(budget.available(), false);
  const withReserve = createGeminiBudget(2);
  assert.equal(withReserve.take(1), true);
  assert.equal(withReserve.take(1), false);
  assert.equal(withReserve.take(), true, 'Queda un cupo para la respuesta.');
});

test('Identidad de ficha reconoce números/años y nunca confunde una norma citada', () => {
  assert.equal(documentMatch('ley 1482 de 2011 discriminación', 'Ley 1482 de 2011 — Ley Antidiscriminación'), 2);
  assert.equal(documentMatch('T-129/11', 'Sentencia T-129 de 2011 — Consulta'), 2);
  assert.equal(documentMatch('decreto 1953', 'Decreto 1953 de 2014 — Territorios'), 2);
  assert.equal(documentMatch('Ley 1751', 'Ley Estatutaria 1751 de 2015 — Salud'), 2);
  assert.equal(documentMatch('T-129/12', 'Sentencia T-129/11'), 0);
  assert.equal(documentMatch('decreto 2591', 'Decreto 306 de 1992 — Reglamenta Decreto 2591'), 0);
  assert.equal(documentMatch('ley 1482', 'Sentencia T-12/11 — cita ley 1482'), 0);
  assert.equal(documentMatch('lenguas nativas', 'Ley 1381 de 2010 — Lenguas nativas'), 1);
  assert.equal(legalReferences('SU-039/97')[0].year, 1997);
});

test('RRF multiconsulta deduplica, prioriza fichas, cubre temas y respeta cupo principal y máximo dos', () => {
  const bulk = Array.from({ length: 12 }, (_, i) => hit(i + 1, Math.floor(i / 3) + 1, { weight: 0.3 }));
  const lists = [bulk, [hit(20, 20, { documentMatch: 2 }), hit(21,20), hit(22,20), hit(23,23)],
    [hit(30,30), hit(31,31)], [hit(40,40,{weight:0.3})]];
  const hits = fuseQueryHits(lists, 9);
  assert.equal(hits.length, 9); assert.equal(hits[0].documentId, 20);
  assert.equal(new Set(hits.map(h => h.chunkId)).size, 9);
  assert.ok(hits.filter(h => h.weight >= 1).length >= 3);
  assert.ok(hits.some(h => h.queryIndexes.includes(3)));
  for (const doc of new Set(hits.map(h => h.documentId))) assert.ok(hits.filter(h => h.documentId === doc).length <= 2);
  const repeated = fuseQueryHits([[hit(70), hit(71)], [hit(71),hit(72)]],3,2,0);
  assert.equal(repeated[0].chunkId,71);
});

test('La reserva principal sobrevive a muchas fichas masivas; no fabrica resultados', () => {
  const bulk = Array.from({ length: 12 }, (_, i) => hit(i+1,i+1,{weight:0.2,documentMatch:2}));
  const hits = fuseQueryHits([bulk, [hit(90),hit(91),hit(92)]],9);
  assert.equal(hits.filter(h=>h.weight>=1).length,3);
  assert.equal(fuseQueryHits([[hit(1),hit(2,1),hit(3,1)]],9).length,2);
  assert.deepEqual(fuseQueryHits([[]]),[]);
});

test('Retrieve busca original más subtemas y degrada a una sola búsqueda ante fallo', async () => {
  const queries = [];
  const options = { topics: async () => [], search: async q => { queries.push(q); return [hit(1)]; }, reformulate: async () => result };
  const response = await retrieve('Quiero ir a universidad', '', undefined, [], options);
  assert.deepEqual(queries, ['Quiero ir a universidad', ...result.subtemas]);
  assert.deepEqual(response.subtemas,result.subtemas); assert.equal(response.clarification,null);
  queries.length=0;
  const fallback = await retrieve('Quiero ir a universidad', '', undefined, [], { ...options, reformulate: async () => { throw new Error('Gemini falló'); } });
  assert.deepEqual(queries,['Quiero ir a universidad']); assert.equal(fallback.hits.length,1); assert.deepEqual(fallback.subtemas,[]);
});

test('Consulta amplia sin respaldo pide solo aclaración; un tema respaldado permite orientación', async () => {
  const options = { topics: async () => [], search: async () => [hit(1,1,{content:'Texto ajeno sobre presupuesto de carreteras.',coverage:0.1})], reformulate: async () => result };
  const response = await retrieve('¿Qué beneficios tengo?', '', undefined, [], options);
  assert.equal(response.clarification,result.falta);
  assert.equal(supportsSubtopic(result.subtemas[0],[hit(1)]),true);
});

test('Sin Gemini configurado o en modo local la reformulación no usa red', async () => {
  const before = process.env.RAIZIA_MODO;
  process.env.RAIZIA_MODO='local';
  try { assert.equal(await reformulateQuery('¿Qué beneficios tengo?'),null); }
  finally { if(before===undefined) delete process.env.RAIZIA_MODO; else process.env.RAIZIA_MODO=before; }
});

test('Prompt orientador: tres secciones, citas, límites y aclaración contextual', () => {
  for (const section of ['Lo que te puede aplicar','Qué necesitas','Qué hacer','220 palabras','en un caso parecido, la Corte','[n]','UNA sola pregunta']) assert.ok(SYSTEM_PROMPT.includes(section),section);
  const messages=buildMessages('¿Puedo inscribirme?',[hit(1)],[],{group:'Pueblo indígena',community:'Nasa',territory:'Cauca'},result);
  assert.match(messages.at(-1).content,/FALTA: "¿En qué universidad/);
  assert.match(messages.at(-1).content,/\[1\] Fuente/);
  assert.match(messages.at(-1).content,/Nasa/);
});
