// Ejecutar con los dos builds locales en 3311/4311. Nunca usa destinos externos.
import assert from 'node:assert/strict';
import http from 'node:http';
import JSZip from 'jszip';
import { TOOL_LIST } from '../../src/lib/tools-config.ts';
import { caseData } from '../fixtures/tools-synthetic.mjs';
function request(path, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port: 3311, path, method: body ? 'POST' : 'GET', headers: body ? { 'Content-Type': 'application/json' } : {} }, res => {
      const parts = []; res.on('data', chunk => parts.push(chunk)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(parts) }));
    });
    req.on('error', reject); req.setTimeout(15000, () => req.destroy(new Error('Tiempo de prueba agotado')));
    req.end(body ? JSON.stringify(body) : undefined);
  });
}
const landing = await request('/herramientas');
assert.equal(landing.status, 200); assert.match(landing.body.toString(), /¿Qué necesitas resolver\?/);
assert.match(landing.body.toString(), /Ganamos una tutela y no cumplen/);
for (const tool of TOOL_LIST) {
  const page = await request(`/herramientas/${tool.slug}`);
  assert.equal(page.status, 200); assert.match(page.body.toString(), /Antes de empezar/);
  const data = { ...caseData };
  for (const f of tool.steps.flatMap(s => s.fields)) if (f.required && !data[f.name]) data[f.name] = f.type === 'checkboxes' ? [f.options[0]] : f.options?.[0] || 'DATO FICTICIO DE PRUEBA';
  for (const c of tool.confirmations) data[c.name] = 'si';
  data.edicion_hechos = 'Primero. TEXTO FICTICIO EDITADO [completar: dato de prueba]';
  const doc = await request(`/api/tools/${tool.kind}`, data);
  assert.equal(doc.status, 200, `${tool.kind}: ${doc.body.toString().slice(0, 80)}`);
  assert.match(doc.headers['content-type'], /wordprocessingml/);
  assert.equal(doc.headers['cache-control'], 'no-store');
  const zip = await JSZip.loadAsync(doc.body);
  const xml = await zip.file('word/document.xml').async('string');
  assert.match(xml, /TEXTO FICTICIO EDITADO/); assert.match(xml, /w:highlight/);
  console.log(`${tool.kind}: página, proxy HTTP, generación Word y edición verificados`);
}
const orientation = await request('/api/tools/orientar', { text: 'Ganamos la tutela y no cumplen el fallo.', current: 'tutela' });
const route = JSON.parse(orientation.body); assert.equal(route.fits, false); assert.equal(route.routes[0].id, 'desacato');
const original = 'RELATO FICTICIO: pedí copia el 2026-11-02.';
const organized = await request('/api/tools/organizar', { text: original, kind: 'hechos' });
assert.deepEqual(JSON.parse(organized.body), { text: original, organized: false, questions: [] });
const denied = await request('/api/tools/peticion', {}); assert.equal(denied.status, 400);
console.log('Orientación, respaldo sin IA y validación HTTP verificados. Solo datos ficticios; cero nube.');
