import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveIdentity, mentionedGroups } from '../src/lib/identity.ts';
import { sourceKind, populationAllowed, racialPriority } from '../src/lib/source-policy.ts';
import { retrieve, buildMessages, generateAnswer } from '../src/lib/rag.ts';
import { verifyClaims, verifyAnswer } from '../src/lib/citation-verification.ts';
import { orientWithLibrary, parseOrientation, fallbackOrientation, explicitDanger, originMotiveNote, FALLBACK_NOTICE } from '../src/lib/orientation.ts';
import { DEFS } from '../src/lib/triage.ts';
import * as orientation from '../src/lib/orientation.ts';
import { moduleHarness } from './support/module-harness.mjs';

const profile = Object.freeze({ group: 'Pueblo indígena', community: 'Nasa', territory: '' });
const story = 'Estoy pasando por un caso de discriminación por la ciudad de donde soy y quiero tomar medidas legales con las personas que me están discriminando.';
const racial = 'Un policía me está discriminando por ser negro';
const hit = (id, extra = {}) => ({ chunkId: id, documentId: id, ord: 0, heading: 'Artículo 1', content: 'Todas las personas tienen derecho a presentar peticiones respetuosas a las autoridades.', title: 'Ley de prueba', entity: 'Entidad ficticia', docType: 'Ley', docDate: '2025-01-01', officialUrl: 'https://example.org/fuente', score: 1, coverage: 1, weight: 1, ...extra });
const library = hits => ({ hits, sources: hits.map((h, i) => ({ ...h, n: i + 1 })), topics: [], subtemas: [], reformulation: null, clarification: null });
const plan = { entendi: [story], hechos_faltantes: ['Autor', 'Conducta', 'Lugar', 'Amenazas, repetición y pruebas'], preguntas: [
  { texto: '¿Quién lo hace?', opciones: ['Una persona', 'En el trabajo', 'En redes'] },
  { texto: '¿Qué hicieron o dijeron y dónde ocurrió?' },
], urgencia: 'normal', rutas: [] };
const retrievalOptions = { topics: async () => [], embed: async qs => qs.map(() => null), prepare: async () => ({ approvedDocumentIds: [], topicDocs: new Set(), lexicalIndex: false }), hydrate: async hs => hs, reformulate: async () => null };

test('Identidad: mensaje actual manda, tercero no se atribuye, ausencia usa perfil y últimas menciones ganan', () => {
  const before = JSON.stringify(profile);
  const own = resolveIdentity(racial, profile);
  assert.deepEqual(own.groups, ['narp']); assert.equal(own.attribution, 'identificacion'); assert.ok(own.question);
  assert.equal(own.effectiveProfile.community, '');
  for (const q of ['¿Qué derechos tienen las comunidades negras?', 'Mi vecino es afrocolombiano', 'Mi vecino es discriminado por ser negro']) {
    const subject = resolveIdentity(q, profile);
    assert.deepEqual(subject.groups, ['narp']); assert.equal(subject.attribution, 'tema_o_tercero'); assert.equal(subject.question, undefined);
  }
  assert.deepEqual(resolveIdentity('¿Cómo pido información?', profile).effectiveProfile, profile);
  assert.deepEqual(resolveIdentity('¿Y dónde?', profile, [{ role: 'user', content: 'Soy afro' }]).groups, ['narp']);
  assert.deepEqual(resolveIdentity('Soy campesino', profile, [{ role: 'user', content: 'Soy afro' }]).groups, ['campesino']);
  assert.deepEqual(mentionedGroups('Mi vecino es Wayuu'), ['indigena']);
  assert.deepEqual(mentionedGroups('Soy gitano'), ['rrom']);
  assert.deepEqual(mentionedGroups('Línea Negra de la Sierra Nevada'), []);
  assert.deepEqual(mentionedGroups('No soy indígena. Soy raizal'), ['narp']);
  assert.deepEqual(resolveIdentity('No soy indígena', profile).groups, []);
  assert.equal(JSON.stringify(profile), before);
  assert.equal(resolveIdentity('Orientarme para comunidades negras, afrocolombianas, raizales y palenqueras', profile).question, undefined);
  const expanded = racial + '\n\n¿Quieres orientación indígena, negra o ambas?\nOrientarme para comunidades negras\n\n¿Qué dijeron?\nNo me dejaron entrar';
  assert.deepEqual(resolveIdentity(expanded, profile).groups, ['narp']);
  assert.equal(resolveIdentity(expanded, profile).question, undefined);
  const both = resolveIdentity('¿Y cómo lo solicito?', profile, [{role:'user',content:racial},{role:'user',content:'Orientarme para ambos grupos'}]);
  assert.deepEqual(both.groups.sort(), ['indigena','narp']); assert.equal(both.question, undefined);
});

