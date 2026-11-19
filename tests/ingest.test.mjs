import assert from "node:assert/strict";
import test from "node:test";
import { chunkText, normalize } from "../src/lib/ingest.ts";

const articuloUno = "ARTÍCULO 1°. La comunidad participará en las decisiones que afecten su territorio y sus prácticas culturales.";
const articuloDos = "ARTÍCULO 2. Las autoridades recibirán las solicitudes y comunicarán sus decisiones a todas las personas interesadas.";

test("Una ley con ordinal y con número simple produce encabezados de ambos artículos", () => {
  const fragmentos = chunkText(`${articuloUno}\n${articuloDos}`);
  assert.equal(fragmentos.length, 2, "Los artículos deben producir dos fragmentos distintos.");
  assert.ok(fragmentos[0].heading.includes("Artículo 1"), "El primer encabezado debe identificar el artículo con ordinal.");
  assert.ok(fragmentos[1].heading.includes("Artículo 2"), "El segundo encabezado debe identificar el artículo numérico.");
  assert.equal(fragmentos[0].content, articuloUno, "El texto del primer artículo debe conservarse completo.");
  assert.equal(fragmentos[1].content, articuloDos, "El texto del segundo artículo debe conservarse completo.");
});

test("Los artículos pegados en una línea se separan como en un PDF", () => {
  const fragmentos = chunkText(`${articuloUno} ${articuloDos}`);
  assert.deepEqual(fragmentos.map((fragmento) => fragmento.heading), ["Artículo 1", "Artículo 2"], "Los artículos en mayúsculas deben separarse aunque compartan línea.");
});

test("Una sentencia no usa sus artículos citados como encabezados propios", () => {
  const texto = `Sentencia T-123/20\nEsta providencia revisa la protección de los derechos de una comunidad y explica los antecedentes.\nI. ANTECEDENTES\nLa comunidad presentó una solicitud de protección porque considera afectados sus derechos.\n${articuloUno}\n${articuloDos}\nII. CONSIDERACIONES\nLa sala estudia las pruebas aportadas y expone las razones de su decisión para este caso.`;
  const fragmentos = chunkText(texto);
  assert.ok(fragmentos.length >= 2, "La sentencia debe producir fragmentos citables.");
  assert.ok(fragmentos.every((fragmento) => !/Artículo/i.test(fragmento.heading)), "Los artículos citados no son secciones de la sentencia.");
  assert.ok(fragmentos.some((fragmento) => fragmento.heading === "Antecedentes"), "Debe reconocer los antecedentes judiciales.");
  assert.ok(fragmentos.some((fragmento) => fragmento.heading === "Consideraciones"), "Debe reconocer las consideraciones judiciales.");
  assert.ok(fragmentos.some((fragmento) => fragmento.content.includes(articuloUno)), "El artículo citado debe conservarse como contenido.");
});

test("El título y el artículo se conservan juntos en los encabezados", () => {
  const texto = `CAPÍTULO I\nDERECHOS DE LA COMUNIDAD\n${articuloUno}\n${articuloDos}`;
  const fragmentos = chunkText(texto);
  assert.ok(fragmentos.some((fragmento) => fragmento.heading.includes("Capítulo I") && fragmento.heading.includes("Artículo 1")), "Debe conservar el capítulo junto al artículo.");
  assert.ok(fragmentos.some((fragmento) => fragmento.heading.includes("Artículo 2")), "Debe continuar con el segundo artículo.");
});

for (const [nombre, texto] of [
  ["muchas oraciones", "La comunidad participa en las decisiones sobre su territorio. ".repeat(90)],
  ["un párrafo largo sin puntuación", "la comunidad necesita una respuesta ".repeat(100)],
  ["una palabra continua", "x".repeat(3600)],
  ["varios artículos extensos", `ARTÍCULO 1°. ${"Se garantiza la participación. ".repeat(60)}\nARTÍCULO 2. ${"Se respeta el territorio. ".repeat(60)}`],
]) {
  test(`Los fragmentos de ${nombre} no superan unos mil trescientos caracteres`, () => {
    const fragmentos = chunkText(texto);
    assert.ok(fragmentos.length > 1, "El texto largo debe dividirse.");
    for (const fragmento of fragmentos) assert.ok(fragmento.content.length <= 1300, `El fragmento tiene ${fragmento.content.length} caracteres; el máximo esperado es 1300.`);
    assert.equal(fragmentos.map((fragmento) => fragmento.content).join("").replace(/\s/g, ""), texto.replace(/\s/g, ""), "La fragmentación debe conservar todas las palabras del documento.");
  });
}

