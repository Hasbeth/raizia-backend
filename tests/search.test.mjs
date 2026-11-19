import assert from "node:assert/strict";
import { after, test } from "node:test";
import { excerpt, fold, queryTerms } from "../src/lib/search.ts";
import { all as consultaInterceptada } from "../src/lib/db.ts";
import { accesos, all as consultaSimulada } from "./support/db-stub.mjs";

after(() => {
  assert.equal(accesos, 0, "Los auxiliares de búsqueda no deben consultar la base de datos.");
});

test("La búsqueda usa el módulo simulado sin abrir SQLite", () => {
  assert.equal(consultaInterceptada, consultaSimulada, "La resolución debe interceptar db.ts antes de evaluarlo.");
  assert.equal(accesos, 0, "Importar búsqueda no debe consultar datos.");
});

test("La normalización elimina tildes y convierte las mayúsculas", () => {
  assert.equal(fold("ÁRBOL, NIÑOS, Ü y PETICIÓN 21!"), "arbol, ninos, u y peticion 21!", "Se conservan signos, números y espacios, eliminando las marcas diacríticas.");
  assert.equal(fold("PETICIÓN".normalize("NFD")), "peticion", "También se aceptan tildes representadas como caracteres combinados.");
  assert.equal(fold(""), "", "El texto vacío permanece vacío.");
});

test("La consulta elimina saludos, palabras vacías y puntuación", () => {
  assert.deepEqual(queryTerms("hola gracias quiero saber si la EPS y el agua"), ["eps", "agua"], "Solo deben quedar los términos relevantes en orden.");
  assert.deepEqual(queryTerms("¿AGUA? ¡agua!, EPS; eps"), ["agua", "eps"], "Los términos se normalizan y no se duplican.");
});

test("Los plurales habituales comparten raíz con sus singulares", () => {
  assert.deepEqual(queryTerms("tierras tierra casas casa comunidades comunidad peticiones petición"), ["tierra", "casa", "comunida", "peticio"], "La raíz ligera debe unir estos plurales y singulares.");
});

test("La consulta conserva números cortos pero descarta palabras de menos de tres letras", () => {
  assert.deepEqual(queryTerms("a xy z 1 21 1991 ley"), ["1", "21", "1991", "ley"], "Los números de artículo y ley deben conservarse.");
});

test("La consulta conserva como máximo catorce términos distintos en orden", () => {
  const palabras = ["agua", "salud", "tierra", "bosque", "rio", "casa", "cabildo", "norma", "juez", "tutela", "mina", "escuela", "cultura", "lengua", "campo", "puente"];
  assert.deepEqual(queryTerms(palabras.join(" ")), palabras.slice(0, 14), "El límite se aplica a los primeros catorce términos únicos.");
  assert.deepEqual(queryTerms(`agua agua ${palabras.join(" ")}`), palabras.slice(0, 14), "Los duplicados no deben consumir el límite.");
});

test("Las consultas vacías, de signos o de palabras vacías no producen términos", () => {
  for (const consulta of ["", " \t\n ", "¿?!...", "hola gracias quiero saber por favor"]) {
    assert.deepEqual(queryTerms(consulta), [], "No deben inventarse términos cuando no hay contenido relevante.");
  }
});

test("Un fragmento corto conserva su contenido y sus tildes", () => {
  const texto = "La petición protege a la comunidad indígena.";
  assert.equal(excerpt(texto, "peticion"), texto, "Un fragmento corto debe conservarse sin puntos suspensivos añadidos.");
  assert.equal(excerpt("", "agua"), "", "No debe inventarse texto para una fuente vacía.");
});

test("El extracto colapsa saltos de línea sin unir las palabras", () => {
  assert.equal(excerpt("Primera línea.\n\n La comunidad pide agua.", "agua"), "Primera línea. La comunidad pide agua.", "Los párrafos deben quedar separados por un espacio.");
});

test("El extracto rodea la coincidencia sin importar las tildes o las mayúsculas", () => {
  const texto = `${"antecedente ".repeat(40)}TERRITORIO indígena reconocido. ${"El cabildo participa. ".repeat(40)}`;
  const recorte = excerpt(texto, "território", 160);
  assert.ok(recorte.includes("TERRITORIO"), "El término encontrado debe permanecer visible.");
  assert.ok(recorte.startsWith("…") && recorte.endsWith("…"), "Deben indicarse ambos extremos recortados.");
  assert.ok(recorte.length <= 162, "El máximo solo puede excederse por los dos puntos suspensivos.");
});

test("Sin coincidencias el extracto comienza al inicio del documento", () => {
  const texto = `Inicio del documento. ${"Contenido de contexto. ".repeat(30)}`;
  for (const consulta of ["", "ningunacoincidencia"]) {
    const recorte = excerpt(texto, consulta, 100);
    assert.ok(recorte.startsWith("Inicio del documento."), "Sin coincidencias se muestra el inicio.");
    assert.ok(recorte.endsWith("…") && recorte.length <= 101, "Debe respetar el límite e indicar el recorte final.");
  }
});

test("El extracto elige la primera coincidencia del documento y no el primer término consultado", () => {
  const texto = `El agua es necesaria. ${"Texto intermedio. ".repeat(40)}La tierra es colectiva.`;
  assert.ok(excerpt(texto, "tierra agua", 100).startsWith("El agua es necesaria."), "Debe preferir la coincidencia que aparece antes en el documento.");
});

test("El tamaño predeterminado limita el extracto a unos trescientos veinte caracteres", () => {
  const recorte = excerpt("La comunidad participa en las decisiones. ".repeat(30), "comunidad");
  assert.ok(recorte.length <= 321 && recorte.endsWith("…"), "Se respeta el tamaño predeterminado y el indicador final.");
});
