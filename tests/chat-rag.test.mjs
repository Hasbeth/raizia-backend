import assert from 'node:assert/strict';
import { test } from 'node:test';
import { routeHarness } from './support/route-harness.mjs';
import { isSmallTalk, smallTalkReply, retrieve, buildMessages, answerScope } from '../src/lib/rag.ts';
import { createReformulator } from '../src/lib/reformulation.ts';
const request = () => new Request('http://localhost/api/chat',{method:'POST',body:JSON.stringify({message:'¿Qué beneficios tengo?',history:[{role:'user',content:'universidad'},{role:'assistant',content:'programa'}]})});

const classification = (extra = {}) => ({ tipo: 'consulta', alcance: 'puntual', respuesta: null, intencion: 'Consulta ficticia', subtemas: ['tema ficticio uno', 'tema ficticio dos'], falta: null, ...extra });
const noSearch = { topics: async () => { assert.fail('No debe detectar temas ni buscar'); }, search: async () => { assert.fail('No debe buscar'); }, embed: async () => { assert.fail('No debe generar embeddings'); }, prepare: async () => { assert.fail('No debe abrir la biblioteca'); } };
const send = (POST, message, history = []) => POST(new Request('http://localhost/api/chat', { method: 'POST', body: JSON.stringify({ message, history }) }));
const eventsOf = async response => (await response.text()).trim().split('\n').map(JSON.parse);

test('hola → estas preparado: sin buscar, citar ni consumir generación; conserva invitación abierta', async () => {
  const { POST } = routeHarness({ rag: { isSmallTalk, smallTalkReply } })('chat');
  const first = await eventsOf(await send(POST, 'hola'));
  const history = [{ role: 'user', content: 'hola' }, { role: 'assistant', content: first[1].text }];
  const second = await eventsOf(await send(POST, 'estas preparado', history));
  for (const events of [first, second]) { assert.deepEqual(events[0].sources, []); assert.equal(events[0].mode, 'conversacion'); assert.doesNotMatch(events[1].text, /\[\d+\]|Lo que te puede aplicar|derechos territoriales/i); }
  assert.match(second[1].text, /Sí, aquí estoy/); assert.doesNotMatch(second[1].text, /Hola/);
  assert.equal((await retrieve('estas preparado', '', undefined, history, { ...noSearch, reformulate: async () => assert.fail('Atajo sin Gemini') })).reply, second[1].text);
});

test('La llamada de reformulación clasifica charla y ambiguo antes de cualquier búsqueda', async () => {
  for (const [tipo, respuesta, falta, message] of [['charla', 'Con gusto, te escucho. Cuéntame lo que tienes en mente.', null, 'Me alegra poder hablar contigo'], ['ambiguo', null, '¿Qué te gustaría resolver?', 'Necesito saber sobre eso']]) {
    let calls = 0;
    const reformulate = createReformulator(async (system, input) => {
      calls++; assert.match(system, /ANTES de buscar/); assert.equal(JSON.parse(input).pregunta, message);
      return JSON.stringify(classification({ tipo, respuesta, falta, subtemas: [] }));
    });
    const result = await retrieve(message, '', undefined, [], { ...noSearch, reformulate });
    assert.equal(calls, 1); assert.equal(result.reply, respuesta || falta); assert.deepEqual(result.sources, []);
    const { POST } = routeHarness({ rag: { isSmallTalk: () => false, retrieve: async () => result } })('chat');
    const events = await eventsOf(await send(POST, message));
    assert.equal(events[1].text, result.reply); assert.deepEqual(events[0].sources, []);
  }
  const unsafe = await retrieve('Háblame de ti', '', undefined, [], { ...noSearch, reformulate: async () => classification({ tipo: 'charla', subtemas: [], respuesta: 'La Ley 999 te da 30 días.' }) });
  assert.doesNotMatch(unsafe.reply, /Ley|30|días/);
});

