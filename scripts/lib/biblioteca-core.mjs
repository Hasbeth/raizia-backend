import { createHash } from "node:crypto";
import { chunkText, normalize } from "../../src/lib/ingest.ts";

export const RULES_VERSION = 1;
export const EXCLUDED_SECTIONS = new Set(["votos", "intervenciones", "conceptos", "pruebas_tramite", "indice", "relatoria"]);
const fold = (s) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const prefix = /^(?:(?:[ivxlcdm]+|\d+(?:\.\d+)*|[a-z])[.)\-:]?\s+|[§•]\s*)/i;

export function headingKey(line) {
  return fold(line).replace(prefix, "").replace(/\[\d+\]/g, "").replace(/[.:\s]+$/g, "").trim();
}

// Se reconocen encabezados, nunca una palabra encontrada en medio de un párrafo.
// Los prefijos salen de frecuencias-encabezados.json, no del tema del documento.
export function classifyHeading(line) {
  const raw = line.trim();
  if (!raw || raw.length > 180 || /\.{3,}\s*\d+$/.test(raw) || /\s\d+$/.test(raw)) return null;
  const s = headingKey(raw);
  const upper = raw === raw.toUpperCase();
  const numbered = prefix.test(raw);
  if (!upper && !numbered && !/^[A-ZÁÉÍÓÚÑ]/u.test(raw)) return null;
  // Frases narrativas y proposiciones temáticas no son encabezados estructurales.
  if (/[;!?“”"]/.test(s) || /\b(?:considera|solicita|sostiene|explica|senala|manifiesta|permite|debe|puede|tiene|fueron|son|estan|que el|que la|que se)\b/.test(s)) return null;
  if (/^(?:salvamento(?:s)?(?: parcial)?(?: y aclaracion)?(?: de(?: voto)?)?|aclaracion(?:es)?(?: de(?: voto)?)?)(?:\s|$)/.test(s) &&
      (/voto/.test(s) || /^(?:salvamento(?: parcial)?|aclaracion)(?: de)?$/.test(s))) return "votos";
  if (/^(?:tabla de contenidos?|indice(?: general)?)$/.test(s)) return "indice";
  if (/^(?:nota(?:s)? de relatoria|nota del relator)(?:\b|$)/.test(s)) return "relatoria";
  if (/^intervencion(?:es)?(?:$| (?:ciudadanas|extemporaneas|oficiales|de|del|ante|en este proceso|y conceptos)\b)/.test(s)) return "intervenciones";
  if (/^concepto(?:s)? (?:del?|rendido por) (?:la |el )?(?:procurador|procuraduria|ministerio publico|entidades|expertos|invitados)\b/.test(s) ||
      /^(?:ministerio publico|procuraduria general de la nacion)$/.test(s)) return "conceptos";
  if (/^(?:pruebas(?:$| (?:decretadas|aportadas|recaudadas|recopiladas|solicitadas|documentales|relevantes|que obran|recibidas|allegadas)\b)|tramite(?:$| (?:procesal|de la accion|de tutela|de los expedientes|en|ante)\b)|actuacion(?:es)?(?:$| (?:procesal|procesales|en sede|de la corte|ante la corte|adelantadas|surtidas|realizadas)\b))/.test(s)) return "pruebas_tramite";
  if (/^(?:hechos(?:$| (?:relevantes|probados|y|del caso|que iniciaron)\b)|antecedentes(?:$| (?:del|de la|facticos|y|jurisprudenciales)\b))/.test(s)) return "hechos_antecedentes";
  if (/^(?:problema(?:s)? juridico(?:s)?|planteamiento del problema juridico)(?:$|\s)/.test(s)) return "problema_juridico";
  if (/^(?:consideraciones|fundamentos|competencia|caso concreto|analisis del caso concreto)(?:$|\s)/.test(s)) return "fundamentos";
  if (/^(?:sintesis|resumen)(?:$| (?:del caso|de la decision|de)\b)/.test(s)) return "sintesis";
  if (/^(?:resuelve|resolucion|decision|decide)(?:$|\s)/.test(s)) return "decision";
  return null;
}

export function normalizedContent(text) {
  // Conserva acentos, números y puntuación: no confundir normas o negaciones.
  return normalize(text).normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

export function contentHash(text) {
  return createHash("sha256").update(normalizedContent(text)).digest("hex");
}

export function headingOnly(chunk) {
  const lines = chunk.content.split(/\n+/).filter((line) => line.trim());
  return lines.length > 0 && lines.every((line) => classifyHeading(line) ||
    normalizedContent(line) === normalizedContent(chunk.heading) ||
    /^(?:[IVXLCDM]+[.)]?|\d+[.)]?|[A-Z][.)])$/.test(line.trim()));
}

