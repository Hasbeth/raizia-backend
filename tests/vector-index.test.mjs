import assert from 'node:assert/strict';
import test from 'node:test';
import { moduleHarness } from './support/module-harness.mjs';

function harness(rows, approved) {
  const calls = [];
  let transaction = false;
  const database = {
    async exec(sql) {
      assert.ok(transaction);
      assert.match(sql, /set_config\('hnsw.ef_search', '320', true\)/);
      assert.match(sql, /set_config\('hnsw.iterative_scan', 'relaxed_order', true\)/);
      assert.match(sql, /EXCEPTION WHEN undefined_object/);
    },
    async query(sql, params) {
      assert.ok(transaction);
      calls.push({ sql, params });
      if (!params) {
        assert.match(sql, /WHERE status='aprobado'/);
        return approved.map(id => ({ id }));
      }
      assert.match(sql, /FROM chunks WHERE embedding IS NOT NULL AND embedding_model=\$2/);
      assert.match(sql, /\(document_id \+ 0\) = ANY\(\$3::integer\[\]\)/);
      assert.match(sql, /ORDER BY embedding <=> \$1::halfvec\(384\) LIMIT 320\s*\) c JOIN documents/);
      assert.match(sql, /WHERE d.status='aprobado'/);
      assert.match(sql, /ORDER BY c.rank \+ 0,c.id/);
      assert.equal(params[1], 'modelo-correcto');
      assert.equal(params[2], `{${approved.join(',')}}`);
      return [...rows].reverse();
    },
  };
  const search = moduleHarness('../../src/lib/search.ts', {
    './db': { tx: async fn => { transaction = true; try { return await fn(database); } finally { transaction = false; } } },
    './embeddings': { toPgvector: () => '[1,0]' }, './storage': {}, './constants': {}, './timings': {},
  });
  return { calls, run: ids => search.vectorCandidates(new Float32Array(384), 'modelo-correcto', ids) };
}

test('HNSW: un recorrido de 320, filtros, 180 generales y 60 principales ordenados', async () => {
  const rows = Array.from({length:320}, (_,i) => ({chunk_id:i+1,rank:i/320,weight:i<200 ? 0.3 : 1}));
  const {calls, run} = harness(rows,[10,20,30]);
  const hits = await run();
  assert.deepEqual(hits.map(h=>h.chunk_id), [...rows.slice(0,180),...rows.slice(200,260)].map(h=>h.chunk_id));
  assert.equal(hits.filter(h=>h.weight>=1).length,60);
  assert.equal(calls.filter(c=>c.params).length,1);
  assert.equal(calls.length,2);
});

test('HNSW: cupos solapados sin duplicados, empates por id y lista aprobada compartida', async () => {
  const rows = Array.from({length:320}, (_,i) => ({chunk_id:i+1,rank:Math.floor(i/2),weight:i%2 ? 0.3 : 1}));
  const {calls,run} = harness(rows,[10,20]);
  const hits = await run([10,20]);
  assert.deepEqual(hits.map(h=>h.chunk_id),rows.slice(0,180).map(h=>h.chunk_id));
  assert.equal(new Set(hits.map(h=>h.chunk_id)).size,hits.length);
  assert.equal(calls.length,1);
});

test('HNSW: principal escasa y biblioteca vacía no fuerzan candidatos', async () => {
  const rows = Array.from({length:210}, (_,i) => ({chunk_id:i+1,rank:i,weight:i>=200 ? 1 : 0.3}));
  assert.equal((await harness(rows,[10]).run()).length,190);
  const empty = harness([],[]);
  assert.deepEqual(await empty.run([]),[]);
  assert.equal(empty.calls.length,0);
});
