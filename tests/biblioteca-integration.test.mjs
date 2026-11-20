import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

test("SQLite aislado: fichas exactas, visor íntegro, fallos recuperables y reconstrucción con vectores por hash", () => {
  const child = spawnSync(process.execPath, ["--input-type=module", "-"], {
    cwd: fileURLToPath(new URL("../", import.meta.url)), encoding: "utf8", timeout: 60_000,
    input: `
      import fs from 'node:fs';
      import path from 'node:path';
      import assert from 'node:assert/strict';
      import { DatabaseSync } from 'node:sqlite';
      import { buildLibrary } from './scripts/construir-biblioteca.mjs';
      import { measureLibrary } from './scripts/medir-biblioteca.mjs';
      import { SCHEMA, ROOT, DATA, assertWritable, DOCUMENT_COLUMNS } from './scripts/lib/biblioteca-io.mjs';
      import { contentHash } from './scripts/lib/biblioteca-core.mjs';
      import { MODEL, float32ToBlob, normalizeVector } from './scripts/lib/embeddings-core.mjs';
      fs.mkdirSync(DATA, {recursive:true});
      const temp = fs.mkdtempSync(path.join(DATA, '.test-biblioteca-'));
      const sourceDir = path.join(temp,'source');
      const destination = path.join(temp,'staging');
      const text = 'La comunidad conserva derechos colectivos sobre el territorio ancestral y solicita medidas de protección para asegurar la participación y la integridad de todos sus habitantes.';
      let source;
      let staging;
      try {
        fs.mkdirSync(path.join(sourceDir,'files'), {recursive:true});
        source = new DatabaseSync(path.join(sourceDir,'raizia.db'));
        source.exec(SCHEMA);
        source.prepare('INSERT INTO categories VALUES (?,?,?,?,?,?,?)').run(7,null,'Categoría','categoria','Descripción','territorio',1);
        const insert = source.prepare('INSERT INTO documents VALUES (' + DOCUMENT_COLUMNS.map(()=>'?').join(',') + ')');
        function doc(id,weight,file) {
          const values = [id,'Documento '+id,'Entidad','Sentencia','2025','https://example.invalid/'+id,'Resumen','aprobado',file,file,'text/plain',123,'upload','hash-ficha',999,'Nota','2025-01-01','2025-01-02',weight];
          insert.run(...values);
          source.prepare('INSERT INTO document_categories VALUES (?,7)').run(id);
        }
        doc(10,1,'principal.txt'); doc(20,0.3,'masiva.txt'); doc(30,0.1,'faltante.txt');
        fs.writeFileSync(path.join(sourceDir,'files','principal.txt'),text);
        fs.writeFileSync(path.join(sourceDir,'files','masiva.txt'),'ANTECEDENTES\\n'+text+'\\nSALVAMENTO DE VOTO\\n'+text+' Disenso.');
        source.prepare('INSERT INTO chunks VALUES (1,10,0,?,?,?,?,1)').run('','antiguo','NO COPIAR ESTE TEXTO ANTIGUO','hash-viejo');
        const originalCards = source.prepare('SELECT * FROM documents ORDER BY id').all();
        source.close(); source=null;
        await buildLibrary({sourceDir,destination,log:()=>{}});
        staging = new DatabaseSync(path.join(destination,'biblioteca.db'));
        assert.deepEqual(staging.prepare('SELECT * FROM documents ORDER BY id').all(),originalCards);
        assert.equal(staging.prepare('SELECT count(*) n FROM document_categories').get().n,3);
        assert.equal(staging.prepare("SELECT count(*) n FROM chunks WHERE content LIKE '%NO COPIAR%'").get().n,0);
        const hash = contentHash(text);
        const chunk = staging.prepare('SELECT * FROM chunks WHERE content_hash=? AND indexed=1').get(hash);
        assert.equal(chunk.document_id,10);
        const vector = float32ToBlob(normalizeVector([3,4]));
        staging.prepare('INSERT INTO embeddings VALUES (?,?,?,?,?)').run(chunk.id,MODEL,2,vector,'2026-01-01T00:00:00Z');
        const oldId = chunk.id;
        staging.close(); staging=null;
        let build = JSON.parse(fs.readFileSync(path.join(destination,'construccion.json')));
        assert.equal(build.processed,2); assert.equal(build.failures.length,1);
        assert.equal(build.failures[0].id,30);
        const viewer = JSON.parse(fs.readFileSync(path.join(destination,'textos','20.json')));
        assert.ok(viewer.chunks.some(c=>c.content.includes('Disenso.')));
        assert.equal(viewer.chunks.map(c=>c.content).join('').replace(/\\s/g,''),('ANTECEDENTES'+text+'SALVAMENTO DE VOTO'+text+' Disenso.').replace(/\\s/g,''));
        // Un documento anterior desplaza los IDs, sin cambiar el texto embebido.
        source = new DatabaseSync(path.join(sourceDir,'raizia.db'));
        const extra = {...originalCards[0],id:1,title:'Documento anterior',file_path:'extra.txt',file_name:'extra.txt'};
        source.prepare('INSERT INTO documents VALUES ('+DOCUMENT_COLUMNS.map(()=>'?').join(',')+')').run(...DOCUMENT_COLUMNS.map(c=>extra[c]));
        source.close(); source=null;
        fs.writeFileSync(path.join(sourceDir,'files','extra.txt'),text+' Un contexto diferente.');
        await buildLibrary({sourceDir,destination,log:()=>{}});
        staging = new DatabaseSync(path.join(destination,'biblioteca.db'),{readOnly:true});
        const restored = staging.prepare('SELECT c.id,e.* FROM chunks c JOIN embeddings e ON e.chunk_id=c.id WHERE c.content_hash=? AND c.indexed=1').get(hash);
        assert.ok(restored); assert.notEqual(restored.id,oldId);
        assert.deepEqual(Buffer.from(restored.vector),vector);
        assert.equal(restored.created_at,'2026-01-01T00:00:00Z');
        assert.equal(staging.prepare('PRAGMA foreign_key_check').all().length,0);
        staging.close(); staging=null;
        build=JSON.parse(fs.readFileSync(path.join(destination,'construccion.json')));
        assert.ok(build.restored_embeddings>=1);
        assert.equal(build.sha256_before,build.sha256_after);
        const report=measureLibrary(destination);
        assert.ok(report.includes('256 dimensiones') && report.includes('faltante.txt'));
        assert.throws(()=>assertWritable(path.resolve(ROOT,'../raizia/data/raizia.db')));
        console.log('Integración SQLite aislada correcta');
      } finally {
        source?.close(); staging?.close();
        assertWritable(temp);
        fs.rmSync(temp,{recursive:true,force:true});
      }
    `,
  });
  assert.equal(child.status, 0, `${child.stdout}\n${child.stderr}\n${child.error ?? ""}`);
});
