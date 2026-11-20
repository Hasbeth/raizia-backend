import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createDatabase,applySchema,isLocal } from './lib/database.mjs';
import { createStorage,packViewer } from './lib/storage-core.mjs';
import { blobToFloat32,normalizeVector,toPgvector } from './lib/embeddings-core.mjs';
import { measureSpace } from './lib/space.mjs';
import { DOCUMENT_COLUMNS,isMain } from './lib/biblioteca-io.mjs';

export function parseArgs(args) {
  const options={documents:Infinity,rest:false,skipFiles:false,onlyFiles:false,staging:path.resolve('data/staging'),
    originals:path.resolve('../raizia/data/files'),report:path.resolve('data/carga-informe.json')};
  for (let i=0;i<args.length;i++) {
    const arg=args[i];
    if (arg==='--documentos') {
      const value=args[++i];
      if (!/^\d+$/.test(value||'') || Number(value)<1) throw new Error('--documentos requiere un entero positivo.');
      options.documents=Number(value);
    } else if (arg==='--resto') options.rest=true;
    else if (arg==='--sin-archivos') options.skipFiles=true;
    else if (arg==='--solo-archivos') options.onlyFiles=true;
    else if (['--staging','--originales','--informe'].includes(arg)) {
      if (!args[i+1]) throw new Error('Falta ruta para '+arg);
      options[arg==='--staging'?'staging':arg==='--originales'?'originals':'report']=path.resolve(args[++i]);
    } else throw new Error('Opción desconocida: '+arg);
  }
  if (options.skipFiles&&options.onlyFiles) throw new Error('--sin-archivos y --solo-archivos son incompatibles.');
  if (options.rest&&options.documents!==Infinity) throw new Error('Usa --documentos N o --resto.');
  const backend=path.resolve('.');
  const rel=path.relative(backend,options.report);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel) || path.resolve(options.report).startsWith(path.resolve('data/staging')+path.sep)) throw new Error('El informe debe guardarse dentro del backend, fuera del staging.');
  return options;
}
async function retry(fn) {
  for (let attempt=0;;attempt++) {
    try {return await fn();} catch(error) {
      if (attempt>=3) throw error;
      await new Promise(resolve=>setTimeout(resolve,Math.min(8000,500*2**attempt)));
    }
  }
}
export function priorityDocuments(source) {
  return source.prepare(`SELECT d.*,(SELECT count(*) FROM chunks c WHERE c.document_id=d.id AND c.indexed=1) AS indexed_count
    FROM documents d ORDER BY (weight>=1) DESC,CASE WHEN weight>=1 THEN weight ELSE 0 END DESC,
    CASE WHEN weight<1 THEN indexed_count ELSE 0 END DESC,weight DESC,id`).all();
}
export async function loadLibrary(options,log=console.log) {
  const started=Date.now();
  // Estos dos archivos se abren SIEMPRE en solo lectura; nunca schema, PRAGMA WAL ni checkpoints.
  const source=new DatabaseSync(path.join(options.staging,'biblioteca.db'),{readOnly:true});
  source.exec('PRAGMA query_only=ON; BEGIN;');
  const vectorFile=path.join(options.staging,'vectores-e5.db');
  const vectors=fs.existsSync(vectorFile)?new DatabaseSync(vectorFile,{readOnly:true}):null;
  vectors?.exec('PRAGMA query_only=ON;');
  const findVector=vectors?.prepare('SELECT * FROM vectores WHERE chunk_id=?');
  let target;
  const failures=[];
  let processed=0,inserted=0,updatedVectors=0,files=0,texts=0,chunks=0;
  try {
    target=await createDatabase(); await applySchema(target);
    const store=createStorage(target); await store.ensureBuckets();
    const docs=priorityDocuments(source).slice(0,options.documents);
    log('Destino: '+(isLocal()?'PGlite/local forzado':target.kind)+'; documentos seleccionados: '+docs.length+'; principal: '+docs.filter(d=>d.weight>=1).length);
    if (!vectors) log('No existe vectores-e5.db: los fragmentos se cargan con embedding NULL.');
    if (!options.onlyFiles) {
      await target.transaction(async t=>{
        for (const row of source.prepare('SELECT * FROM categories ORDER BY parent_id IS NOT NULL,id').all()) {
          await t.query(`INSERT INTO categories(id,parent_id,name,slug,description,keywords,sort) VALUES($1,$2,$3,$4,$5,$6,$7)
            ON CONFLICT(id) DO UPDATE SET parent_id=excluded.parent_id,name=excluded.name,slug=excluded.slug,description=excluded.description,keywords=excluded.keywords,sort=excluded.sort`,
            [row.id,row.parent_id,row.name,row.slug,row.description,row.keywords,row.sort]);
        }
      });
      // Reserva TODOS los IDs de staging, incluso con --documentos 100. Las altas online no colisionan con la segunda tanda.
      for (const table of ['categories','documents','chunks']) {
        const max=source.prepare('SELECT COALESCE(MAX(id),0) n FROM '+table).get().n;
        await target.query(`SELECT setval(pg_get_serial_sequence('${table}','id'),GREATEST($1::bigint,(SELECT last_value FROM ${table}_id_seq),1),true)`,[max]);
      }
    }
    const getChunks=source.prepare('SELECT * FROM chunks WHERE document_id=? AND indexed=1 ORDER BY ord');
    const links=source.prepare('SELECT category_id FROM document_categories WHERE document_id=?');
    for (const doc of docs) {
      try {
        const [existing]=await target.query('SELECT id,content_hash,staging_loaded FROM documents WHERE id=$1',[doc.id]);
        if (existing && existing.content_hash!==doc.content_hash) throw new Error('ID ocupado por otro contenido; no se sobrescribe.');
        if (options.onlyFiles&&!existing) throw new Error('Carga primero las fichas antes de --solo-archivos.');
        const already=existing?.staging_loaded;
        if (!options.onlyFiles) {
          // El JSON del visor también se carga con --sin-archivos (solo omite originales).
          const viewer=JSON.parse(fs.readFileSync(path.join(options.staging,'textos',doc.id+'.json'),'utf8'));
          if (await retry(()=>store.put('textos',doc.id+'.json.gz',packViewer(viewer),'application/gzip',{skipUnchanged:true}))) texts++;
          const selected=getChunks.all(doc.id);
          await target.transaction(async t=>{
            if (!already) {
              const values=DOCUMENT_COLUMNS.map(k=>k==='file_path'?path.basename(doc[k]):doc[k]);
              await t.query(`INSERT INTO documents(${DOCUMENT_COLUMNS.join(',')}) VALUES(${values.map((_,i)=>'$'+(i+1)).join(',')}) ON CONFLICT(id) DO NOTHING`,values);
              for (const link of links.all(doc.id)) await t.query('INSERT INTO document_categories(document_id,category_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[doc.id,link.category_id]);
            }
            for (let offset=0;offset<selected.length;offset+=128) {
              const batch=selected.slice(offset,offset+128); const values=[]; const rows=[];
              for (const c of batch) {
                const e=findVector?.get(c.id);
                const valid=e && e.content_hash===c.content_hash && e.model==='multilingual-e5-small' && e.dims===384;
                const vector=valid?toPgvector(normalizeVector(blobToFloat32(e.vector,384),384)):null;
                const record=[c.id,c.document_id,c.ord,c.heading,c.section,doc.weight>=1?c.content:null,c.content_hash,vector,valid?e.model:null];
                const marks=record.map((value,index)=>{values.push(value);return '$'+values.length+(index===7?'::halfvec(384)':'');});
                rows.push('('+marks.join(',')+')');
              }
              const changed=await t.query(`INSERT INTO chunks(id,document_id,ord,heading,section,content,content_hash,embedding,embedding_model) VALUES ${rows.join(',')}
                ON CONFLICT(id) DO UPDATE SET
                  embedding=excluded.embedding,embedding_model=excluded.embedding_model
                WHERE chunks.content_hash=excluded.content_hash AND excluded.embedding IS NOT NULL
                  AND (chunks.embedding IS DISTINCT FROM excluded.embedding OR chunks.embedding_model IS DISTINCT FROM excluded.embedding_model)
                RETURNING id,embedding_model`,values);
              updatedVectors+=changed.filter(c=>c.embedding_model).length;
            }
            await t.query('UPDATE documents SET staging_loaded=true WHERE id=$1',[doc.id]);
          });
          if (!already) {inserted++;chunks+=selected.length;}
        }
        // --resto continúa lo faltante y refresca vectores ya calculados de las primeras tandas.
        if (!options.skipFiles && doc.file_path) {
          const original=path.join(options.originals,path.basename(doc.file_path));
          const real=fs.realpathSync(original);
          const rel=path.relative(fs.realpathSync(options.originals),real);
          if (rel.startsWith('..')||path.isAbsolute(rel)) throw new Error('Original fuera de la carpeta configurada.');
          if (await retry(()=>store.put('documentos',path.basename(doc.file_path),fs.readFileSync(real),doc.mime||'application/octet-stream',{skipUnchanged:true}))) files++;
        }
        processed++;
      } catch(error) {
        failures.push({id:doc.id,error:error.message});
        log('Documento '+doc.id+': '+error.message);
      }
      if ((processed+failures.length)%25===0 || processed+failures.length===docs.length) log((processed+failures.length)+'/'+docs.length+' revisados; '+inserted+' fichas nuevas; '+updatedVectors+' vectores insertados/actualizados.');
    }
    await target.exec('ANALYZE;');
    const space=await measureSpace(target);
    const report={createdAt:new Date().toISOString(),mode:target.kind,selected:docs.length,principal:docs.filter(d=>d.weight>=1).length,
      processed,inserted,newChunks:chunks,updatedVectors,originalsUploaded:files,textsUploaded:texts,failures,
      elapsedSeconds:(Date.now()-started)/1000,space,targetMB:220,under50Percent:space.database.percent<50,
      note:'Tamaño real de esta carga; no extrapolado. Incluye la base y sus índices. Embeddings aún NULL ocupan menos que la colección completa.'};
    fs.mkdirSync(path.dirname(options.report),{recursive:true}); fs.writeFileSync(options.report,JSON.stringify(report,null,2)+'\n');
    log('Base real: '+(space.database.bytes/1e6).toFixed(2)+' MB / 500 MB ('+space.database.percent.toFixed(2)+' %); meta ~220 MB, <50 %: '+(report.under50Percent?'cumplida en esta carga':'NO cumplida'));
    log('Storage registrado: '+(space.storage.bytes/1e6).toFixed(2)+' MB / 1000 MB. Vectores: '+space.chunks.con_vector+'; pendientes: '+space.chunks.sin_vector+'. Informe: '+options.report);
    return report;
  } finally { vectors?.close();source.exec('ROLLBACK');source.close();await target?.close(); }
}
if (isMain(import.meta.url)) {
  // loadEnvFile no imprime ni copia credenciales, y conserva RAIZIA_MODO del proceso.
  try {process.loadEnvFile('.env.local');} catch(error) {if(error.code!=='ENOENT') throw error;}
  loadLibrary(parseArgs(process.argv.slice(2))).then(report=>{if(report.failures.length)process.exitCode=1;})
    .catch(error=>{console.error('Carga interrumpida: '+error.message);process.exitCode=1;});
}
