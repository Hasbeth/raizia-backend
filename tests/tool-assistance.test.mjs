import test from 'node:test';
import assert from 'node:assert/strict';
import { TOOLS } from '../src/lib/tools-config.ts';
import { conversationFields } from '../src/lib/conversation-catalog.ts';
import { converse, parseConversationInput } from '../src/lib/tool-conversation.ts';
import { assistTool } from '../src/lib/tool-assistance.ts';
import { createSessionCache } from '../src/lib/session-cache.ts';
import { isSmallTalk, retrieve } from '../src/lib/rag.ts';
import { assertGeminiSchema } from './support/gemini-schema.mjs';

const story = 'La entidad ficticia no respondió mi solicitud de transporte.';
const input = (kind = 'tutela', extras = {}) => parseConversationInput({ kind, mensajes: [{ role: 'user', content: story }], confirmados: { hechos: story }, ...extras });
const output = extra => JSON.stringify({ explicacion: '', ejemplo: '', pregunta: null, pasos: [], mejoras: [], alternativa: null, ...extra });
for (const kind of Object.keys(TOOLS)) {
  test(`${kind}: conversación, propuesta con cita y ayuda de todas las preguntas`, async () => {
    const field = conversationFields(kind).find(f => f.name === 'hechos') || conversationFields(kind)[0];
    let calls = 0;
    const request = input(kind, { confirmados: {} });
    const result = await converse(request, { ask: async (_s, data, _signal, schema) => {
      calls++; assertGeminiSchema(schema); assert.equal(JSON.parse(data).datos.kind, kind);
      return JSON.stringify({ respuesta: 'Entiendo que la entidad ficticia no respondió tu solicitud de transporte.', pregunta: '¿Qué has intentado para resolverlo?', propuestas: [{ campo: field.name, valor: story, cita_literal: story }, { campo: field.name, valor: 'INVENTADO' }], faltan: [], peligro: false });
    } });
    assert.equal(calls, 1); assert.equal(result.propuestas.length, 1); assert.equal(result.propuestas[0].cita_literal, story);
    assert.ok((result.pregunta?.match(/\?/g) || []).length <= 1); assert.deepEqual(request.confirmados, {});
    for (const f of TOOLS[kind].steps.flatMap(s => s.fields)) {
      const req = input(kind, { contexto: f.name });
      let helpCalls = 0;
      const help = await assistTool(req, 'ayuda', { retrieve: async () => assert.fail('Ayuda pedagógica sin búsqueda'), ask: async (system, json, _signal, schema) => {
        helpCalls++; assertGeminiSchema(schema); assert.match(system, /No inventes/); assert.equal(JSON.parse(json).preguntaActual.name, f.name);
        return output({ explicacion: 'Esta pregunta te ayuda a explicar lo que necesitas con tus propias palabras.', ejemplo: 'Por ejemplo, si no recuerdas un dato, puedes decir que no lo recuerdas.', pregunta: '¿Qué parte te resulta difícil?' });
      } });
      assert.equal(helpCalls, 1); assert.match(help.respuesta, /tus propias palabras/); assert.match(help.ejemplo, /^Por ejemplo, si/);
      assert.deepEqual(help.propuestas, []);
    }
  });
}

test('Peligro antes del proveedor y nunca propuesto como campo', async () => {
  for (const kind of Object.keys(TOOLS)) {
    const request = input(kind, { mensajes: [{ role: 'user', content: 'Me van a matar.' }] });
    const deps = { ask: async () => assert.fail('No llamar IA'), retrieve: async () => assert.fail('No buscar') };
    for (const result of [await converse(request, deps), await assistTool(request, 'ayuda', deps)]) {
      assert.match(result.respuesta, /123.*atención urgente/); assert.equal(result.pregunta, '¿Estás a salvo ahora?'); assert.deepEqual(result.propuestas, []);
    }
  }
});

test('Reconocimiento natural sobre lo contado, sin repetición consecutiva', async () => {
  const ack = 'Entiendo que la entidad ficticia no respondió tu solicitud de transporte.';
  const ask = async () => JSON.stringify({ respuesta: ack, pregunta: null, propuestas: [], faltan: [], peligro: false });
  const first = await converse(input(), { ask }); assert.equal(first.respuesta, ack);
  const next = await converse(input('tutela', { mensajes: [{ role: 'user', content: story }, { role: 'assistant', content: ack }, { role: 'user', content: 'Todavía no respondió.' }] }), { ask });
  assert.notEqual(next.respuesta, first.respuesta);
});

