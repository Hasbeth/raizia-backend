import assert from 'node:assert/strict';
import test from 'node:test';
import { moduleHarness } from './support/module-harness.mjs';

test('HNSW: orden exacto interior, filtros iterativos, cupos y reordenamiento exterior en una conexión', async () => {
  const calls = [];
  let transaction = false, running = false;
  const database = {
    async exec(sql) {
      assert.ok(transaction);
      assert.match(sql, /set_config\('hnsw.ef_search', '200', true\)/);
      assert.match(sql, /set_config\('hnsw.iterative_scan', 'relaxed_order', true\)/);
      assert.match(sql, /EXCEPTION WHEN undefined_object/);
    },
    async query(sql, params) {
      assert.ok(transaction);
      assert.equal(running, false, 'No compartir conexión concurrentemente');
      running = true;
      await Promise.resolve();
      running = false;
      if (!params) {
        assert.match(sql, /WHERE status='aprobado'/);
        return [{ id: 10, weight: 1 }, { id: 20, weight: 0.3 }, { id: 30, weight: 1.5 }];
      }
      calls.push({ sql, params });
      assert.match(sql, /FROM chunks WHERE embedding IS NOT NULL AND embedding_model=\$2/);
      assert.match(sql, /document_id = ANY\(\$3::integer\[\]\)/);
      assert.match(sql, /ORDER BY embedding <=> \$1::halfvec\(384\) LIMIT \$4\s*\) c JOIN documents/);
      assert.match(sql, /WHERE d.status='aprobado'/);
      assert.match(sql, /ORDER BY c.rank \+ 0,c.id/);
      assert.equal(params[1], 'modelo-correcto');
      return params[3] === 180 ? [{ chunk_id: 2, rank: 0.2 }, { chunk_id: 1, rank: 0.1 }]
        : [{ chunk_id: 3, rank: 0.1 }, { chunk_id: 1, rank: 0.1 }];
    },
  };
  const { vectorCandidates } = moduleHarness('../../src/lib/search.ts', {
    './db': { tx: async fn => { transaction = true; try { return await fn(database); } finally { transaction = false; } } },
    './embeddings': { toPgvector: () => '[1,0]' }, './storage': {}, './constants': {},
  });
  const hits = await vectorCandidates(new Float32Array(384), 'modelo-correcto');
  assert.deepEqual(hits.map(h => h.chunk_id), [1, 3, 2]);
  assert.deepEqual(calls.map(c => c.params.slice(2)), [['{10,20,30}', 180], ['{10,30}', 60]]);
  assert.match(calls[1].sql, /AND d.weight>=1/);
});
