import test from "node:test";
import assert from "node:assert/strict";
import { classifyHeading, fragmentDocument, selectChunks, contentHash, postgresEstimate } from "../scripts/lib/biblioteca-core.mjs";

const paragraph = "La comunidad perdió el acceso a su territorio ancestral y solicitó protección para conservar sus prácticas culturales y la participación en las decisiones que afectan a sus integrantes.";
for (const [heading, section] of [
  ["I. ANTECEDENTES", "hechos_antecedentes"], ["2. Hechos y pretensiones", "hechos_antecedentes"],
  ["Hechos probados", "hechos_antecedentes"], ["ANTECEDENTES[1]", "hechos_antecedentes"],
  ["III. CONSIDERACIONES Y FUNDAMENTOS", "fundamentos"], ["Caso concreto", "fundamentos"],
  ["Problema jurídico y metodología de la decisión", "problema_juridico"],
  ["SÍNTESIS DE LA DECISIÓN", "sintesis"], ["RESUELVE", "decision"],
  ["Salvamento parcial y aclaración de voto", "votos"], ["ACLARACION DE VOTO DEL MAGISTRADO", "votos"],
  ["IV. Intervenciones ciudadanas", "intervenciones"], ["Intervención de la Defensoría del Pueblo", "intervenciones"],
  ["CONCEPTO DEL PROCURADOR GENERAL DE LA NACIÓN", "conceptos"], ["Ministerio Público", "conceptos"],
  ["PRUEBAS QUE OBRAN EN EL EXPEDIENTE", "pruebas_tramite"], ["Actuaciones adelantadas en sede de revisión", "pruebas_tramite"],
  ["Trámite procesal", "pruebas_tramite"], ["TABLA DE CONTENIDO", "indice"], ["Nota de Relatoría", "relatoria"],
]) test(`Regla observada: ${heading}`, () => assert.equal(classifyHeading(heading), section));

for (const prose of [
  "La Sala considera el concepto del Procurador y las intervenciones ciudadanas.",
  "Concepto genérico de nocividad social.",
  "Aclaración de la resolución 176 emitida por el alcalde",
  "Contenido",
  "Concepto",
  "Las pruebas permiten establecer los hechos relevantes de la comunidad.",
  "Hechos investigados. Este deber se justifica por el carácter dispositivo del proceso.",
  "Intervención útil y con voceros suficientemente representativos, en función del caso",
]) test(`No excluir prosa por palabras: ${prose.slice(0, 45)}`, () => assert.equal(classifyHeading(prose), null));

test("Se conservan hechos, problema, fundamentos y decisión; el visor mantiene todas las secciones", () => {
  const text = ["Sentencia T-123/20", "ANTECEDENTES", paragraph, "INTERVENCIONES", paragraph + " Una entidad intervino.",
    "PROBLEMA JURÍDICO", paragraph + " Problema.", "PRUEBAS", paragraph + " Prueba.",
    "CONSIDERACIONES", paragraph + " Razón.", "RESUELVE", paragraph + " Orden.",
    "SALVAMENTO DE VOTO", paragraph + " Disenso.", "CONSIDERACIONES", paragraph + " Razón del disenso."].join("\n");
  const chunks = selectChunks(fragmentDocument(text, true), 1, true);
  for (const section of ["hechos_antecedentes", "problema_juridico", "fundamentos", "decision"]) assert.ok(chunks.some((c) => c.section === section && c.indexed));
  for (const section of ["intervenciones", "pruebas_tramite", "votos"]) assert.ok(chunks.some((c) => c.section === section && !c.indexed));
  assert.equal(chunks.at(-1).section, "votos", "Los subtítulos del voto no reabren la sentencia");
  assert.equal(chunks.map((c) => c.content).join("").replace(/\s/g, ""), text.replace(/\s/g, ""));
});

test("Concepto del Procurador partido en renglones se reconoce", () => {
  const chunks = fragmentDocument(`CONCEPTO DEL\nPROCURADOR GENERAL DE LA NACIÓN\n${paragraph}\nCONSIDERACIONES\n${paragraph}`, true);
  assert.equal(chunks[0].section, "conceptos");
  assert.equal(chunks.at(-1).section, "fundamentos");
});

