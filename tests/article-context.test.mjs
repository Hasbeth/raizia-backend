import assert from 'node:assert/strict';
import test from 'node:test';
import { createDatabase } from '../scripts/lib/database.mjs';
import * as article from '../src/lib/article-context.ts';
import { buildMessages, retrieve, SYSTEM_PROMPT } from '../src/lib/rag.ts';
import { queryTerms } from '../src/lib/search.ts';
import { moduleHarness } from './support/module-harness.mjs';

const heading = 'Título II · Artículo 12. Exoneraciones';
const question = '¿Tengo que prestar servicio militar si soy indígena?';
const literalJ = 'j) Los indígenas que acrediten su integridad cultural, social y económica a través de certificación expedida por el Ministerio del Interior.';
const hit = (id, doc = id, extra = {}) => ({ chunkId:id, documentId:doc, ord:0, heading:'', content:'Fuente de prueba.',
  title:'Norma de prueba', entity:'', docType:'Ley', docDate:'', officialUrl:'', score:1, coverage:1, weight:1, ...extra });
const options = { topics:async()=>[], prepare:async()=>({approvedDocumentIds:[],topicDocs:new Set(),lexicalIndex:false}),
  embed:async qs=>qs.map(()=>null), reformulate:async()=>null };

test('PGlite: artículo partido llega completo al contexto, una consulta por lote y cupos tras unir partes', async () => {
  const database = await createDatabase({memory:true,url:''});
  const calls = [];
  const {hydrateArticleChunks} = moduleHarness('../../src/lib/storage.ts', {
    './db':{query:async (sql,params)=>{calls.push({sql,params});return database.query(sql,params);}},
    './article-context':article, '../../scripts/lib/storage-core.mjs':{},
  });
  const prefix = 'ARTÍCULO 12. Están exonerados de prestar servicio militar obligatorio:\n' +
    Array.from({length:8},(_,i)=>`${String.fromCharCode(97+i)}) ${'Contenido sintético para probar la longitud. '.repeat(4)}`).join('\n');
  const overlap = 'i) Apartado anterior compartido entre los dos fragmentos.';
  const first = prefix + '\n' + overlap;
  const second = overlap + '\n' + literalJ;
  try {
    await database.query("INSERT INTO documents(id,title,weight) VALUES(1,'Ley 1861 de 2017',1),(2,'Otra ley',1),(3,'Sentencia masiva',0.3)");
    for (const [id,doc,ord,h,content] of [
      [1,1,16,heading,first],[2,1,17,heading,second],
      [3,1,18,'Artículo 13','ARTÍCULO DISTINTO'],[4,1,19,heading,'MISMO HEADING TRAS HUECO'],
      [5,2,16,heading,'OTRO DOCUMENTO'],[6,3,16,heading,first],[7,3,17,heading,literalJ],
    ]) await database.query('INSERT INTO chunks(id,document_id,ord,heading,content,content_hash) VALUES($1,$2,$3,$4,$5,$6)',[id,doc,ord,h,content,String(id)]);
    const a = hit(1,1,{ord:16,heading,content:first});
    const b = hit(2,1,{ord:17,heading,content:second});
    for (const seed of [a,b]) {
      calls.length=0;
      const response = await retrieve(question,'',undefined,[],{...options,search:async()=>[seed],hydrate:hydrateArticleChunks});
      assert.equal(calls.length,1);
      assert.equal(response.sources.length,1);
      assert.equal(response.sources[0].n,1);
      const content = response.hits[0].content;
      assert.ok(content.length>1400 && content.length<=3500);
      assert.ok(content.includes(first));
      assert.ok(content.endsWith(literalJ));
      assert.equal(content.split(overlap).length-1,1);
      assert.doesNotMatch(content,/ARTÍCULO DISTINTO|MISMO HEADING TRAS HUECO|OTRO DOCUMENTO/);
      const prompt = buildMessages(question,response.hits,[]).at(-1).content;
      assert.ok(prompt.includes(literalJ),'El recorte de buildMessages no debe perder el literal final');
      assert.equal((prompt.match(/\[1\]/g)||[]).length,1);
    }
    calls.length=0;
    // Incluye candidatos de otro artículo del mismo documento, además de las dos partes.
    const candidates = [a,b,hit(3,1,{ord:18,heading:'Artículo 13',content:'ARTÍCULO DISTINTO'}),
      ...Array.from({length:9},(_,i)=>hit(20+i,20+i))];
    const response = await retrieve(question,'',undefined,[],{...options,search:async()=>candidates,hydrate:hydrateArticleChunks});
    assert.equal(calls.length,1,'Todos los artículos y candidatos comparten el lote SQL');
    assert.equal(response.hits.length,9);
    assert.equal(response.hits.filter(h=>h.heading===heading).length,1);
    assert.equal(response.hits.filter(h=>h.documentId===1).length,2,'El cupo liberado admite el siguiente artículo');
    assert.ok(response.hits.some(h=>h.chunkId===3));
    assert.deepEqual(response.sources.map(s=>s.n),[1,2,3,4,5,6,7,8,9]);
    for (const doc of new Set(response.hits.map(h=>h.documentId))) assert.ok(response.hits.filter(h=>h.documentId===doc).length<=2);

    calls.length=0;
    const massive = [hit(6,3,{ord:16,heading,content:first,weight:0.3}),hit(7,3,{ord:17,heading,content:literalJ,weight:0.3})];
    const skipped = await retrieve(question,'',undefined,[],{...options,search:async()=>massive,hydrate:hydrateArticleChunks});
    assert.equal(calls.length,0,'weight<1 no consulta vecinos');
    assert.equal(skipped.sources.length,2,'Las masivas mantienen sus fragmentos separados');
    assert.deepEqual(skipped.hits.map(h=>h.content),massive.map(h=>h.content));
    assert.ok(skipped.hits.every(h=>!h.articleContext));
    calls.length=0;
    await hydrateArticleChunks([a,...massive],queryTerms(question));
    assert.equal(calls.length,1);
    assert.deepEqual(calls[0].params,[1,heading],'El lote mixto también excluye sentencias masivas');
  } finally { await database.close(); }
});