test('Reformulación y búsqueda reciben NARP, excluyen CEDAW/Belém, reservan prioridad racial top 3', async () => {
  let effective;
  const hs = [hit(1, { title: 'Ley 51 de 1981 CEDAW' }), hit(2, { title: 'Ley 248 de 1995 Belém do Pará' }),
    hit(3, { title: 'Ley 70 de 1993 comunidades negras' }), hit(4, { title: 'Ley 1482 de 2011', content: 'Artículo 134A. Actos de discriminación racial.' }),
    hit(5, { title: 'Decreto Ley 4635 de 2011 víctimas' }), hit(6)];
  const queries = [];
  const result = await retrieve(racial, '', profile, [], { ...retrievalOptions,
    reformulate: async (_q, p) => { effective = p; return null; },
    search: async (q, opts) => { queries.push(q); assert.doesNotMatch(opts.boostText || '', /indígena|Nasa/); return hs; },
  });
  assert.match(effective.group, /negras/); assert.ok(queries.some(q => q.includes('Ley 70')));
  assert.ok(result.hits.every(h => ![1, 2, 5].includes(h.documentId)));
  assert.ok(result.hits.some(h => h.documentId === 3)); assert.ok(result.hits.slice(0, 3).some(h => racialPriority(h) >= 2));
  const messages = buildMessages(racial, result.hits, [], profile);
  assert.doesNotMatch(messages[0].content, /Como integrante de un pueblo indígena/);
  assert.match(messages.at(-1).content, /tema|identificacion/);
});

test('Comparación reserva fuentes de ambos grupos y no transfiere derechos', async () => {
  const hs = [...Array.from({length: 12}, (_, i) => hit(i + 1)), hit(40, { title: 'Ley 70 de 1993 comunidades negras' }), hit(41, { title: 'Derechos de pueblos indígenas' })];
  const result = await retrieve('Compara derechos afrocolombianos con mi perfil indígena', '', profile, [], { ...retrievalOptions, search: async () => hs });
  assert.ok(result.hits.some(h => h.documentId === 40)); assert.ok(result.hits.some(h => h.documentId === 41));
  const wrong = await verifyClaims([{ text: 'Las comunidades negras reciben la exoneración del servicio militar.', citations: [1] }], [hit(1, { title: 'Exoneración indígena', content: 'Los indígenas reciben la exoneración del servicio militar.' })]);
  assert.deepEqual(wrong[0].citations, []);
});