// No se reconstruye un extractor: cada bloque se delega a chunkText existente.
// El visor recibe incluso los bloques excluidos y los fragmentos muy cortos.
export function fragmentDocument(text, bulk) {
  if (!bulk) return chunkText(text).map((c, ord) => ({ ...c, ord, section: "coleccion_principal" }));
  const lines = normalize(text).split("\n");
  const blocks = [];
  let state = "contexto";
  let heading = "";
  let buffer = [];
  let dissent = false;
  const flush = () => {
    if (buffer.some((s) => s.trim())) blocks.push({ text: buffer.join("\n"), section: state, heading });
    buffer = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let section = classifyHeading(line);
    // Encabezados partidos: "CONCEPTO DEL" / "PROCURADOR GENERAL...".
    if (!section && line.length < 100 && /^(?:concepto|problema|tabla|nota|salvamento|aclaracion)/.test(headingKey(line))) {
      section = classifyHeading(`${line.trim()} ${(lines[i + 1] ?? "").trim()}`);
    }
    if (section === "votos" && !/voto/i.test(line)) {
      // "Aclaración / previa" es frecuente al anonimizar una providencia.
      // Solo un encabezado de voto truncado puede activar el estado irreversible.
      const continuation = lines.slice(i, i + 7).filter((s) => s.trim()).slice(0, 4).join(" ");
      if (!/^(?:salvamento|aclaracion)\s+(?:(?:parcial|de|y|aclaracion)\s+)*voto\b/.test(headingKey(continuation))) section = null;
    }
    if (state === "indice" && /^\s*\d+\s*$/.test(lines[i + 1] ?? "")) section = null;
    if (section) {
      flush();
      if (section === "votos") dissent = true;
      state = dissent ? "votos" : section;
      heading = line.trim();
    } else if (state === "relatoria" && !line.trim() && buffer.filter((s) => s.trim()).length > 1 && !dissent) {
      // Nota editorial local: termina con el párrafo, no oculta toda la sentencia.
      flush();
      state = "contexto";
      heading = "";
    }
    buffer.push(line);
  }
  flush();
  return blocks.flatMap((block) => chunkText(block.text, { judicial: true }).map((chunk) => ({
    ...chunk, heading: block.heading || chunk.heading, section: block.section,
  }))).map((chunk, ord) => ({ ...chunk, ord }));
}

// El llamador recorre principal primero y masivas por peso descendente. Un
// duplicado excluido NO reserva el hash y por tanto no tapa una copia útil.
export function selectChunks(chunks, documentId, bulk, seen = new Map()) {
  return chunks.map((chunk) => {
    const hash = contentHash(chunk.content);
    let reason = null;
    if (bulk && EXCLUDED_SECTIONS.has(chunk.section)) reason = chunk.section;
    else if (headingOnly(chunk)) reason = "solo_encabezado";
    else if ((chunk.content.match(/[\p{L}\p{N}]/gu) ?? []).length < 80) reason = "menos_80_utiles";
    else if (seen.has(hash)) reason = seen.get(hash) === documentId ? "duplicado_documento" : "duplicado_global";
    if (!reason) seen.set(hash, documentId);
    return { ...chunk, content_hash: hash, indexed: reason ? 0 : 1, reason };
  });
}

export function postgresEstimate({ count, textBytes, metadataBytes, catalogBytes, catalogRows }, dims) {
  // 96 B: cabecera/alineación, line pointer, IDs/ord/indexed y varlena.
  // 96 B adicionales: PK, FK/orden y hash B-tree; reserva de páginas 10%.
  const heap = textBytes + metadataBytes + count * 96;
  const btree = count * 96;
  const catalogs = catalogBytes + catalogRows * 160;
  // Tabla embeddings separada: halfvec(2*d + 8), fila, modelo/fecha, PK.
  const vectors = count * (2 * dims + 128);
  // tsvector almacenado: reserva conservadora separada de su índice GIN.
  const tsvector = textBytes * 0.6;
  const ginLow = textBytes * 0.4;
  const ginHigh = textBytes * 0.6;
  const low = (heap + btree + catalogs + vectors + ginLow) * 1.1;
  const high = (heap + btree + catalogs + vectors + ginHigh) * 1.1;
  return { dims, heap, btree, catalogs, vectors, tsvector, ginLow, ginHigh, low, high,
    withStoredTsvectorLow: low + tsvector * 1.1, withStoredTsvectorHigh: high + tsvector * 1.1,
    percentLow: low / 5e6, percentHigh: high / 5e6 };
}
