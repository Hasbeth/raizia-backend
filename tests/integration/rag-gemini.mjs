import assert from 'node:assert/strict';
Object.assign(process.env,{LLM_PROVIDER:'gemini',GEMINI_API_KEY:'test-stub-only',GEMINI_RPM:'4',RAIZIA_MODO:'test'});
const calls=[];
const parsed={tipo:'consulta',alcance:'puntual',respuesta:null,intencion:'Acceso universitario',subtemas:['cupos especiales indígenas','financiación educación superior'],falta:'¿En qué universidad quieres estudiar?'};
globalThis.fetch=async (url, options)=>{
  assert.match(url,/:generateContent$/);
  const body=JSON.parse(options.body); calls.push(body);
  assert.equal(body.generationConfig.temperature,0);
  assert.equal(body.generationConfig.responseMimeType,'application/json');
  assert.deepEqual(body.generationConfig.responseSchema.required,['tipo','alcance','respuesta','intencion','subtemas','falta']);
  if(calls.length===1) return Response.json({candidates:[{content:{parts:[{text:'{}'}]}}]});
  if(calls.length===3) return new Response('',{status:429,headers:{'retry-after':'60'}});
  return Response.json({candidates:[{content:{parts:[{text:JSON.stringify(parsed)}]}}]});
};
const {reformulateQuery,retrieve,ollamaStatus}=await import('../../src/lib/rag.ts');
assert.deepEqual(await reformulateQuery('Beneficios universidad'),parsed);
assert.equal(calls.length,2);
assert.deepEqual(await reformulateQuery(' BENEFICIOS UNIVERSIDAD? '),parsed);
assert.equal(calls.length,2);
assert.equal(await reformulateQuery('Otra consulta'),null);
assert.equal(calls.length,3);
assert.equal(await reformulateQuery('Nueva consulta bloqueada'),null);
assert.equal(calls.length,3,'El 429 debe impedir otro fetch, incluido el reintento de JSON.');
assert.equal((await ollamaStatus()).available,false,'Con cuota agotada el chat debe mostrar búsqueda sin intentar generar.');
const queries=[];
let prepared=0,embedded=0;
const result=await retrieve('¿Qué beneficios recibo?', '', undefined, [], {
  topics:async()=>[],search:async query=>{queries.push(query);return [];},
  prepare:async()=>{prepared++;return {approvedDocumentIds:[],topicDocs:new Set(),lexicalIndex:false};},
  embed:async inputs=>{embedded++;assert.deepEqual(inputs,['¿Qué beneficios recibo?']);return [null];},
});
assert.equal(prepared,1);
assert.equal(embedded,1);
const {accesos}=await import('../support/db-stub.mjs');
assert.equal(accesos,0,'El transporte no debe abrir PGlite ni PostgreSQL accidentalmente.');
assert.deepEqual(queries,['¿Qué beneficios recibo?']);
assert.deepEqual(result.subtemas,[]);
console.log('Gemini simulado: JSON, reintento, caché, 429 y fallback verificados.');