test('Seguimiento resuelve el plazo del tema anterior y el generador recibe solo ese alcance', async () => {
  const history = [{ role: 'user', content: 'Presenté una solicitud ficticia de documentos.' }, { role: 'assistant', content: 'Hablamos de la respuesta a esa solicitud ficticia.' }];
  const follow = classification({ tipo: 'seguimiento', intencion: 'Plazo de respuesta a solicitud de documentos', subtemas: ['plazo respuesta documentos', 'término solicitud documentos'] });
  const queries = [];
  const result = await retrieve('¿y qué plazo tiene?', history[0].content, undefined, history, {
    reformulate: async (_message, _profile, turns) => { assert.deepEqual(turns, history); return follow; },
    topics: async () => [], embed: async inputs => inputs.map(() => null), prepare: async () => ({ approvedDocumentIds: [], topicDocs: new Set(), lexicalIndex: false }), hydrate: async hits => hits,
    search: async query => { queries.push(query); return []; },
  });
  assert.equal(queries[0], follow.intencion); assert.equal(result.reformulation.tipo, 'seguimiento');
  const messages = buildMessages('¿y qué plazo tiene?', [], history, undefined, follow);
  assert.match(messages[0].content, /ALCANCE: puntual.*SEGUIMIENTO: responde SOLO/);
  assert.match(messages.at(-1).content, /INTENCIÓN.*Plazo de respuesta/);
});

test('Pregunta concreta sin encabezados; caso completo con secciones y reglas de fuentes intactas', () => {
  for (const alcance of ['puntual', 'completa']) {
    const messages = buildMessages('CONSULTA FICTICIA', [], [], undefined, classification({ alcance }));
    assert.match(messages[0].content, new RegExp(`ALCANCE: ${alcance}`));
    assert.match(messages[0].content, /1 a 3 párrafos con citas, SIN encabezados/);
    assert.match(messages[0].content, /SOLO si pide orientación completa.*tres secciones/);
    assert.match(messages[0].content, /Nunca inventes normas/);
  }
  assert.equal(answerScope('¿Qué plazo tiene?'), 'puntual');
  assert.equal(answerScope('CASO FICTICIO: ¿qué puedo hacer?'), 'completa');
});

test('Clasificación fallida conserva charla segura y la búsqueda disponible para consultas', async () => {
  const unknown = await retrieve('no sé', '', undefined, [], { ...noSearch, reformulate: async () => { throw new Error('sin conexión'); } });
  assert.equal(unknown.reply, '¿Qué te gustaría contarme o resolver?');
  const queries = [];
  await retrieve('¿Cuál es el plazo de respuesta a una petición ficticia?', '', undefined, [], { reformulate: async () => null, topics: async () => [], embed: async inputs => inputs.map(() => null), prepare: async () => ({ approvedDocumentIds: [], topicDocs: new Set(), lexicalIndex: false }), hydrate: async hits => hits, search: async q => { queries.push(q); return []; } });
  assert.equal(queries.length, 1);
});

test('Meta contiene subtemas, aclaración es el único token y evita generar información jurídica', async () => {
  const question='¿Qué tipo de apoyo necesitas?';
  const { POST }=routeHarness({tools:{suggestTool:()=>null},rag:{isSmallTalk:()=>false,retrieve:async (_m,_p,_profile,history)=>{
    assert.equal(history.length,2);
    return {topics:[],hits:[{}],sources:[{}],subtemas:['tema uno','tema dos'],reformulation:null,clarification:question};
  }}})('chat');
  const events=(await (await POST(request())).text()).trim().split('\n').map(JSON.parse);
  assert.deepEqual(events,[{type:'meta',mode:'conversacion',topics:[],sources:[],subtemas:['tema uno','tema dos']},{type:'token',text:question},{type:'done'}]);
});

test('El flujo con fuentes pasa la reformulación al generador y solo expone subtemas en meta', async () => {
  const reformulation={intencion:'estudiar',subtemas:['cupos','financiación'],falta:'¿Dónde?'};
  const {POST}=routeHarness({tools:{suggestTool:()=>null},rag:{isSmallTalk:()=>false,
    retrieve:async()=>({topics:[],hits:[{}],sources:[{n:1}],subtemas:reformulation.subtemas,reformulation,clarification:null}),
    ollamaStatus:async()=>({available:true,model:'stub'}),
    generateAnswer:async function* (...args){assert.deepEqual(args[7],reformulation);yield 'Puedes consultar estas opciones [1].';},
  }})('chat');
  const events=(await(await POST(request())).text()).trim().split('\n').map(JSON.parse);
  assert.deepEqual(events[0].subtemas,reformulation.subtemas);
  assert.equal(events[1].text,'Puedes consultar estas opciones [1].');
  assert.equal(events.at(-1).type,'done');
});
