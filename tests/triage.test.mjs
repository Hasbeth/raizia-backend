import assert from "node:assert/strict";
import test from "node:test";
import { answerDoubts, buildRoute, ROUTE_IDS, toolFits, triageByRules } from "../src/lib/triage.ts";
import { TOOL_LIST } from "../src/lib/tools-config.ts";
import { relatoAmenaza, relatoArhuaco, relatoPolicial, relatoPuestoSalud, relatos } from "./fixtures/relatos.mjs";

for (const [nombre, relato, rutas] of relatos) {
  test(`Relatos: ${nombre}`, () => {
    assert.deepEqual(triageByRules(relato), rutas, `Las rutas y su orden deben corresponder al relato: ${relato}`);
  });
}

test("El relato arhuaco conserva sus rutas sin tildes, en mayúsculas y con espacios exteriores", () => {
  const variantes = [relatoArhuaco.toUpperCase(), relatoArhuaco.normalize("NFD").replace(/\p{M}/gu, ""), `  ${relatoArhuaco}  `];
  for (const relato of variantes) {
    assert.deepEqual(triageByRules(relato), ["consulta-previa", "popular", "proteccion"], "Las variantes ortográficas conservan las tres rutas ordenadas.");
  }
});

test("Repetir la misma señal no aumenta su peso frente a otro asunto", () => {
  assert.deepEqual(triageByRules("basura basura basura basura nos amenazan tenemos miedo"), ["proteccion", "popular"], "Cada pista distinta cuenta una sola vez.");
});

test("Una entrada vacía o de espacios no inventa rutas ni dudas", () => {
  for (const relato of ["", " \n\t "]) {
    assert.deepEqual(triageByRules(relato), [], "No hay hechos que clasificar.");
    assert.deepEqual(answerDoubts(relato), [], "No hay dudas expresadas.");
  }
});

test("La agresión policial incluye lesiones, queja contra funcionario y discriminación", () => {
  const ruta = buildRoute("denuncia", relatoPolicial);
  assert.equal(triageByRules(relatoPolicial)[0], "denuncia", "La denuncia debe ser la primera ruta.");
  assert.ok(ruta.steps.some((paso) => paso.includes("lesión quede registrada")), "Debe incluir el registro de la lesión.");
  assert.ok(ruta.steps.some((paso) => paso.includes("policía u otro funcionario") && paso.includes("Procuraduría")), "Debe incluir la queja por conducta del funcionario.");
  assert.ok(ruta.steps.some((paso) => paso.includes("discriminación por razones étnicas")), "Debe incluir la discriminación.");
  assert.equal(toolFits("peticion", triageByRules(relatoPolicial)), false, "La petición no cubre esta denuncia.");
});

test("Una amenaza sin agresión produce protección y no añade pasos de lesiones, policía o discriminación", () => {
  assert.deepEqual(triageByRules(relatoAmenaza), ["proteccion"], "La amenaza corresponde a protección.");
  const pasos = buildRoute("denuncia", relatoAmenaza).steps;
  assert.equal(pasos.length, 3, "Solo deben aparecer los tres pasos incondicionales de denuncia.");
  assert.ok(pasos.every((paso) => !/lesión|policía u otro funcionario|discriminación/.test(paso)), "No deben suponerse hechos que el relato no menciona.");
});

test("El abuso de confianza se puede denunciar sin presumir agresión física o discriminación", () => {
  // Un posible abuso de confianza no es, por sí solo, un falso positivo de delito.
  const ruta = buildRoute("denuncia", "abuso de confianza del vecino");
  assert.equal(ruta.steps.length, 3, "El abuso de confianza no activa pasos propios de una agresión física.");
});

test("La falta de médico y de respuesta permite preparar una petición", () => {
  const rutas = triageByRules(relatoPuestoSalud);
  assert.deepEqual(rutas, ["peticion"], "La ausencia de médico sin negación urgente activa petición.");
  assert.equal(toolFits("peticion", rutas), true, "La herramienta debe servir para esta ruta.");
});

test("La ruta ambiental añade atención médica únicamente cuando se mencionan enfermos", () => {
  const sinEnfermos = buildRoute("popular", "el agua baja turbia");
  const conEnfermos = buildRoute("popular", "el agua baja turbia y los niños se enfermaron");
  assert.equal(sinEnfermos.steps.length, 3, "Sin enfermos solo hay tres pasos generales.");
  assert.equal(conEnfermos.steps.length, 4, "La enfermedad añade un paso.");
  assert.ok(conEnfermos.steps.some((paso) => paso.includes("puesto de salud")), "Debe recomendar registrar la atención médica.");
  assert.equal(buildRoute("popular", "el agua baja turbia").steps.length, 3, "Las llamadas anteriores no deben modificar los pasos compartidos.");
});

test("Todas las rutas construidas conservan su identificador y enlazan herramientas existentes", () => {
  for (const id of ROUTE_IDS) {
    const ruta = buildRoute(id, "");
    assert.equal(ruta.id, id, `La ruta ${id} conserva su identificador.`);
    assert.ok(ruta.steps.length > 0 && ruta.steps.every((paso) => typeof paso === "string" && paso.trim()), `La ruta ${id} tiene pasos legibles.`);
    if (ruta.tool) assert.ok(TOOL_LIST.some((herramienta) => herramienta.slug === ruta.tool.slug), `La herramienta de ${id} existe.`);
  }
  assert.equal(buildRoute("justicia-propia", "").tool, undefined, "La justicia propia no requiere un formulario de RAIZIA.");
});

