import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanCompanionReply, companionTurn, isCaseTurn, medicalAlert, shouldSearch } from '../src/lib/companion.ts';
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
