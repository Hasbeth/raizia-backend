/**
 * Búsqueda documental sobre SQLite FTS5 y detección de temáticas.
 * No usa IA: es el motor de recuperación que alimenta al asistente y a la biblioteca.
 */
import { all } from "./db";
import { MARK_CLOSE, MARK_OPEN } from "./constants";

const STOPWORDS = new Set(
  `a al algo algun alguna algunas alguno algunos ante antes aqui asi aun aunque bien cada casi como con contra cual cuales cuando cuanto de del desde donde dos el ella ellas ellos en entre era eran es esa esas ese eso esos esta estaba estan estar estas este esto estos fue fueron ha habia hace hacer hacemos hago han hasta hay la las le les lo los mas me mi mis mucho muy nada ni no nos nosotros nuestra nuestras nuestro nuestros o otra otras otro otros para pero poco por porque puede pueden puedo que quien quienes quiero se sea segun ser si sido sin sobre solo somos son soy su sus tal tambien tanto te tengo tenemos tiene tienen toda todas todo todos tu tus un una unas uno unos usted ustedes va van y ya yo debo debe deben decir dice dicen saber cuales favor hola gracias necesito quisiera explicame explica dime significa`.split(
    /\s+/,
  ),
);

export function fold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

/** Raíz ligera en español: suficiente para emparejar plurales y derivados con prefijo. */
function stem(w: string): string {
  let s = w;
  if (s.length > 6 && s.endsWith("ciones")) s = s.slice(0, -2);
  else if (s.length > 5 && s.endsWith("es")) s = s.slice(0, -2);
  else if (s.length > 4 && s.endsWith("s")) s = s.slice(0, -1);
  if (s.length > 7) s = s.slice(0, s.length - 1);
  return s;
}

export function queryTerms(q: string): string[] {
  const words = fold(q).match(/[a-z0-9]+/g) || [];
  const out: string[] = [];
  for (const w of words) {
    if (w.length < 3 && !/^\d+$/.test(w)) continue;
    if (STOPWORDS.has(w)) continue;
    const s = stem(w);
    if (!out.includes(s)) out.push(s);
  }
  return out.slice(0, 14);
}

/**
 * Puente entre el habla cotidiana y el vocabulario de las normas.
 * Clave: raíz de la palabra que usa la persona. Valor: términos equivalentes en los documentos.
 * Es un diccionario pequeño y editable; no agrega contenido jurídico, solo ayuda a encontrarlo.
 */
