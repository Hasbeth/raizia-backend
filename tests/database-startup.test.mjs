import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { moduleHarness } from './support/module-harness.mjs';

test('Arranque PostgreSQL sin red: no lee schema.sql ni ejecuta DDL; producción sin URL falla antes de PGlite', async () => {
  let connections=0,closed=0;
  const {createDatabase} = moduleHarness('../../scripts/lib/database.mjs', {
    'node:fs/promises':{default:{readFile:()=>assert.fail('El arranque no debe leer schema.sql')}},
    'node:path':{default:path}, 'node:url':{pathToFileURL},
    postgres:{default:()=>{connections++;return {
      unsafe:()=>assert.fail('El arranque no debe ejecutar SQL'),
      end:async()=>{closed++;},
    };}},
  });
  const saved = {RAIZIA_MODO:process.env.RAIZIA_MODO,NODE_ENV:process.env.NODE_ENV};
  Object.assign(process.env,{RAIZIA_MODO:'production',NODE_ENV:'production'});
  try {
    const database = await createDatabase({url:'postgres://stub.invalid/offline'});
    assert.equal(database.kind,'postgres');
    assert.equal(connections,1);
    await database.close();
    assert.equal(closed,1);
    await assert.rejects(createDatabase({url:''}),/DATABASE_URL en producción/);
    assert.equal(connections,1);
  } finally {
    for(const [key,value] of Object.entries(saved)) {
      if(value===undefined) delete process.env[key]; else process.env[key]=value;
    }
  }
});