test("Un texto vacío o de espacios no genera fragmentos", () => {
  for (const texto of ["", " \n \t "]) assert.deepEqual(chunkText(texto), [], "No deben producirse fragmentos vacíos.");
});

test("Los marcadores de página se incorporan al encabezado sin contaminar el contenido", () => {
  const texto = "[[pág. 3]]\nLa comunidad presenta una solicitud para que las autoridades respondan acerca de sus derechos.";
  const fragmentos = chunkText(texto);
  assert.equal(fragmentos[0].heading, "pág. 3", "La página debe identificar el fragmento.");
  assert.ok(!fragmentos[0].content.includes("[["), "El marcador no debe quedar como texto del documento.");
});

test("La normalización colapsa espacios y conserva como máximo un renglón vacío", () => {
  const texto = "  Hola\t\t comunidad\u00a0  indígena  \r\n\r\n\r\n  Segunda\f\v línea  ";
  assert.equal(normalize(texto), "Hola comunidad indígena\n\nSegunda línea", "Se limpian espacios, tabulaciones y saltos repetidos sin perder los párrafos.");
});

test("La normalización une palabras cortadas al final del renglón", () => {
  assert.equal(normalize("La protec-\nción del territorio."), "La protección del territorio.", "Debe unir el corte tipográfico entre letras.");
  assert.equal(normalize("Sección-\nNueva"), "Sección-\nNueva", "Una mayúscula en la línea siguiente no se considera continuación de palabra.");
});

test("Normalizar dos veces da el mismo resultado", () => {
  const limpio = normalize("  ARTÍCULO 1°.\r\n\n\nLa   comunidad\tparticipa.  ");
  assert.equal(normalize(limpio), limpio, "La normalización debe ser idempotente.");
  assert.equal(normalize(" \t\n "), "", "El contenido compuesto solo por espacios queda vacío.");
});

test("Un párrafo corto seguido de uno largo no debe superar mil trescientos caracteres", () => {
  // ingest.ts: solo vacía el búfer al superar MAX si el contenido previo alcanza MIN.
  const texto = `${"a".repeat(150)}\n${"b".repeat(2400)}`;
  const fragmentos = chunkText(texto);
  assert.ok(fragmentos.every((fragmento) => fragmento.content.length <= 1300), `El mayor fragmento tiene ${Math.max(...fragmentos.map((fragmento) => fragmento.content.length))} caracteres.`);
});

test("Los artículos breves no deben desaparecer al fragmentar una ley", () => {
  // ingest.ts: flush descarta todo contenido menor de 40 caracteres, incluso artículos completos.
  const fragmentos = chunkText("ARTÍCULO 1°. Objeto.\nARTÍCULO 2. Vigencia.");
  assert.deepEqual(fragmentos.map((fragmento) => fragmento.heading), ["Artículo 1", "Artículo 2"], "Los dos artículos deben permanecer disponibles para su consulta.");
});

test("El final corto de un párrafo largo no debe perderse", () => {
  // ingest.ts: el último trozo de splitLong también se descarta si tiene menos de 40 caracteres.
  const texto = `${"a".repeat(1200)}El derecho sigue vigente.`;
  const recuperado = chunkText(texto).map((fragmento) => fragmento.content).join("");
  assert.equal(recuperado.length, texto.length, "Debe conservarse también la última frase, aunque sea corta.");
  assert.equal(recuperado, texto, "Los fragmentos deben conservar exactamente todo el texto.");
});