const SYNONYMS: Record<string, string[]> = {
  solicitu: ["peticion"],
  solicit: ["peticion"],
  pedir: ["peticion"],
  carta: ["peticion"],
  respond: ["resolver", "respuesta", "termino"],
  respuest: ["resolver", "termino"],
  contest: ["resolver", "respuesta"],
  demora: ["termino", "plazo", "resolver"],
  plazo: ["termino", "dias"],
  entidad: ["autoridad", "autoridades"],
  alcaldi: ["autoridad", "municipio"],
  funcionari: ["autoridad", "servidor"],
  tierra: ["territorio", "resguardo"],
  terreno: ["territorio", "resguardo"],
  territori: ["resguardo", "tierras"],
  consult: ["consulta", "previa"],
  permiso: ["licencia", "consulta"],
  empresa: ["proyecto", "explotacion", "licencia"],
  mina: ["mineria", "explotacion", "recursos"],
  mineri: ["explotacion", "recursos"],
  contamin: ["ambiente", "deterioro", "dano"],
  rio: ["agua", "cuenca", "recursos"],
  tala: ["forestal", "bosque", "aprovechamiento"],
  bosqu: ["forestal", "recursos"],
  justici: ["jurisdiccion", "autoridades"],
  castigo: ["sancion", "jurisdiccion"],
  jefe: ["autoridad", "cabildo", "gobernador"],
  lider: ["autoridad", "cabildo"],
  idioma: ["lengua", "lenguas"],
  lengua: ["lenguas", "nativas"],
  escuela: ["educacion", "educativa", "etnoeducacion"],
  colegio: ["educacion", "educativa"],
  profesor: ["docente", "etnoeducador", "educacion"],
  hospital: ["salud", "atencion"],
  medico: ["salud", "atencion"],
  eps: ["salud", "afiliacion"],
  enferm: ["salud", "atencion"],
  tutela: ["tutela", "amparo", "proteccion"],
  demanda: ["accion", "tutela"],
  denunci: ["accion", "queja"],
  discrimin: ["igualdad", "discriminacion"],
  cultura: ["cultural", "identidad", "diversidad"],
  costumbr: ["usos", "costumbres", "tradicion"],
  sagrado: ["sagrados", "espiritual", "ancestral"],
  desaloj: ["desalojo", "territorio", "posesion"],
  // Vocabulario cotidiano para los códigos generales (trabajo, familia, bienes, penal).
  despid: ["despido", "terminacion", "contrato", "indemnizacion"],
  echaron: ["despido", "terminacion", "contrato"],
  trabaj: ["trabajador", "empleador", "contrato", "laboral"],
  patron: ["empleador", "trabajador"],
  sueldo: ["salario", "remuneracion"],
  pagar: ["salario", "pago"],
  pagarme: ["salario", "pago", "prestaciones"],
  liquidaci: ["prestaciones", "cesantias", "salario"],
  herenci: ["sucesion", "herederos", "testamento"],
  murio: ["sucesion", "herederos", "defuncion"],
  separ: ["divorcio", "separacion", "conyuges"],
  divorci: ["divorcio", "conyuges", "matrimonio"],
  alimento: ["alimentos", "cuota", "obligacion"],
  hijo: ["menor", "nino", "alimentos", "custodia"],
  deuda: ["obligacion", "pago", "acreedor", "deudor"],
  robo: ["hurto", "delito", "penal"],
  robaron: ["hurto", "delito", "denuncia"],
  golpe: ["lesiones", "violencia", "delito"],
  policia: ["convivencia", "comportamientos", "medidas"],
  preso: ["captura", "privacion", "libertad", "penal"],
  carcel: ["privacion", "libertad", "pena"],
  casa: ["vivienda", "inmueble", "propiedad"],
  vecino: ["convivencia", "servidumbre", "propiedad"],
};

function expand(terms: string[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const t of terms) {
    const extra = new Set<string>();
    for (const [key, values] of Object.entries(SYNONYMS)) {
      if (t === key || (t.length >= 4 && key.length >= 4 && (t.startsWith(key) || key.startsWith(t)))) {
        values.forEach((v) => v !== t && extra.add(v));
      }
    }
    out.set(t, [...extra]);
  }
  return out;
}

function ftsQuery(terms: string[], op: "OR" | "AND"): string {
  return terms.map((t) => (/^\d+$/.test(t) ? `"${t}"` : `${t}*`)).join(` ${op} `);
}

export type Topic = { id: number; name: string; score: number };

/** Identifica las temáticas de una consulta a partir de las palabras clave de cada categoría. */
export function detectTopics(text: string, max = 3): Topic[] {
  const hay = ` ${fold(text).replace(/[^a-z0-9]+/g, " ")} `;
  const cats = all<{ id: number; parent_id: number | null; name: string; keywords: string }>(
    "SELECT id, parent_id, name, keywords FROM categories",
  );
  const scores = new Map<number, Topic>();
  for (const c of cats) {
    let score = 0;
    for (const kw of c.keywords.split(",")) {
      const k = fold(kw).replace(/[^a-z0-9]+/g, " ").trim();
      if (!k) continue;
      if (hay.includes(` ${k} `)) score += k.includes(" ") ? 2 : 1;
    }
    if (!score) continue;
    // Las coincidencias en subcategorías también cuentan para la categoría principal.
    const rootId = c.parent_id ?? c.id;
    const root = cats.find((x) => x.id === rootId)!;
    const prev = scores.get(rootId);
    scores.set(rootId, { id: rootId, name: root.name, score: (prev?.score || 0) + score });
  }
  return [...scores.values()].sort((a, b) => b.score - a.score).slice(0, max);
}