test('Contexto ocupa hasta dos de nueve sin desplazar norma principal; tipo no depende de peso', async () => {
  const main = Array.from({ length: 9 }, (_, i) => hit(i + 1));
  const contexts = [hit(20, { docType: 'Boletín', weight: .2 }), hit(21, { docType: 'Guía', weight: .2 }), hit(22, { docType: 'Caso', weight: .1 })];
  const r = await retrieve('¿Cómo se hace el trámite?', '', undefined, [], { ...retrievalOptions, search: async (_q, opts) => opts.sourceKind === 'contexto' ? contexts : main });
  assert.equal(r.hits.length, 9); assert.equal(r.hits[0].documentId, 1); assert.equal(r.sources.filter(h => h.kind === 'contexto').length, 2);
  assert.ok(r.hits.filter(h => h.weight >= 1).length >= 3);
  assert.equal(sourceKind(hit(1, { docType: 'Sentencia', weight: .2 })), 'jurisprudencia');
  const c = hit(1, { docType: 'Boletín', content: 'La oficina recibió 20 solicitudes durante enero.' });
  assert.match(await verifyAnswer('La oficina recibió 20 solicitudes durante enero [1].', [c]), /Qué ha pasado en casos parecidos[\s\S]*Según boletín de Entidad ficticia \(2025-01-01\), a esa fecha/);
  assert.doesNotMatch(await verifyAnswer('Todas las personas deben presentar peticiones respetuosas a las autoridades [1].', [hit(1, { docType: 'Boletín' })]), /deben presentar/);
});

test('Orientador usa IA con biblioteca para relato discriminatorio, pregunta sin inventar hechos', async () => {
  let calls = 0, retrieved = 0;
  const r = await orientWithLibrary({ text: story, profile }, { retrieve: async () => { retrieved++; return library([hit(1)]); }, ask: async (prompt, data) => {
    calls++; assert.match(prompt, /ciudad o región/); assert.equal(JSON.parse(data).relato, story); return JSON.stringify(plan);
  } });
  assert.equal(calls, 1); assert.equal(retrieved, 1); assert.equal(r.fallback, false);
  assert.deepEqual(r.entendi, [story]); assert.equal(r.preguntas.length, 2); assert.deepEqual(r.routes, []);
  assert.doesNotMatch(JSON.stringify(r), /agresión|por ser indígena/);
  const hallucination = await orientWithLibrary({ text: story }, { retrieve: async () => library([]), ask: async () => JSON.stringify({ ...plan, entendi: ['Hubo una agresión por ser indígena'] }) });
  assert.deepEqual(hallucination.entendi, [story]);
});

test('Peligro explícito siempre conserva 123 y atención urgente, incluso sin cupo o IA', async () => {
  for (const text of ['Estoy en peligro ahora', 'Me van a matar', 'No puedo respirar']) {
    assert.ok(explicitDanger(text));
    assert.match(fallbackOrientation(text).emergency, /123.*atención urgente/);
  }
  assert.equal(explicitDanger('No estoy en peligro y no hay violencia'), false);
  const r = await orientWithLibrary({ text: 'Me están golpeando ahora' }, { retrieve: async () => library([]), ask: async () => JSON.stringify(plan) });
  assert.equal(r.urgencia, 'inmediata'); assert.match(r.emergency, /123/);
});

test('JSON estricto, un reintento, ids cerrados, citas inexistentes, timeout y respaldo visible', async () => {
  let calls = 0;
  const deps = { retrieve: async () => library([hit(1)]), ask: async () => { calls++; return calls === 1 ? '{' : JSON.stringify(plan); } };
  assert.equal((await orientWithLibrary({ text: story }, deps)).fallback, false); assert.equal(calls, 2);
  const invalidRoute = { id: 'inventado', por_que: 'Texto', pasos: [], citas: [1], condicion: 'Si ocurre' };
  assert.equal(parseOrientation(JSON.stringify({ ...plan, rutas: [invalidRoute] }), 1), null);
  assert.equal(parseOrientation(JSON.stringify({ ...plan, extra: true }), 1), null);
  const parsed = parseOrientation(JSON.stringify({ ...plan, rutas: [{ ...invalidRoute, id: 'peticion', citas: [1, 99, -1] }] }), 1);
  assert.deepEqual(parsed.rutas[0].citas, [1]);
  for (const ask of [async () => '{}', async () => { throw Error('stub'); }, async () => new Promise(() => {})]) {
    const start = Date.now(); const r = await orientWithLibrary({ text: story }, { retrieve: deps.retrieve, ask, timeoutMs: 20 });
    assert.equal(r.notice, FALLBACK_NOTICE); assert.ok(Date.now() - start < 500);
  }
});

