import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { query, closeDatabase } from '../../src/lib/db.ts';
import { retrieve } from '../../src/lib/rag.ts';
const fixture = JSON.parse(readFileSync('tests/fixtures/evaluacion.json', 'utf8'));
const titles = {
  discriminacion: 'Ruta RAIZIA — discriminación o abuso policial (sintética)',
  salud: 'Ruta RAIZIA — salud en resguardos y zonas alejadas (sintética)',
  educacion: 'Ruta RAIZIA — educación (sintética)',
};
async function doc(title, text, type = 'Guía', status = 'aprobado', weight = 0.5) {
  const [d] = await query('INSERT INTO documents(title,doc_type,status,weight,entity) VALUES($1,$2,$3,$4,$5) RETURNING id', [title, type, status, weight, 'Superintendencia Nacional de Salud (fixture)']);
  for (let ord = 0; ord < 3; ord++) await query('INSERT INTO chunks(document_id,ord,heading,content,content_hash) VALUES($1,$2,$3,$4,$5)', [d.id, ord, `Paso sintético ${ord}`, text + ` Apartado de prueba ${ord}.`, `${d.id}-${ord}`]);
  return d.id;
}
try {
  const ids = {};
  for (const [topic, title] of Object.entries(titles)) ids[topic] = await doc(title, 'Guía de prueba para ' + topic + '. Acude a la oficina ficticia con copia de la solicitud. Conserva la constancia y pregunta por la respuesta.');
  const primary = await doc('Constitución Política (fixture)', fixture.rutas_raizia.map(f => f.pregunta).join(' ') + ' Igualdad insultó denuncio indígena resguardo alejado entregan medicamentos discriminación racismo policía abuso de autoridad salud EPS transporte medicamentos remisión hospital educación universidad cupo ICETEX docente escuela.', 'Constitución', 'aprobado', 1);
  const commerce = await doc('Código de Comercio', 'discriminación racismo policía salud EPS transporte educación universidad cupo', 'Código', 'aprobado', 1);
  const hidden = await doc('Ruta RAIZIA — salud borrador', 'EPS transporte', 'Guía', 'revision');
  const health = [await doc('Sentencia T-122/21', 'transporte EPS remisión', 'Sentencia'), await doc('Sentencia T-407/24', 'transporte salud EPS', 'Sentencia'), await doc('Concepto Supersalud transporte', 'transporte salud EPS', 'Concepto')];
  for (const f of fixture.rutas_raizia) {
    const { hits } = await retrieve(f.pregunta, '', undefined, [], { reformulate: async () => null });
    assert.ok(hits.length <= 9); assert.equal(hits.filter(h => h.documentId === ids[f.tema]).length, 2, f.pregunta + ': ' + hits.map(h => h.title));
    assert.ok(hits.some(h => h.documentId === primary), 'Norma principal conservada: ' + f.pregunta + ' => ' + hits.map(h => h.title.slice(0, 24)).join(' | '));
    assert.ok(hits.every(h => h.documentId !== hidden && h.documentId !== commerce));
    if (f.pregunta === 'La EPS no me da transporte') for (const id of health) assert.ok(hits.some(h => h.documentId === id), 'Sentencias y concepto de salud reservados');
  }
  console.log('9/9 preguntas con ruta; norma principal, aprobación y salud verificadas en PGlite sintético.');
} finally { await closeDatabase(); }