export type Hit = {
  chunkId: number;
  documentId: number;
  ord: number;
  heading: string;
  content: string;
  title: string;
  entity: string;
  docType: string;
  docDate: string;
  officialUrl: string;
  score: number;
  coverage: number;
};

type HitRow = {
  chunk_id: number;
  document_id: number;
  ord: number;
  heading: string;
  content: string;
  title: string;
  entity: string;
  doc_type: string;
  doc_date: string;
  official_url: string;
  weight: number | null;
  rank: number;
};

/**
 * Recupera los fragmentos más pertinentes entre los documentos aprobados.
 * Las temáticas detectadas dan prioridad, pero no excluyen: un documento
 * transversal (p. ej. la Constitución) sigue pudiendo aparecer.
 */
export function searchChunks(
  query: string,
  opts: { topicIds?: number[]; limit?: number; boostText?: string } = {},
): Hit[] {
  const terms = queryTerms(query);
  if (!terms.length) return [];
  const limit = opts.limit ?? 6;
  const synonyms = expand(terms);

  let rows: HitRow[];
  try {
    const match = ftsQuery([...new Set([...terms, ...[...synonyms.values()].flat()])], "OR");
    // Rendimiento: el orden por pertinencia se calcula DENTRO del índice y solo los mejores
    // candidatos se cruzan con las tablas. Cruzar antes de limitar tardaba minutos con
    // cientos de miles de fragmentos.
    const pool = all<HitRow>(
      `SELECT c.id AS chunk_id, c.document_id, c.ord, c.heading, c.content,
              d.title, d.entity, d.doc_type, d.doc_date, d.official_url, d.weight, hit.rank
         FROM (SELECT rowid AS id, bm25(chunks_fts, 1.0, 2.5, 4.0) AS rank
                 FROM chunks_fts WHERE chunks_fts MATCH ? ORDER BY rank LIMIT 3000) hit
         JOIN chunks c ON c.id = hit.id
         JOIN documents d ON d.id = c.document_id
        WHERE d.status = 'aprobado'
        ORDER BY hit.rank`,
      match,
    );
    // Además de los mejores en general, se reservan lugares a la colección principal
    // (normas y documentos de peso normal), para que cientos de sentencias importadas
    // en bloque no la dejen fuera de los candidatos.
    const seen = new Set<number>();
    rows = [...pool.slice(0, 120), ...pool.filter((r) => (r.weight ?? 1) >= 1).slice(0, 60)].filter(
      (r) => !seen.has(r.chunk_id) && seen.add(r.chunk_id),
    );
  } catch {
    return [];
  }
  if (!rows.length) return [];
  const weightOf = new Map(rows.map((r) => [r.chunk_id, r.weight ?? 1]));

  const topicDocs = new Set<number>();
  if (opts.topicIds?.length) {
    const marks = opts.topicIds.map(() => "?").join(",");
    const ids = all<{ document_id: number }>(
      `SELECT DISTINCT dc.document_id FROM document_categories dc
         JOIN categories c ON c.id = dc.category_id
        WHERE c.id IN (${marks}) OR c.parent_id IN (${marks})`,
      ...opts.topicIds,
      ...opts.topicIds,
    );
    ids.forEach((r) => topicDocs.add(r.document_id));
  }

  const generic = ["pueblo", "comunidad", "resguardo", "municipio", "indigena"];
  const boostTerms = (fold(opts.boostText || "").match(/[a-z0-9]{4,}/g) || []).filter(
    (w) => !STOPWORDS.has(w) && !generic.includes(w),
  );

  const scored: Hit[] = rows.map((r) => {
    const hay = fold(`${r.title} ${r.heading} ${r.content}`);
    // Una palabra cuenta si aparece ella o alguno de sus equivalentes jurídicos.
    const matched = terms.filter(
      (t) => hay.includes(t) || (synonyms.get(t) || []).some((x) => hay.includes(x)),
    ).length;
    const coverage = matched / terms.length;
    let score = -r.rank * (0.4 + coverage * coverage);
    if (topicDocs.has(r.document_id)) score *= 1.6;
    if (boostTerms.some((w) => hay.includes(w))) score *= 1.25;
    if (r.heading.startsWith("Artículo") || r.heading.includes("· Artículo")) score *= 1.1;
    score *= r.weight ?? 1;
    return {
      chunkId: r.chunk_id,
      documentId: r.document_id,
      ord: r.ord,
      heading: r.heading,
      content: r.content,
      title: r.title,
      entity: r.entity,
      docType: r.doc_type,
      docDate: r.doc_date,
      officialUrl: r.official_url,
      score,
      coverage,
    };
  });

  // Umbral de pertinencia: evita responder con fragmentos que solo comparten una palabra suelta.
  const minMatched = terms.length >= 5 ? 3 : terms.length >= 3 ? 2 : 1;
  const relevant = scored.filter((h) => Math.round(h.coverage * terms.length) >= minMatched);
  relevant.sort((a, b) => b.score - a.score);

  // Las sentencias importadas en bloque (peso < 1) ocupan como máximo la mitad de los lugares
  // mientras haya fragmentos pertinentes de la colección principal; si no los hay, completan.
  const isBulk = (h: Hit) => (weightOf.get(h.chunkId) ?? 1) < 1;
  const perDoc = new Map<number, number>();
  const out: Hit[] = [];
  const bulkCap = Math.ceil(limit / 2);
  const pick = (allowBulkOverflow: boolean) => {
    for (const h of relevant) {
      if (out.length >= limit) break;
      if (out.includes(h)) continue;
      const n = perDoc.get(h.documentId) || 0;
      if (n >= 3) continue;
      if (!allowBulkOverflow && isBulk(h) && out.filter(isBulk).length >= bulkCap) continue;
      perDoc.set(h.documentId, n + 1);
      out.push(h);
    }
  };
  pick(false);
  pick(true);
  out.sort((a, b) => b.score - a.score);
  return out;
}

