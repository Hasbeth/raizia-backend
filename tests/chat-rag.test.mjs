import assert from 'node:assert/strict';
import { test } from 'node:test';
import { routeHarness } from './support/route-harness.mjs';
const request = () => new Request('http://localhost/api/chat',{method:'POST',body:JSON.stringify({message:'¿Qué beneficios tengo?',history:[{role:'user',content:'universidad'},{role:'assistant',content:'programa'}]})});

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
