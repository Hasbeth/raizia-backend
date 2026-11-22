import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { TUTELA, TOOLS, RIGHTS, tutelaDefaults, validateTool, interviewQuestions } from '../src/lib/tools-config.ts';
import { buildModel, buildDocument } from '../src/lib/docgen.ts';
import { reviewQuality } from '../src/lib/tools-quality.ts';
import { moduleHarness } from './support/module-harness.mjs';

const short = tutelaDefaults({ hechos: 'La entidad ficticia negó un medicamento ficticio.', accionado: 'ENTIDAD FICTICIA', actuaciones: 'Pedí una solución ficticia y fue negada. No conozco otro camino.', cuando: 'En noviembre de 2026; el problema sigue.', medidaProvisional: 'No', derechos: [RIGHTS[7]], pretensiones: 'Que la entidad ficticia entregue el medicamento ficticio.', pruebas: 'ninguna por ahora', nombre: 'PERSONA FICTICIA', numeroDocumento: 'DOCUMENTO-FICTICIO', ciudad: 'MUNICIPIO FICTICIO', correo: 'persona@example.invalid', juramento: 'si', revisado: 'si' });

test('Word de doce preguntas: secciones profesionales, derivaciones fieles y faltantes resaltados', async () => {
  assert.equal(interviewQuestions(TUTELA, short).length, 12);
  assert.deepEqual(validateTool(TUTELA, short), {});
  assert.equal(reviewQuality('tutela', short).level, 'amber');
  assert.equal(reviewQuality('tutela', short).issues.some(i => i.level === 'red'), false);
  const model = buildModel('tutela', short);
  assert.deepEqual(model.sections.map(s => s.id), ['hechos', 'procedencia', 'derechos', 'pretensiones', 'fundamentos', 'pruebas', 'competencia', 'juramento', 'notificaciones']);
  const procedure = model.sections.find(s => s.id === 'procedencia').paragraphs.join('\n');
  for (const answer of [short.hechos, short.actuaciones, short.cuando, short.accionado]) assert.ok(procedure.includes(answer));
  const requests = model.sections.find(s => s.id === 'pretensiones').paragraphs.join('\n');
  assert.match(requests, /Responsable: ENTIDAD FICTICIA/);
  assert.doesNotMatch(requests, /Hechos de apoyo|Pruebas de apoyo/);
  assert.equal(reviewQuality('tutela', short).issues.some(i => ['demuestra', 'pruebasApoyo'].includes(i.field)), false);
  assert.doesNotMatch(requests, /\[completar:|Plazo solicitado|Verificación del cumplimiento/);
  assert.doesNotMatch(JSON.stringify(model), /48 horas|cuarenta y ocho|mayor de edad/);
  assert.deepEqual(model.sections.find(s => s.id === 'pruebas').paragraphs, ['ninguna por ahora']);
  assert.equal(model.missing.length, 1);
  assert.match(model.missing[0], /dirección o correo judicial de la parte accionada/);
  assert.equal(model.addressee[1], short.ciudad);
  assert.match(model.sections.find(s => s.id === 'competencia').paragraphs[0], /Presento esta tutela desde MUNICIPIO FICTICIO/);
  assert.doesNotMatch(model.sections.find(s => s.id === 'competencia').paragraphs[0], /ocurrió/);
  const zip = await JSZip.loadAsync(await buildDocument('tutela', short));
  const xml = await zip.file('word/document.xml').async('string');
  for (const marker of model.missing) assert.ok(xml.includes(marker), marker);
  assert.match(xml, /w:highlight w:val="yellow"/);
  assert.match(xml, /PROCEDENCIA/); assert.match(xml, /JURAMENTO/);
  assert.equal((xml.match(/\[completar:/g) || []).length, 1);
  assert.doesNotMatch(xml, /48 horas/);
  assert.match(buildModel('tutela', { ...short, plazos: '48 horas' }).sections.find(s => s.id === 'pretensiones').paragraphs[0], /48 horas/);
});

test('Lugar explícito prevalece; prueba sin explicación y juramento pendiente no son faltantes', () => {
  const model = buildModel('tutela', { ...short, lugarHechos: 'OTRO MUNICIPIO FICTICIO', pruebas: 'Carta ficticia de negativa', juramento: '' });
  assert.equal(model.addressee[1], 'OTRO MUNICIPIO FICTICIO');
  assert.match(model.sections.find(s => s.id === 'competencia').paragraphs[0], /ocurrió en OTRO MUNICIPIO FICTICIO/);
  assert.doesNotMatch(model.sections.find(s => s.id === 'pruebas').paragraphs[0], /completar|Demuestra/);
  assert.match(model.sections.find(s => s.id === 'juramento').paragraphs[0], /Confirmación pendiente/);
  assert.equal(model.missing.length, 1);
  assert.ok(reviewQuality('tutela', { ...short, juramento: '' }).issues.some(i => /Confirmación pendiente/.test(i.message)));
  assert.ok(!reviewQuality('tutela', short).issues.some(i => /juramento/.test(i.message)));
  assert.deepEqual(buildModel('tutela', { ...short, contactoAccionado: 'entidad@example.invalid' }).missing, []);
  assert.ok(TUTELA.steps.every(s => s.fields.every(f => !['hechosApoyo', 'pruebasApoyo'].includes(f.name))));
});

test('Condicionales y datos anteriores conservan medida, representación, pruebas y plazos expresos', () => {
  const data = { ...short, medidaProvisional: 'Sí', medida: 'MEDIDA FICTICIA', razonMedida: 'RAZÓN FICTICIA', calidad: 'En representación de otra persona', comunidad: 'PERSONA REPRESENTADA FICTICIA', representacion: 'AUTORIZACIÓN FICTICIA', motivoAhora: 'MOTIVO FICTICIO', otrosMedios: 'OTRO MEDIO FICTICIO', pruebas: 'PRUEBA FICTICIA', demuestra: 'CONTENIDO FICTICIO', plazos: 'PLAZO FICTICIO' };
  assert.equal(interviewQuestions(TUTELA, data).length, 14);
  const model = buildModel('tutela', data);
  for (const key of ['medida', 'razonMedida', 'comunidad', 'representacion', 'motivoAhora', 'otrosMedios', 'demuestra', 'plazos']) assert.ok(JSON.stringify(model).includes(data[key]), key);
  assert.match(model.sections.find(s => s.id === 'medida').paragraphs[0], /MEDIDA FICTICIA.*RAZÓN FICTICIA/);
  const own = buildModel('tutela', { ...data, calidad: 'En nombre propio', medidaProvisional: 'No' });
  assert.equal(own.sections.some(s => s.id === 'medida'), false);
  assert.doesNotMatch(own.intro, /PERSONA REPRESENTADA/);
});

test('API acepta camino corto; juramento y borrador siguen obligatorios', async () => {
  const api = moduleHarness('../../src/rutas/tools/[kind]/route.ts', { '@/lib/docgen': { buildModel, buildDocument }, '@/lib/tools-config': { TOOLS, validateTool } });
  const send = data => api.POST(new Request('http://localhost/api/tools/tutela', { method: 'POST', body: JSON.stringify(data) }), { params: Promise.resolve({ kind: 'tutela' }) });
  const response = await send(short);
  assert.equal(response.status, 200);
  const zip = await JSZip.loadAsync(await response.arrayBuffer());
  assert.match(await zip.file('word/document.xml').async('string'), /PERSONA FICTICIA/);
  for (const key of ['juramento', 'revisado']) assert.equal((await send({ ...short, [key]: '' })).status, 400);
  assert.equal((await send({ ...short, medidaProvisional: 'Sí' })).status, 400);
});