/** Coincidencias por contenido para la biblioteca: un fragmento resaltado por documento. */
export function searchDocumentsByContent(
  query: string,
  publicOnly: boolean,
): Map<number, { snippet: string; rank: number }> {
  const out = new Map<number, { snippet: string; rank: number }>();
  const terms = queryTerms(query);
  if (!terms.length) return out;
  try {
    const rows = all<{ document_id: number; snip: string; rank: number }>(
      // Se limita dentro del índice antes de cruzar tablas (ver searchChunks).
      `SELECT c.document_id, hit.snip, hit.rank
         FROM (SELECT rowid AS id,
                      snippet(chunks_fts, 0, '${MARK_OPEN}', '${MARK_CLOSE}', '…', 30) AS snip,
                      bm25(chunks_fts, 1.0, 2.5, 4.0) AS rank
                 FROM chunks_fts WHERE chunks_fts MATCH ? ORDER BY rank LIMIT 600) hit
         JOIN chunks c ON c.id = hit.id
         JOIN documents d ON d.id = c.document_id
        ${publicOnly ? "WHERE d.status = 'aprobado'" : ""}
        ORDER BY hit.rank`,
      `{content heading} : (${ftsQuery(terms, "AND")})`,
    );
    for (const r of rows) {
      if (!out.has(r.document_id)) out.set(r.document_id, { snippet: r.snip, rank: r.rank });
    }
  } catch {
    /* consulta inválida: sin coincidencias */
  }
  return out;
}

/** Recorta un fragmento alrededor de los términos de la consulta y los resalta. */
export function excerpt(content: string, query: string, max = 320): string {
  const terms = queryTerms(query);
  const folded = fold(content);
  let pos = -1;
  for (const t of terms) {
    const i = folded.indexOf(t);
    if (i >= 0 && (pos < 0 || i < pos)) pos = i;
  }
  let start = Math.max(0, (pos < 0 ? 0 : pos) - 80);
  if (start > 0) {
    const sp = content.indexOf(" ", start);
    if (sp > 0 && sp - start < 30) start = sp + 1;
  }
  let text = content.slice(start, start + max);
  if (start > 0) text = "…" + text;
  if (start + max < content.length) text = text.replace(/\s+\S*$/, "") + "…";
  return text.replace(/\s*\n\s*/g, " ");
}
