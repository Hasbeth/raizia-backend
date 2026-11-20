import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
test('PGlite con pgvector: esquema, RLS, búsqueda híbrida, rutas, ingestión, espacio y cargador reanudable',()=>{
 const result=spawnSync(process.execPath,['--import','./tests/support/runtime.mjs','tests/integration/postgres.mjs'],{
  cwd:fileURLToPath(new URL('../',import.meta.url)),encoding:'utf8',timeout:180_000,maxBuffer:2*1024*1024,
  env:{...process.env,RAIZIA_MODO:'local',RAIZIA_PGLITE_DIR:':memory:',RAIZIA_EMBED_DISABLED:'1',LLM_PROVIDER:'none',DATABASE_URL:'',SUPABASE_URL:'',GEMINI_API_KEY:''}
 });
 assert.equal(result.status,0,result.stdout+'\n'+result.stderr);
});