test('Tope de 3.500: elige por consulta y subtemas y conserva literales/numerales completos', () => {
  for (const separator of ['\n','; ']) {
    const units = Array.from({length:12},(_,i)=>`${String.fromCharCode(97+i)}) ${'Contenido sintético del literal. '.repeat(24)}FIN-${i}.`);
    units[9]='j) '+literalJ.slice(3)+' '+('servicio militar indígena '.repeat(20))+'FIN-9.';
    const full = units.join(separator);
    const selected = article.limitArticle(full,queryTerms(question));
    assert.ok(selected.length<=3500);
    assert.ok(selected.includes(units[9]));
    for (const unit of units) if(selected.includes(unit.slice(0,3))) assert.ok(selected.includes(unit),'Cada literal incluido llega hasta su final');
  }
  const numerals = Array.from({length:10},(_,i)=>`${i+1}. ${'Texto de prueba sin relevancia. '.repeat(26)}FIN-${i}.`);
  numerals[8]='9. Certificación Ministerio del Interior, integridad cultural, social y económica. '+numerals[8].slice(3);
  const bySubtopic = article.limitArticle(numerals.join('\n'),queryTerms('certificación Ministerio Interior integridad cultural'));
  assert.ok(bySubtopic.includes(numerals[8]));
  assert.ok(bySubtopic.length<=3500);
  for(const numeral of numerals) if(bySubtopic.includes(numeral.slice(0,3))) assert.ok(bySubtopic.includes(numeral));
  const huge = 'a) '+ 'indígena '.repeat(500)+'FIN.';
  assert.doesNotMatch(article.limitArticle(huge,queryTerms(question)),/a\)|indígena/,'Un único literal demasiado largo se omite completo');
  assert.equal(article.limitArticle(literalJ,[]),literalJ);
});

test('La unión elimina palabras solapadas sin confundir letras finales ni puntuación', () => {
  assert.equal(article.joinArticle(['Texto compartido','compartido y final.']),'Texto compartido y final.');
  assert.equal(article.joinArticle(['Se requiere garantía','a) Certificación.']),'Se requiere garantía\na) Certificación.');
  assert.equal(article.joinArticle(['Condición final.','. Continúa la nota.']),'Condición final.\n. Continúa la nota.');
});

test('Prompt: ausencia de evidencia no niega derechos y el reconocimiento explícito va primero', () => {
  for (const rule of ['Nunca afirmes que un derecho, exoneración o beneficio NO existe solo porque no aparece en las fuentes',
    'en las fuentes que revisé no encontré ese punto','sugiere confirmarlo','grupo resuelto EN ESTE TURNO',
    'ponlo primero con sus condiciones y cita']) assert.ok(SYSTEM_PROMPT.includes(rule),rule);
});
