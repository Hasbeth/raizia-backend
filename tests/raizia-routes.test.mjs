import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { routeTopics, routeRelevant } from '../src/lib/raizia-routes.ts';

test('Detección determinista con respaldo de subtemas y exclusión limitada al tema', () => {
  assert.deepEqual(routeTopics('Un policía me insultó'), ['discriminacion']);
  assert.deepEqual(routeTopics('No sé cómo hacerlo', ['transporte para una cita en EPS']), ['salud']);
  assert.equal(routeRelevant({ title: 'Código de Comercio' }, 'Me discriminan', ['discriminacion']), false);
  assert.equal(routeRelevant({ title: 'Código de Comercio' }, 'Código de Comercio y discriminación', ['discriminacion']), true);
});
test('PGlite sintético: nueve preguntas traen dos fragmentos de su ruta en top 9 y conservan norma principal', () => {
  const run = spawnSync(process.execPath, ['--import', './tests/support/runtime.mjs', 'tests/integration/raizia-routes.mjs'], { encoding: 'utf8', timeout: 60000,
    env: { ...process.env, RAIZIA_MODO: 'local', RAIZIA_PGLITE_DIR: ':memory:', LLM_PROVIDER: 'none', DATABASE_URL: '', SUPABASE_URL: '', RAIZIA_EMBED_DISABLED: '1', GEMINI_API_KEY: '' } });
  assert.ifError(run.error); assert.equal(run.status, 0, run.stdout + run.stderr);
});