const preguntas = [
  "¿Sin los papeles de la tierra ya no podemos reclamar?",
  "¿Solo lo puede hacer el gobernador del cabildo?",
  "Si ponemos una queja, ¿van a saber quién fue?",
  "No tenemos plata para viajar ni para pagar abogado. ¿Qué hacemos?",
];

test("El relato arhuaco recibe cuatro respuestas a sus dudas en el orden previsto", () => {
  const dudas = answerDoubts(relatoArhuaco);
  assert.equal(dudas.length, 4, "Deben reconocerse las cuatro dudas del relato largo.");
  assert.deepEqual(dudas.map((duda) => duda.q), preguntas, "Las dudas deben conservar su orden.");
  assert.ok(dudas.every((duda) => duda.a.trim()), "Cada duda debe tener una respuesta.");
});

for (const [relato, indice] of [
  ["no tengo escritura ni titulo", 0],
  ["cualquiera puede hacer eso o solo el gobernador", 1],
  ["quisiera hacerlo sin dar mi nombre", 2],
  ["no tengo dinero para pagar un abogado", 3],
]) {
  test(`Dudas: ${relato}`, () => {
    assert.deepEqual(answerDoubts(relato).map((duda) => duda.q), [preguntas[indice]], "Debe responder solo la duda expresada.");
  });
}

test("Las dudas repetidas no se duplican y su orden no depende del orden del relato", () => {
  const relato = "pagar abogado sin abogado van a saber quien fue solo el gobernador sin papeles sin papeles";
  assert.deepEqual(answerDoubts(relato).map((duda) => duda.q), preguntas, "Cada duda aparece una sola vez en el orden del catálogo.");
});

test("Un saludo no genera respuestas a dudas inexistentes", () => {
  assert.deepEqual(answerDoubts("hola buenas"), [], "No deben agregarse dudas por defecto.");
});

const compatibilidades = [
  ["peticion", ["peticion"], true],
  ["peticion", ["denuncia"], false],
  ["peticion", ["consulta-previa"], false],
  ["tutela", ["peticion", "tutela"], true],
  ["consulta-previa", ["consulta-previa", "popular"], true],
  ["reclamacion", ["popular"], true],
  ["reclamacion", ["cumplimiento"], true],
  ["reclamacion", ["proteccion"], false],
  ["popular", ["popular"], true],
  ["cumplimiento", ["cumplimiento"], true],
  ["grupo", ["grupo"], true],
  ["grupo", ["peticion"], false],
  ["acompanamiento", ["denuncia", "proteccion"], true],
  ["desconocida", ["peticion"], false],
];
for (const [herramienta, rutas, sirve] of compatibilidades) {
  test(`Compatibilidad: ${herramienta} con ${rutas.join(" y ")}`, () => {
    assert.equal(toolFits(herramienta, rutas), sirve, "La compatibilidad debe corresponder a las rutas que cubre la herramienta.");
  });
}

test("Sin rutas reconocidas se permite continuar en cada herramienta", () => {
  for (const herramienta of TOOL_LIST) assert.equal(toolFits(herramienta.kind, []), true, "Sin clasificación no se bloquea la herramienta.");
});

// Defectos reproducibles: se ejecutan las expectativas deseadas como pendientes.
// No convertimos la clasificación incorrecta actual en un resultado aceptado.
test("Un golpe de calor no debe clasificarse como una agresión denunciable", () => {
  // triage.ts: el patrón «golp» no distingue un accidente por calor de un golpe violento.
  assert.deepEqual(triageByRules("mi abuelo tuvo un golpe de calor trabajando al sol"), [], "Un golpe de calor no describe una agresión.");
});

test("El dolor no debe confundirse con un problema ambiental de olor", () => {
  // triage.ts: «olor» coincide dentro de «dolor».
  assert.deepEqual(triageByRules("la EPS no me autoriza la cirugia y tengo mucho dolor"), ["tutela"], "El dolor no debe añadir una acción popular.");
});

test("La obra de teatro de la comunidad no debe activar consulta previa", () => {
  // triage.ts: basta la combinación «obra» + «comunidad», sin afectación territorial.
  assert.deepEqual(triageByRules("la obra de teatro de la comunidad quedo bonita"), [], "Una actividad cultural inocente no describe una obra que afecte el territorio.");
});

test("Una amenaza con agresiones expresamente negadas debe conservar solo protección", () => {
  // triage.ts: los patrones puntúan hechos negados como si hubieran ocurrido.
  assert.deepEqual(triageByRules("me amenazaron pero no me pegaron y no hubo insultos"), ["proteccion"], "Negar golpes e insultos no debe activar denuncia por agresión.");
});

test("Negar lesiones, participación policial e insultos no debe añadir esos pasos", () => {
  // triage.ts: los pasos condicionales tampoco comprueban la negación.
  const ruta = buildRoute("denuncia", "me amenazaron pero no me pegaron, no intervino la policia y no hubo insultos");
  assert.equal(ruta.steps.length, 3, "Solo deben aparecer los pasos generales cuando los demás hechos están negados.");
});

test("Un salto de línea no debe ocultar la negativa de una cirugía", () => {
  // triage.ts: los comodines «.» de tutela no atraviesan saltos de línea.
  assert.deepEqual(triageByRules("La EPS\nno me autoriza\nla cirugía de mi hija"), ["tutela"], "Escribir en varias líneas no debe perder la ruta urgente.");
});

test("Tampoco nos responden debe reconocer la falta de respuesta en un relato mixto", () => {
  // triage.ts: la petición reconoce «no nos responden», pero omite «tampoco nos responden».
  assert.deepEqual(triageByRules("nos pegaron y no cumple la resolucion tampoco nos responden"), ["denuncia", "cumplimiento", "peticion"], "La falta de respuesta expresada con tampoco también necesita una ruta.");
});
