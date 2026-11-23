import test from 'node:test';
import assert from 'node:assert/strict';
import { sameQuestion, withoutQuestions, cleanCompanionReply, companionTurn, isCaseTurn, medicalAlert, needsMoreStory, nextOpenQuestion, shouldSearch } from '../src/lib/companion.ts';
import { verifyAnswer } from '../src/lib/citation-verification.ts';
import { checkOfficialSentence, officialNote, sentenceReferences } from '../src/lib/official-check.ts';

const library = { topics: [], hits: [], sources: [], subtemas: [], reformulation: null, clarification: null };
const plan = (extra = {}) => JSON.stringify({ respuesta: 'Uy, eso es delicado. ¿Qué pasó cuando intentaste conseguirla?', urgencia: 'alta', hechos: ['casi no queda insulina'], derechos: ['salud'], responsable: 'EPS', pruebas: [], barreras: ['distancia'], mecanismo: null, medida_provisional: false, avanzar: false, citas: [], propuestas: [], ...extra });
const input = (...users) => ({ kind: 'tutela', confirmados: {}, preguntados: {}, mensajes: users.map(content => ({ role: 'user', content })) });

test('no pregunta lo obvio, no promete y deja una sola pregunta', () => {
  const story = 'Tengo diabetes y ya casi no me queda insulina';
  assert.equal(cleanCompanionReply('Gracias. ¿Sientes que tu salud corre peligro?', story), null);
  assert.equal(cleanCompanionReply('Lo siento. ¿Hay peligro para tu salud si esperas?', story), null);
  assert.equal(cleanCompanionReply('Tranquilo, vas a ganar la tutela.', story), null);
  assert.equal(cleanCompanionReply('Por ahora reduce la dosis de insulina.', story), null);
  assert.equal(cleanCompanionReply('Necesito tu nombre completo y número de documento.', story), null);
  assert.equal(cleanCompanionReply('Eso es delicado. ¿Cuántos días te quedan? ¿Y quién te atendió?', story), 'Eso es delicado. ¿Cuántos días te quedan?');
});

test('urgencia médica sin esperar datos y sin alarma por una escasez futura', async () => {
  assert.equal(medicalAlert('se me acabó la insulina'), true);
  assert.equal(medicalAlert('me queda insulina para cinco días'), false);
  const r = await companionTurn(input('Se me acabó la insulina y la EPS no me la da'), { libre: true, ask: async () => plan(), retrieve: async () => library });
  assert.match(r.respuesta, /urgencias o llama al 123/);
  const noModel = await companionTurn(input('Tengo dolor en el pecho y la EPS no me atiende'), { libre: true, ask: async () => { throw Error('no debe llamarse'); }, retrieve: async () => library });
  assert.match(noModel.respuesta, /Ve ya a urgencias/); assert.doesNotMatch(noModel.respuesta, /dificultó/);
  assert.match(r.respuesta, /No cambies ni suspendas/);
});

test('recomienda tutela con medida provisional y llena solo con palabras de la persona', async () => {
  const text = 'La EPS Nueva no me entrega la insulina y solo me queda para cinco días';
  const r = await companionTurn(input(text), { ask: async () => plan({ mecanismo: 'tutela', medida_provisional: true, propuestas: [{ campo: 'accionado', valor: 'EPS Nueva', cita_literal: 'La EPS Nueva' }, { campo: 'accionado', valor: 'Sanitas', cita_literal: 'Sanitas' }] }), retrieve: async () => library });
  assert.equal(r.mecanismo.id, 'tutela'); assert.equal(r.mecanismo.medidaProvisional, true);
  assert.deepEqual(r.propuestas.filter(p => p.campo === 'accionado').map(p => p.valor), ['EPS Nueva']);
  assert.ok(r.propuestas.some(p => p.campo === 'medidaProvisional' && p.valor === 'Sí'));
  assert.ok(!r.faltan.includes('medidaProvisional'));
});

test('falla del modelo: conserva el relato sin inventar y evita buscar en cada turno', async () => {
  const r = await companionTurn(input('Tengo un problema con una medicina'), { libre: true, ask: async () => { throw Error('caído'); }, retrieve: async () => library });
  assert.equal(r.mecanismo, null); assert.match(r.respuesta, /sigue aquí/);
  assert.equal(shouldSearch(['Tengo diabetes y la EPS no me entrega la insulina desde hace meses', 'No']), false);
  assert.equal(shouldSearch(['Tengo diabetes y la EPS no me entrega la insulina', 'Vivo por Minca y no tengo plata']), true);
});

