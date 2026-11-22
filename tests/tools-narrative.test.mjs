import assert from 'node:assert/strict';
import test from 'node:test';
import { readdirSync, readFileSync } from 'node:fs';
import { ORGANIZE_PROMPTS, PROBE_PROMPTS } from '../src/lib/narrative-prompts.ts';
import { moduleHarness } from './support/module-harness.mjs';
process.env.LLM_PROVIDER = 'ollama';
const { organizeNarrative, probeNarrative } = await import('../src/lib/rag.ts');

test('Organizar usa la guía, conserva hechos y rechaza números inventados con transporte simulado', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const original = 'El 2026-11-02 pedí copia. El 2026-11-03 no respondieron.';
  let reply = 'El 2026-11-02 pedí copia.\nEl 2026-11-03 no respondieron.';
  const calls = [];
  globalThis.fetch = async (_url, options) => { calls.push(JSON.parse(options.body)); return Response.json({ message: { content: reply } }); };
  assert.equal(await organizeNarrative('modelo-stub', original, 'hechos'), reply);
  assert.equal(calls[0].messages[0].content, ORGANIZE_PROMPTS.hechos);
  assert.match(calls[0].messages[0].content, /Conserva TODOS/);
  assert.match(calls[0].messages[0].content, /cronológicamente/);
  reply += '\nDeben responder en 48 horas.';
  assert.equal(await organizeNarrative('modelo-stub', original, 'hechos'), '');
  reply = 'Pedí copia.';
  assert.equal(await organizeNarrative('modelo-stub', original, 'hechos'), '');
  assert.match(ORGANIZE_PROMPTS.peticiones, /SOLO con lo que la persona dijo/);
  assert.match(PROBE_PROMPTS.peticiones, /Pregunta SOLO lo que falta/);
  reply = '¿Quién debe entregarlo?\n¿Cuándo lo necesitas?';
  assert.equal((await probeNarrative('modelo-stub', 'Que me entreguen lo pedido.', 'peticiones')).length, 2);
});
test('Ruta organizar: respaldo literal sin IA, sin truncar relatos y propuesta sin aceptación automática', async () => {
  const load = rag => moduleHarness('../../src/rutas/tools/organizar/route.ts', { '@/lib/rag': rag });
  const request = text => new Request('http://localhost/api/tools/organizar', { method: 'POST', body: JSON.stringify({ text, kind: 'hechos' }) });
  const offline = load({ ollamaStatus: async () => ({ available: false }) });
  const original = 'RELATO FICTICIO SIN CAMBIOS';
  assert.deepEqual(await (await offline.POST(request(original))).json(), { text: original, organized: false, questions: [] });
  const long = await offline.POST(request('A'.repeat(8001))); assert.equal(long.status, 400); assert.equal((await long.json()).text.length, 8001);
  const onlineStub = load({ ollamaStatus: async () => ({ available: true, model: 'stub' }), organizeNarrative: async () => 'PROPUESTA FICTICIA' });
  assert.deepEqual(await (await onlineStub.POST(request(original))).json(), { text: 'PROPUESTA FICTICIA', organized: true });
});
test('Fixtures públicos: sin identificadores personales largos ni correos ajenos a dominios de ejemplo', () => {
  for (const file of readdirSync(new URL('./fixtures/', import.meta.url)).filter(f => /\.(json|mjs)$/.test(f))) {
    const text = readFileSync(new URL(`./fixtures/${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(text, /\b\d{7,}\b/, file);
    for (const email of text.match(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi) || []) assert.match(email, /@example\.(?:invalid|com|org)$/i, file);
  }
});