test("Aclaración previa partida no excluye los hechos ni el razonamiento", () => {
  const chunks = selectChunks(fragmentDocument(`Aclaración\nprevia\n${paragraph}\nANTECEDENTES\n${paragraph} Hechos.\nCONSIDERACIONES\n${paragraph} Razón.`, true), 1, true);
  assert.ok(chunks.every((c) => c.section !== "votos"));
  assert.ok(chunks.some((c) => c.section === "hechos_antecedentes" && c.indexed));
  assert.ok(chunks.some((c) => c.section === "fundamentos" && c.indexed));
});

test("Aclaración de voto partida sí excluye el anexo y sus subtítulos", () => {
  const chunks = fragmentDocument(`RESUELVE\n${paragraph}\nACLARACIÓN\nDE VOTO DEL MAGISTRADO\n${paragraph}\nCONSIDERACIONES\n${paragraph}`, true);
  assert.equal(chunks.at(-1).section, "votos");
});

test("Una entrada de índice paginada no inicia un voto irreversible", () => {
  const chunks = fragmentDocument(`TABLA DE CONTENIDO\nSALVAMENTO DE VOTO ........ 25\nANTECEDENTES 3\nANTECEDENTES\n${paragraph}\nRESUELVE\n${paragraph}`, true);
  assert.ok(chunks.every((c) => c.section !== "votos"));
  assert.equal(chunks.at(-1).section, "decision");
});

test("Intervención de una entidad con comas en su nombre se excluye", () => {
  assert.equal(classifyHeading("Intervención del Ministerio de Ambiente, Vivienda y Desarrollo Territorial."), "intervenciones");
});

test("La colección principal incluye votos, intervenciones y pruebas", () => {
  const chunks = selectChunks(fragmentDocument(`SALVAMENTO DE VOTO\n${paragraph}\nINTERVENCIONES\n${paragraph} Continúa.`, false), 5, false);
  assert.ok(chunks.some((c) => c.indexed && c.content.includes("SALVAMENTO")));
  assert.ok(chunks.every((c) => c.section === "coleccion_principal"));
});

test("Dedupe local/global por texto normalizado, con prioridad al primero indexable", () => {
  const seen = new Map();
  const raw = { content: paragraph, heading: "", section: "fundamentos", ord: 0 };
  const excluded = selectChunks([{ ...raw, section: "votos" }], 1, true, seen)[0];
  const principal = selectChunks([raw, { ...raw, content: paragraph.toUpperCase().replaceAll(" ", "  ") }], 2, false, seen);
  const bulk = selectChunks([raw], 3, true, seen)[0];
  assert.equal(excluded.reason, "votos");
  assert.equal(principal[0].indexed, 1);
  assert.equal(principal[1].reason, "duplicado_documento");
  assert.equal(bulk.reason, "duplicado_global");
  assert.notEqual(contentHash("no debe aprobar"), contentHash("debe aprobar"));
  assert.notEqual(contentHash("artículo 21"), contentHash("artículo 22"));
});

test("Limpieza descarta encabezados y fragmentos con menos de 80 letras/dígitos", () => {
  const selected = selectChunks([
    { content: "CONSIDERACIONES Y FUNDAMENTOS", heading: "", section: "fundamentos" },
    { content: "a".repeat(79) + " . ".repeat(100), heading: "", section: "fundamentos" },
    { content: "a".repeat(80), heading: "", section: "fundamentos" },
  ], 1, false);
  assert.deepEqual(selected.map((c) => c.reason), ["solo_encabezado", "menos_80_utiles", null]);
});

test("La estimación cuenta vectores halfvec y el ahorro exacto de 256 dimensiones", () => {
  const data = { count: 1000, textBytes: 1e6, metadataBytes: 10_000, catalogBytes: 2000, catalogRows: 10 };
  const big = postgresEstimate(data, 384);
  const small = postgresEstimate(data, 256);
  assert.equal(big.vectors - small.vectors, 1000 * 2 * 128);
  assert.equal(big.ginLow, 400_000);
  assert.equal(big.ginHigh, 600_000);
  assert.ok(big.high > big.low && big.low > small.low);
  assert.equal(big.percentHigh, big.high / 500e6 * 100);
});