test('un relato completo orienta desde el inicio y nunca repite el turno anterior', async () => {
  const story = 'Sufro del azúcar y en la farmacia me dicen que no hay medicamentos, llevo tres semanas así, estoy a cinco días de quedarme sin ellos y no sé qué hacer, estoy bastante asustado';
  assert.equal(needsMoreStory([story]), false);
  assert.equal(needsMoreStory(['Tengo un problema con una medicina']), true);
  const offer = 'Eso preocupa. Podemos evaluar una tutela con medida provisional. ¿Quieres que te ayude a prepararla?';
  const first = await companionTurn(input(story), { libre: true, ask: async () => plan({ respuesta: offer, mecanismo: 'tutela', medida_provisional: true }), retrieve: async () => library });
  assert.equal(first.mecanismo.id, 'tutela'); assert.equal(first.respuesta, offer);
  const repeated = 'Eso preocupa. ¿Qué te han respondido?';
  const second = await companionTurn({ ...input(story), mensajes: [{ role: 'user', content: story }, { role: 'assistant', content: repeated }, { role: 'user', content: 'Solo que hay que esperar' }] }, { libre: true, ask: async () => plan({ respuesta: repeated }), retrieve: async () => library });
  assert.notEqual(second.respuesta, repeated);
  assert.notEqual(nextOpenQuestion(['¿Qué te han respondido cuando has reclamado?']), '¿Qué te han respondido cuando has reclamado?');
});

test('el asistente conversa un relato y responde directo una pregunta concreta', () => {
  assert.equal(isCaseTurn('Tengo un problema con una medicina y no sé qué hacer'), true);
  assert.equal(isCaseTurn('Cinco días', [{ role: 'assistant', content: '¿Para cuántos días te queda?' }]), true);
  assert.equal(isCaseTurn('Un policía me insultó por ser indígena, ¿a dónde denuncio?'), false);
  assert.equal(isCaseTurn('¿Qué es la consulta previa?'), false);
});

test('la verificación oficial envía solo el número y distingue la página vacía', async () => {
  assert.deepEqual(sentenceReferences('Mi vecino Pedro citó la T-122 de 2021').map(r => [r.type, r.number, r.year]), [['T', '122', 2021]]);
  let asked = '';
  const real = async url => { asked = url; return new Response('<html>Sentencia T-122/21</html>'); };
  assert.equal((await checkOfficialSentence({ type: 'T', number: '122', year: 2021, yy: '21' }, real)).found, true);
  assert.equal(asked, 'https://www.corteconstitucional.gov.co/relatoria/2021/T-122-21.htm');
  assert.equal((await checkOfficialSentence({ type: 'T', number: '998', year: 2021, yy: '21' }, async () => new Response('<title>CORTE</title>'))).found, false);
  assert.equal(await officialNote('Sentencia T-777 de 2020', '', async () => { throw Error('sin red'); }), '');
});

test('un paso práctico citado a la Ruta no se pierde; una norma sin respaldo sí', async () => {
  const hit = { title: 'Ruta RAIZIA — Salud', heading: '', docType: 'Guía', entity: 'RAIZIA', docDate: '2026', content: 'Texto sobre otro asunto distinto.' };
  const out = await verifyAnswer('Primero presenta tu reclamo ante la EPS. [1]\nLa Ley 999 de 2020 te protege. [1]', [hit]);
  assert.match(out, /Primero presenta tu reclamo/); assert.doesNotMatch(out, /Ley 999/);
});

test('la tutela no insiste en la misma pregunta y los hechos no incluyen preguntas', async () => {
  const asked = 'Entiendo. ¿Qué te han dicho exactamente en la EPS cuando has ido a reclamar?';
  assert.equal(sameQuestion('Ahora, ¿me podrías contar qué te han dicho exactamente en la EPS cuando has ido a reclamar y si hay radicado?', asked), true);
  assert.equal(sameQuestion('¿Qué pruebas tienes?', asked), false);
  assert.equal(withoutQuestions('Sanitas no me entrega la insulina. ¿A quién acudo?'), 'Sanitas no me entrega la insulina.');
  const r = await companionTurn({ ...input('x'), mensajes: [{ role: 'user', content: 'Sanitas no me entrega la insulina desde octubre. ¿Qué hago?' }, { role: 'assistant', content: asked }, { role: 'user', content: 'Tengo la fórmula' }] }, { ask: async () => plan({ respuesta: 'Bien. ¿Me cuentas qué te han dicho exactamente en la EPS cuando has ido a reclamar?' }), retrieve: async () => library });
  assert.equal(sameQuestion(r.respuesta, asked), false);
  assert.doesNotMatch(r.propuestas.find(p => p.campo === 'hechos').valor, /\?/);
});

test('la medida urgente reutiliza lo pedido y no repite datos confirmados', async () => {
  const said = 'Quiero que me entreguen la insulina completa en Minca';
  const r = await companionTurn({ ...input(said), confirmados: { medidaProvisional: 'Sí', cuando: 'desde el 3 de octubre' } }, { ask: async () => plan({ propuestas: [{ campo: 'pretensiones', valor: said, cita_literal: said }] }), retrieve: async () => library });
  assert.equal(r.propuestas.find(p => p.campo === 'medida').valor, said);
  assert.ok(!r.faltan.includes('medida'));
});
