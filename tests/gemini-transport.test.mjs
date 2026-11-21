import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('Transporte Gemini real con fetch simulado, sin red',()=>{
  const run=spawnSync(process.execPath,['--import','./tests/support/runtime.mjs','--import','./tests/support/register.mjs','tests/integration/rag-gemini.mjs'],{encoding:'utf8',timeout:15_000,env:{...process.env,RAIZIA_EMBED_DISABLED:'1'}});
  assert.ifError(run.error);
  assert.equal(run.status,0,run.stdout+'\n'+run.stderr);
});
