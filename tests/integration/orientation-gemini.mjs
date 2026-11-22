import assert from 'node:assert/strict';
Object.assign(process.env, { LLM_PROVIDER:'gemini', GEMINI_API_KEY:'test-stub-only', GEMINI_RPM:'30', RAIZIA_MODO:'test' });
const source = { chunkId:1, documentId:1, ord:0, heading:'Artículo sintético', content:'Las comunidades negras tienen derecho a la protección de su identidad cultural.', title:'Ley 70 de 1993', entity:'Entidad ficticia', docType:'Ley', docDate:'', officialUrl:'https://example.org/fuente', score:1, coverage:1, weight:1 };
const calls = [];
let orientationAttempts = 0;
globalThis.fetch = async (url, options) => {
  const body = JSON.parse(options.body);
  calls.push(body);
  assert.match(url, /generativelanguage.googleapis.com/);
  if (url.includes('streamGenerateContent')) return new Response('data: '+JSON.stringify({ candidates:[{content:{parts:[{text:source.content+' [1] Esa garantía aplica en asuntos distintos [1].'}]}}] })+'\n\n');
  assert.equal(body.generationConfig.responseMimeType,'application/json');
  assert.equal(body.generationConfig.temperature,0);
  const input = JSON.parse(body.contents.at(-1).parts[0].text);
  let result;
  if (input.claims) {
    assert.deepEqual(body.generationConfig.responseSchema.required,['claims']);
    result = { claims:input.claims.map((_,index)=>({index,citations:[{n:1,quote:source.content}]})) };
  } else {
    orientationAttempts++;
    assert.deepEqual(body.generationConfig.responseSchema.required,['entendi','hechos_faltantes','preguntas','urgencia','rutas']);
    assert.equal(input.identidad.groups[0],'narp');
    result = { entendi:[input.relato], hechos_faltantes:['Conducta'], preguntas:[{texto:'¿Qué hizo o dijo?'}], urgencia:'normal', rutas:[] };
  }
  return Response.json({candidates:[{content:{parts:[{text:JSON.stringify(result)}]}}]});
};
const { askGeminiJSON, generateAnswer } = await import('../../src/lib/rag.ts');
const { orientWithLibrary } = await import('../../src/lib/orientation.ts');
const profile = Object.freeze({group:'Pueblo indígena',community:'Nasa',territory:''});
const text = 'Un policía me está discriminando por ser negro';
const result = await orientWithLibrary({ text, profile }, { retrieve:async()=>({hits:[source],sources:[{...source,n:1}],topics:[],subtemas:[],reformulation:null,clarification:null}), ask:askGeminiJSON });
assert.equal(result.fallback,false); assert.equal(orientationAttempts,1); assert.equal(result.preguntas.length,2);

let answer='';
for await (const part of generateAnswer('stub',text,[source],[],undefined,profile)) answer+=part;
assert.match(answer,/comunidades negras/); assert.doesNotMatch(answer,/Como integrante de un pueblo indígena/);
assert.match(answer,/\[1\]/); assert.match(answer,/¿Quieres que te oriente/);
assert.equal(calls.length, 2, 'Una generación por acción; verificación local');
assert.ok(!calls.some(c=>c.generationConfig.responseSchema?.required?.[0]==='claims'));
assert.doesNotMatch(answer, /garantía aplica en asuntos distintos/);
assert.equal(profile.group,'Pueblo indígena');
const {accesos}=await import('../support/db-stub.mjs');
assert.equal(accesos,0);
console.log('Orientador y chat: transporte Gemini simulado, JSON, reintento, perfil y verificación de citas correctos.');