test('Revisión hasta tres mejoras con evidencia; sugerir no modifica el borrador', async () => {
  const request = input(); const before = structuredClone(request);
  const result = await assistTool(request, 'revision', { retrieve: async () => assert.fail('Sin biblioteca'), ask: async () => output({ mejoras: [
    { campo: 'hechos', motivo: 'fecha', cita_literal: story }, { campo: 'pretensiones', motivo: 'peticion', cita_literal: '' }, { campo: 'pruebas', motivo: 'prueba', cita_literal: '' },
    { campo: 'hechos', motivo: 'fecha', cita_literal: 'INVENTADO' },
  ] }) });
  assert.equal(result.mejoras.length, 3); assert.deepEqual(request, before);
  const invalid = await assistTool(request, 'revision', { retrieve: async () => assert.fail(), ask: async () => output({ mejoras: [{ campo: 'hechos', motivo: 'fecha', cita_literal: 'INVENTADO' }] }) });
  assert.deepEqual(invalid.mejoras, []);
});

test('Orientación y qué sigue: cita literal, fuente y alternativa verificadas sin borrar datos', async () => {
  const quote = 'Puedes presentar un derecho de petición a la entidad con copia de tu solicitud.';
  const source = { chunkId: 1, documentId: 1, title: 'Ruta RAIZIA — salud (fixture)', content: quote, docType: 'Guía', entity: 'Entidad ficticia', heading: 'Qué hacer', officialUrl: 'https://example.invalid/fuente' };
  const library = { hits: [source], sources: [{ ...source, n: 1 }], subtemas: [], topics: [], reformulation: null, clarification: null };
  const request = input(); const before = structuredClone(request);
  for (const action of ['orientacion', 'siguiente']) {
    let calls = 0;
    const result = await assistTool(request, action, { retrieve: async () => library, ask: async () => { calls++; return output({ alternativa: 'peticion', pasos: [
      { texto: 'Presenta un derecho de petición a la entidad con copia de tu solicitud.', fuente: 1, cita_literal: quote },
      { texto: 'Debes recibir respuesta en 999 días.', fuente: 1, cita_literal: quote },
      { texto: quote, fuente: 9, cita_literal: quote }, { texto: quote, fuente: 1, cita_literal: 'CITA INVENTADA' },
    ] }); } });
    assert.equal(calls, 1); assert.equal(result.pasos.length, 1); assert.equal(result.alternativa, 'peticion'); assert.equal(result.sources.length, 1); assert.deepEqual(request, before);
  }
});

test('429 y timeout conservan ayuda opcional, sin reintentar una acción', async () => {
  let calls = 0;
  const r = await converse(input(), { ask: async () => { calls++; throw Error('429'); } });
  assert.equal(calls, 1); assert.equal(r.respaldo, true); assert.deepEqual(r.propuestas, []);
  const timeout = await converse(input(), { timeoutMs: 5, ask: async () => new Promise(() => {}) });
  assert.equal(timeout.respaldo, true);
});

test('Caché normalizada: solicitudes concurrentes comparten trabajo y no mezclan contenido', async () => {
  const cache = createSessionCache(); let calls = 0;
  const work = async () => { calls++; return { ok: true }; };
  await Promise.all([cache({ texto: '  texto   ficticio ' }, work), cache({ texto: 'texto ficticio' }, work)]);
  assert.equal(calls, 1); await cache({ texto: 'otro texto' }, work); assert.equal(calls, 2);
  await assert.rejects(cache({ texto: 'error' }, async () => { throw Error('stub'); }));
  await cache({ texto: 'error' }, work); assert.equal(calls, 3);
});

test('Agradecimiento con EPS o hechos nunca toma el atajo de charla', async () => {
  for (const text of ['gracias, me pasó algo con la EPS', 'hola, el policía me insultó', 'gracias, no me dan cupo']) {
    assert.equal(isSmallTalk(text), false);
    const result = await retrieve(text, '', undefined, [], { reformulate: async () => ({ tipo: 'charla', subtemas: [], respuesta: 'Con gusto', falta: null }), topics: async () => assert.fail('Primero aclara') });
    assert.match(result.reply, /¿/); assert.notEqual(result.reply, 'Con gusto');
  }
});
