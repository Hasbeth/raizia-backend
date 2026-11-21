import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import * as core from '../scripts/lib/embeddings-core.mjs';
import { moduleHarness } from './support/module-harness.mjs';

function provider(adapters={}) {
  return moduleHarness('../../scripts/lib/embedding-provider.mjs', {
    'node:path':{default:path}, './embeddings-core.mjs':core,
    './database.mjs':{isLocal:()=>false,dataDir:()=>'.'}, ...adapters,
  });
}
function environment(t,values) {
  const saved=Object.fromEntries(Object.keys(values).map(k=>[k,process.env[k]]));
  Object.assign(process.env,values);
  t.after(()=>{for(const [k,v] of Object.entries(saved)){if(v===undefined)delete process.env[k];else process.env[k]=v;}});
}
const vector=i=>Array.from({length:384},(_,j)=>Number(i===j));

test('Gemini: un lote RETRIEVAL_QUERY, orden, duplicados, caché y fallo con respaldo', async t=>{
  environment(t,{EMBED_PROVIDER:'gemini',RAIZIA_EMBED_DISABLED:'0',GEMINI_API_KEY:'stub'});
  const calls=[];
  t.mock.method(globalThis,'fetch',async(url,opts)=>{
    const body=JSON.parse(opts.body);calls.push({url,body});
    const requests=body.requests??[body];
    const embeddings=requests.map((_,i)=>({values:vector(i)}));
    return {ok:true,json:async()=>body.requests?{embeddings}:{embedding:embeddings[0]}};
  });
  const {embedQueries,embedQuery}=provider();
  const texts=['original','subtema uno','subtema dos','subtema tres'];
  const result=await embedQueries([...texts,' original ']);
  assert.equal(calls.length,1);
  assert.match(calls[0].url,/:batchEmbedContents$/);
  assert.deepEqual(calls[0].body.requests.map(r=>r.content.parts[0].text),texts);
  assert.ok(calls[0].body.requests.every(r=>r.taskType==='RETRIEVAL_QUERY'&&r.outputDimensionality===384));
  assert.deepEqual(result.slice(0,4),texts.map((_,i)=>new Float32Array(vector(i))));
  assert.equal(result[0],result[4]);
  assert.equal(await embedQuery(texts[1]),result[1]);
  assert.equal(calls.length,1);
  const mixed=await embedQueries(['nueva',texts[2]]);
  assert.equal(mixed[1],result[2]);
  assert.equal(calls.length,2);
  assert.match(calls[1].url,/:embedContent$/);
  assert.equal(calls[1].body.taskType,'RETRIEVAL_QUERY');
  t.mock.method(globalThis,'fetch',async()=>{throw new Error('Sin proveedor');});
  assert.deepEqual(await embedQueries([texts[0],'fallo']),[result[0],null]);
  assert.deepEqual(await embedQueries(['durante pausa']),[null]);
});

test('Local: una inferencia para las consultas pendientes con prefijo query y sin red', async t=>{
  environment(t,{EMBED_PROVIDER:'local',RAIZIA_EMBED_DISABLED:'0'});
  const batches=[];
  let pipelines=0;
  const {embedQueries}=provider({'@huggingface/transformers':{
    env:{},pipeline:async()=>{pipelines++;return async texts=>{
      batches.push(texts);return {data:new Float32Array(texts.flatMap((_,i)=>vector(i)))};
    };},
  }});
  const results=await embedQueries(['original','tema uno','tema dos','tema tres']);
  assert.equal(pipelines,1);
  assert.deepEqual(batches,[['query: original','query: tema uno','query: tema dos','query: tema tres']]);
  assert.equal(results.length,4);
  assert.deepEqual(await embedQueries(['tema tres','original']),[results[3],results[0]]);
  assert.equal(batches.length,1);
  process.env.RAIZIA_EMBED_DISABLED='1';
  assert.deepEqual(await embedQueries(['nueva','otra']),[null,null]);
  assert.deepEqual(await embedQueries([]),[]);
  assert.equal(batches.length,1);
});