test('Rutas toman títulos y herramientas de DEFS; cada campo se valida contra evidencia', async () => {
  const source = hit(1);
  const route = { id: 'peticion', por_que: source.content + ' [1]', condicion: 'Si presentas peticiones respetuosas a las autoridades [1]', pasos: [source.content + ' [1]'], citas: [1, 99] };
  const r = await orientWithLibrary({ text: 'Quiero presentar una petición a una entidad ficticia.' }, {
    retrieve: async () => library([source]), ask: async (_prompt, data) => {
      const value = JSON.parse(data);
      return value.claims ? JSON.stringify({ claims: value.claims.map((_, index) => ({ index, citations: [{ n: 1, quote: source.content }] })) }) : JSON.stringify({ ...plan, preguntas: [], rutas: [route] });
    },
  });
  assert.equal(r.routes[0].title, DEFS.peticion.title); assert.deepEqual(r.routes[0].tool, DEFS.peticion.tool);
  assert.deepEqual(r.routes[0].citations, [1]); assert.equal(r.routes[0].sources[0].officialUrl, source.officialUrl);
});

test('Verificación repara cita, elimina afirmación sin respaldo y falla en menos de tres segundos', async () => {
  const sources = [hit(1, { content: 'Texto ajeno al derecho consultado.' }), hit(2)];
  const claim = { text: sources[1].content, citations: [1] };
  const verified = await verifyClaims([claim], sources, async () => JSON.stringify({ claims: [{ index: 0, citations: [{ n: 2, quote: sources[1].content }] }] }));
  assert.deepEqual(verified[0].citations, [2]);
  const forged = await verifyClaims([claim], sources, async () => JSON.stringify({ claims: [{ index: 0, citations: [{ n: 2, quote: 'Una frase que la fuente jamás escribió.' }] }] }));
  assert.deepEqual(forged[0].citations, []);
  assert.deepEqual((await verifyClaims([{text: 'La entidad debe responder en 48 horas.', citations:[2]}], sources))[0].citations, []);
  const start = Date.now(); const r = await verifyClaims([{...claim,citations:[2,99]}], sources, async () => new Promise(() => {}), undefined, 20);
  assert.ok(Date.now() - start < 500); assert.deepEqual(r[0].citations, [2]);
});

test('Límite compartido del orientador evita recuperación y Gemini, con respaldo y Retry-After', async () => {
  let counts = 0;
  const { POST } = moduleHarness('../../src/rutas/tools/orientar/route.ts', {
    '@/lib/orientation': orientation, '@/lib/rag': {}, '@/lib/rate-limit': { checkChatLimit: async () => { counts++; return {allowed:false,retryAfter:60}; }, CHAT_LIMIT_MESSAGE: 'Límite de prueba' },
  });
  const response = await POST(new Request('http://localhost/api/tools/orientar', { method: 'POST', body: JSON.stringify({ text: 'Me están golpeando ahora' }) }));
  assert.equal(counts, 1); assert.equal(response.headers.get('Retry-After'), '60');
  const result = await response.json(); assert.equal(result.notice, FALLBACK_NOTICE); assert.match(result.emergency, /123/);
});

test('Chat no muestra inicio indígena ni citas no verificadas con perfil contradictorio', async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  const source = hit(1, { content: 'Las comunidades negras tienen derecho a la protección de su identidad cultural.', title: 'Ley 70 de 1993' });
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    assert.match(body.messages.at(-1).content, /comunidades negras/);
    return new Response(JSON.stringify({ message: { content: 'Como integrante de un pueblo indígena, tienes beneficios automáticos [1].\nLas comunidades negras tienen derecho a la protección de su identidad cultural [1].' } }) + '\n');
  };
  let text = ''; for await (const piece of generateAnswer('stub', racial, [source], [], undefined, profile)) text += piece;
  assert.doesNotMatch(text, /Como integrante de un pueblo indígena|beneficios automáticos/);
  assert.match(text, /comunidades negras/); assert.match(text, /¿Quieres que te oriente/);
});

