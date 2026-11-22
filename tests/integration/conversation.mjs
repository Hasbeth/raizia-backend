import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { db, query, closeDatabase } from '../../src/lib/db.ts';
import * as rateLimit from '../../src/lib/rate-limit.ts';
import * as conversation from '../../src/lib/tool-conversation.ts';
import { moduleHarness } from '../support/module-harness.mjs';
import { POST as generate } from '../../src/rutas/tools/[kind]/route.ts';
import { RIGHTS, TOOLS } from '../../src/lib/tools-config.ts';
const words = 'RELATO SINTÉTICO ÚNICO: negaron una solicitud ficticia.';
const extra = 'HECHO ADICIONAL SINTÉTICO: tuve que regresar a la oficina ficticia.';
const values = { hechos: words, accionado: 'ENTIDAD FICTICIA', actuaciones: 'GESTIÓN FICTICIA', cuando: 'FECHA FICTICIA', medidaProvisional: 'No', pretensiones: 'PEDIDO FICTICIO', pruebas: 'ninguna por ahora', hechosAdicionales: extra };
const quoteFor = (campo, valor) => campo === 'medidaProvisional' ? 'No hay peligro si espero.' : valor;
let aiCalls = 0;
const { POST } = moduleHarness('../../src/rutas/tools/conversar/route.ts', {
  '@/lib/rate-limit': rateLimit, '@/lib/tool-conversation': conversation,
  '@/lib/rag': { askGeminiJSON: async () => { aiCalls++; return JSON.stringify({ respuesta: 'Gracias por agregar ese detalle.', pregunta: null, propuestas: Object.entries(values).map(([campo, valor]) => ({ campo, valor, cita_literal: quoteFor(campo, valor) })), faltan: [], peligro: false }); } },
});
try {
  await db();
  const tables = (await query("SELECT tablename FROM pg_tables WHERE schemaname='public'")).map(r => r.tablename);
  const snapshot = async () => Object.fromEntries(await Promise.all(tables.filter(t => t !== 'rate_limits').map(async t => [t, await query(`SELECT * FROM "${t}"`)])));
  const before = await snapshot();
  const logs = [];
  const original = { log: console.log, error: console.error, warn: console.warn };
  for (const key of Object.keys(original)) console[key] = (...args) => logs.push(args);
  let result;
  try {
    const response = await POST(new Request('http://localhost/api/tools/conversar', { method: 'POST', body: JSON.stringify({ kind: 'tutela', mensajes: [{ role: 'user', content: Object.entries(values).map(([campo, valor]) => quoteFor(campo, valor)).join('\n') }], confirmados: {} }) }));
    assert.equal(response.status, 200); result = await response.json();
  } finally { Object.assign(console, original); }
  assert.equal(aiCalls, 1); assert.deepEqual(logs, []); assert.deepEqual(await snapshot(), before);
  const counters = await query('SELECT * FROM rate_limits'); assert.equal(counters.length, 3); assert.ok(!JSON.stringify(counters).includes(words));
  // Simula la aceptación explícita y los datos introducidos en las pantallas privadas.
  const accepted = Object.fromEntries(result.propuestas.map(p => [p.campo, p.valor]));
  assert.equal(accepted.hechos, words); assert.equal(accepted.hechosAdicionales, extra);
  const data = { ...accepted, nombre: 'PERSONA FICTICIA', numeroDocumento: 'DOCUMENTO-FICTICIO', tipoDocumento: 'Cédula de ciudadanía', calidad: 'En nombre propio', ciudad: 'MUNICIPIO FICTICIO', correo: 'persona@example.invalid', derechos: [RIGHTS[7]], ...Object.fromEntries(TOOLS.tutela.confirmations.map(c => [c.name, 'si'])) };
  const document = await generate(new Request('http://localhost/api/tools/tutela', { method: 'POST', body: JSON.stringify(data) }), { params: Promise.resolve({ kind: 'tutela' }) });
  assert.equal(document.status, 200);
  const zip = await JSZip.loadAsync(await document.arrayBuffer());
  const xml = await zip.file('word/document.xml').async('string');
  assert.ok(xml.includes(words)); assert.ok(xml.includes(extra)); assert.ok(xml.includes('HECHOS ADICIONALES'));
  assert.deepEqual(await snapshot(), before);
} finally { await closeDatabase(); }
