import assert from 'node:assert/strict';
import test from 'node:test';
import { createDatabase, applySchema } from '../scripts/lib/database.mjs';
import { backfillChunkSearch } from '../scripts/backfill-chunk-search.mjs';
import { moduleHarness } from './support/module-harness.mjs';

test('PGlite: trigger, RLS, léxica equivalente, respaldo por biblioteca y relleno reanudable', async () => {
  const database = await createDatabase({ memory: true, url: '' });
  const calls = [];
  const { lexicalCandidates, prepareSearchContext } = moduleHarness('../../src/lib/search.ts', {
    './db': { all: async (sql,...params) => {
      calls.push(sql);
      let index = 0;
      return database.query(sql.replace(/\?/g, () => `$${++index}`),params);
    } },
    './embeddings': {}, './storage': {}, './constants': {}, './timings': {},
  });
  const q = (sql,params) => database.query(sql,params);
  const saved = () => q('SELECT chunk_id,tsv::text AS tsv FROM chunk_search ORDER BY chunk_id');
  try {
    await q("INSERT INTO documents(id,title,status) VALUES(1,'Ficha pública','aprobado'),(2,'Ficha privada','revision')");
    await q("INSERT INTO chunks(id,document_id,ord,heading,content,content_hash) VALUES(1,1,0,'Árbol','Petición de agua','a')");
    assert.equal((await saved()).length,1);
    assert.equal((await q("SELECT tsv = to_tsvector('simple', f_fold(heading || ' ' || content)) AS exact FROM chunk_search JOIN chunks ON id=chunk_id"))[0].exact,true);
    await q("UPDATE chunks SET heading='Educación',content='Beca universitaria' WHERE id=1");
    assert.match((await saved())[0].tsv,/educacion/);
    assert.doesNotMatch((await saved())[0].tsv,/peticion/);
    await q("UPDATE chunks SET heading='Salud' WHERE id=1");
    assert.match((await saved())[0].tsv,/salud/);
    await q('UPDATE chunks SET content=NULL WHERE id=1');
    assert.deepEqual(await saved(),[]);
    await q("UPDATE chunks SET content='' WHERE id=1");
    assert.equal((await saved()).length,1,'Vacío no equivale a NULL');
    await q('DELETE FROM chunks WHERE id=1');
    assert.deepEqual(await saved(),[]);
    await q("INSERT INTO chunks(id,document_id,ord,heading,content,content_hash) VALUES(1,1,0,'','Agua petición','a'),(2,2,0,'','Agua petición','b'),(3,1,1,'','Agua','c'),(4,1,2,'Cabecera',NULL,'d')");
    assert.equal((await saved()).length,3);
    const before = await q("SELECT oid,relfilenode FROM pg_class WHERE relname IN ('chunks','idx_chunks_embedding_hnsw') ORDER BY oid");
    await q("CREATE INDEX idx_chunks_lexical ON chunks USING gin (to_tsvector('simple', f_fold(heading || ' ' || content))) WHERE content IS NOT NULL");
    await applySchema(database);
    assert.deepEqual(await q("SELECT indexname FROM pg_indexes WHERE indexname='idx_chunks_lexical'"),[]);
    await applySchema(database); // DROP IF EXISTS es idempotente.
    assert.deepEqual(await q("SELECT oid,relfilenode FROM pg_class WHERE relname IN ('chunks','idx_chunks_embedding_hnsw') ORDER BY oid"),before);
    assert.equal((await q("SELECT count(*)::int n FROM pg_trigger WHERE tgname='trg_chunk_search'"))[0].n,1);
    assert.equal((await q("SELECT relrowsecurity FROM pg_class WHERE relname='chunk_search'"))[0].relrowsecurity,true);
    assert.deepEqual(await q("SELECT * FROM pg_policies WHERE tablename='chunk_search'"),[]);
    assert.match((await q("SELECT indexdef FROM pg_indexes WHERE indexname='idx_chunk_search_tsv'"))[0].indexdef,/USING gin \(tsv\)/);

    calls.length=0;
    const indexed = await lexicalCandidates('agua petición');
    assert.deepEqual(indexed.map(h=>h.chunk_id),[1,3]);
    const primarySql = calls.find(sql=>sql.includes('hit.rank FROM'));
    assert.match(primarySql,/FROM chunk_search WHERE tsv @@/);
    assert.match(primarySql,/ts_rank_cd\(tsv,/);
    assert.match(primarySql,/ORDER BY rank DESC,chunk_id LIMIT 3000/);
    assert.doesNotMatch(primarySql,/to_tsvector/);
    assert.deepEqual(await lexicalCandidates('agua petición',true,false),indexed);
    assert.deepEqual((await lexicalCandidates('agua petición',false)).map(h=>h.chunk_id),[1,2,3]);
    calls.length=0;
    assert.deepEqual(await lexicalCandidates('inexistente'),[]);
    assert.ok(!calls.some(sql=>sql.includes('FROM chunks WHERE content IS NOT NULL')),'Sin coincidencias no activa respaldo');
    await q('DELETE FROM chunk_search WHERE chunk_id IN (1,3)');
    assert.deepEqual(await lexicalCandidates('agua petición'),indexed,'Solo filas privadas no desactivan el respaldo público');
    await q('DELETE FROM chunk_search');
    assert.deepEqual(await lexicalCandidates('agua petición'),indexed,'Biblioteca sin rellenar conserva resultados');
    const context = await prepareSearchContext([]);
    assert.deepEqual(context.approvedDocumentIds,[1]);
    assert.equal(context.lexicalIndex,false);

    await q(`INSERT INTO chunks(id,document_id,ord,heading,content,content_hash)
      SELECT n,1,n,'Cabecera','Agua petición',n::text FROM generate_series(10,2012) n`);
    await q('DELETE FROM chunk_search');
    const batches=[];
    await assert.rejects(backfillChunkSearch(database,{ onBatch: batch => {
      batches.push(batch); throw new Error('Interrupción simulada');
    } }),/Interrupción/);
    assert.equal(batches[0].count,2000);
    assert.equal((await saved()).length,2000);
    await q("UPDATE chunk_search SET tsv=to_tsvector('simple','obsoleto') WHERE chunk_id=1");
    const resumed = await backfillChunkSearch(database,{afterId:batches[0].lastId});
    assert.equal(resumed.total,6);
    assert.equal(resumed.lastId,2012);
    const rerun = await backfillChunkSearch(database);
    assert.equal(rerun.total,2006);
    assert.equal((await q("SELECT count(*)::int n FROM chunk_search s JOIN chunks c ON c.id=s.chunk_id WHERE s.tsv <> to_tsvector('simple', f_fold(heading || ' ' || content))"))[0].n,0);
    assert.equal((await backfillChunkSearch(database,{afterId:2012})).total,0);
    await assert.rejects(backfillChunkSearch(database,{afterId:-1}));
    await q('DELETE FROM documents');
    assert.deepEqual(await saved(),[],'La cascada documento → chunks → chunk_search queda limpia');
  } finally { await database.close(); }
});