test('Fuentes de mujeres y niñez solo se activan por contexto pertinente', () => {
  const ctx = {identity:resolveIdentity(racial,profile),text:racial};
  assert.equal(populationAllowed(hit(1,{title:'Convención contra discriminación de la mujer'}),ctx),false);
  assert.equal(populationAllowed(hit(1,{title:'Código de infancia y adolescencia'}),ctx),false);
  assert.equal(populationAllowed(hit(1,{title:'Constitución Política'}),ctx),true);
});

test('Motivo ciudad: no se equipara nacionalidad a origen regional ni se niegan otros caminos', () => {
  const note = originMotiveNote(story, library([hit(1, { content: 'Actos de discriminación por raza, nacionalidad o sexo.' })]));
  assert.match(note, /no aparece expresamente.*ciudad o región/); assert.match(note, /\[1\]/); assert.match(note, /no.*descarta otros caminos/);
  assert.equal(originMotiveNote(story, library([hit(1, { content: 'Discriminación por ciudad de origen.' })])), undefined);
});

test('PGlite real: filtros de población antes del cupo y búsqueda separada de contexto', async () => {
  const { createDatabase } = await import('../scripts/lib/database.mjs');
  const timings = await import('../src/lib/timings.ts');
  const database = await createDatabase({ memory: true, url: '' });
  try {
    const docs = [
      [1, 'Ley 1482 de 2011', 'Ley', 1, 'Actos de discriminación racial por ser negro.'],
      [2, 'Ley 51 de 1981 CEDAW', 'Ley', 1, 'Discriminación racial contra la mujer.'],
      [3, 'Ley 248 de 1995 Belém do Pará', 'Ley', 1, 'Discriminación racial contra la mujer.'],
      [4, 'Boletín ficticio de trámites', 'Boletín', .2, 'Cómo hacer el trámite ante discriminación racial.'],
    ];
    for (const [id, title, type, weight, content] of docs) {
      await database.query("INSERT INTO documents(id,title,doc_type,weight,status) VALUES($1,$2,$3,$4,'aprobado')", [id,title,type,weight]);
      await database.query("INSERT INTO chunks(id,document_id,ord,heading,content,content_hash) VALUES($1,$1,0,'Artículo de prueba',$2,$3)", [id,content,String(id)]);
    }
    const search = moduleHarness('../../src/lib/search.ts', {
      './db': { all: (sql,...params) => database.query(sql,params) }, './embeddings': {}, './storage': {}, './constants': {}, './timings': timings,
    });
    const context = await search.prepareSearchContext([]);
    const opts = { context, vector: null, hydrate: false, limit: 9, population: { identity:resolveIdentity(racial,profile), text:racial } };
    const hits = await search.searchChunks('discriminación racial',opts);
    assert.ok(hits.some(h => h.documentId === 1)); assert.ok(hits.every(h => ![2,3].includes(h.documentId)));
    const contexts = await search.searchChunks('trámite discriminación racial', {...opts,sourceKind:'contexto'});
    assert.deepEqual(contexts.map(h=>h.documentId),[4]);
  } finally { await database.close(); }
});

test('Conserva pasos prácticos sin cita y no deja secciones vacías', async () => {
  const source = hit(1);
  const out = await verifyAnswer('**Qué hacer**\nLleva tus documentos al juzgado más cercano.\n¿Ya hablaste con la entidad?', [source]);
  assert.match(out, /\*\*Qué hacer\*\*/); assert.match(out, /Lleva tus documentos/);
  const inventado = await verifyAnswer('**Qué hacer**\nTienes un plazo de 30 días según la Ley 9999.', [source]);
  assert.doesNotMatch(inventado, /9999/);
  const vacia = await verifyAnswer('**Qué necesitas**\n¿Ya hablaste con la entidad?', [source]);
  assert.doesNotMatch(vacia, /Qué necesitas/); assert.match(vacia, /¿Ya hablaste/);
});
