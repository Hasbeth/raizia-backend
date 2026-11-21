/**
 * Búsqueda híbrida sobre Postgres/pgvector y detección de temáticas.
 * Fusión RRF con degradación léxica si el proveedor de embeddings no está disponible.
 */
import { all, tx } from "./db";
import { embedQuery, embeddingModel, toPgvector } from "./embeddings";
import { hydrateChunks } from "./storage";
import { MARK_CLOSE, MARK_OPEN } from "./constants";
import { createTimings, type Timings } from "./timings";

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
  return terms.map(t => /^\d+$/.test(t) ? t : t + ":*").join(op === "OR" ? " | " : " & ");
}

export type Topic = { id: number; name: string; score: number };

/** Identifica las temáticas de una consulta a partir de las palabras clave de cada categoría. */
export async function detectTopics(text: string, max = 3): Promise<Topic[]> {
  const hay = ` ${fold(text).replace(/[^a-z0-9]+/g, " ")} `;
  const cats = await all<{ id: number; parent_id: number | null; name: string; keywords: string }>(
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
  weight?: number;
  documentMatch?: number;
  queryIndexes?: number[];
};

type HitRow = {
  chunk_id: number; document_id: number; ord: number; heading: string; content: string | null;
  title: string; summary: string; entity: string; doc_type: string; doc_date: string; official_url: string;
  weight: number; rank: number;
};
const COLUMNS = "c.id AS chunk_id,c.document_id,c.ord,c.heading,c.content,d.title,d.summary,d.entity,d.doc_type,d.doc_date,d.official_url,d.weight";

type Reference = { kind: string; number: number; year: number | null };
export function legalReferences(text: string): Reference[] {
  const refs: Reference[] = [];
  const re = /\b(ley(?:\s+estatutaria)?|decreto(?:[\s-]+ley)?|resolucion|convenio|su|t|c|auto)\s*[-–]?\s*(\d{1,5})(?:(?:\s*\/\s*|\s+de\s+)(\d{2,4}))?\b/g;
  for (const match of fold(text).matchAll(re)) {
    const year = match[3] ? Number(match[3]) : null;
    refs.push({ kind: match[1].startsWith("decreto") ? "decreto" : match[1].startsWith("ley") ? "ley" : match[1],
      number: Number(match[2]), year: year !== null && year < 100 ? (year >= 91 ? 1900 : 2000) + year : year });
  }
  return refs;
}

const TITLE_GENERIC = new Set(["ley", "decreto", "sentenci", "articul", "colombi", "indigen", "comunida", "pueblo"]);
export function documentMatch(query: string, title: string): number {
  const refs = legalReferences(query);
  // Solo la identidad inicial; «Decreto 306 — reglamenta Decreto 2591» no ES el 2591.
  const identity = legalReferences(title)[0];
  if (identity && refs.some(r => r.kind === identity.kind && r.number === identity.number &&
    (r.year === null || r.year === identity.year))) return 2;
  if (refs.length) return 0; // Una referencia equivocada no se rescata como coincidencia de título.
  const significant = (s: string) => queryTerms(s).filter(t => !TITLE_GENERIC.has(t) && !/^\d+$/.test(t));
  const terms = significant(query), titleTerms = significant(title);
  const matched = terms.filter(t => titleTerms.some(w => w.startsWith(t) || t.startsWith(w))).length;
  return matched >= 2 && matched / Math.max(1, terms.length) >= 0.8 ? 1 : 0;
}

/** Busca la ficha por identidad aunque el ranking de fragmentos haya omitido el documento. */
async function matchingDocumentCandidates(query: string, publicOnly: boolean): Promise<HitRow[]> {
  const terms = queryTerms(query);
  const refs = legalReferences(query);
  const match = ftsQuery([...new Set([...terms, ...refs.map(r => String(r.number))])], "OR");
  if (!match) return [];
  const cards = await all<{ id: number; title: string }>(`SELECT id,title FROM documents
    WHERE to_tsvector('simple',f_fold(title || ' ' || summary || ' ' || entity)) @@ to_tsquery('simple',$1)
    ${publicOnly ? "AND status='aprobado'" : ""}`, match);
  const ids = cards.filter(d => documentMatch(query, d.title)).map(d => d.id);
  if (!ids.length) return [];
  const contentTerms = terms.filter(t => !/^\d+$/.test(t) && !TITLE_GENERIC.has(t));
  const contentMatch = ftsQuery(contentTerms.length ? contentTerms : terms, "OR");
  return all<HitRow>(`SELECT ${COLUMNS}, c.rank FROM documents d JOIN LATERAL (
    SELECT *, ts_rank_cd(to_tsvector('simple',f_fold(heading || ' ' || coalesce(content,''))),to_tsquery('simple',$1)) AS rank
    FROM chunks WHERE document_id=d.id ORDER BY rank DESC,ord LIMIT 4
    ) c ON true WHERE d.id IN (${ids.map((_, i) => `$${i + 2}`).join(",")})`, contentMatch, ...ids);
}

/** RRF entre consultas, prioridad de ficha, diversidad temática y cupo principal. */
export function fuseQueryHits(lists: Hit[][], limit = 9, perDocument = 2, mainQuota = 3): Hit[] {
  const scores = reciprocalRankFusion(lists.map(list => list.map(h => h.chunkId)));
  const pool = new Map<number, Hit>();
  lists.forEach((list, index) => list.forEach(h => {
    const previous = pool.get(h.chunkId);
    pool.set(h.chunkId, { ...h, score: (scores.get(h.chunkId) || 0) * (h.weight ?? 1),
      coverage: Math.max(h.coverage, previous?.coverage ?? 0),
      documentMatch: Math.max(h.documentMatch ?? 0, previous?.documentMatch ?? 0),
      queryIndexes: [...new Set([...(previous?.queryIndexes || []), index])] });
  }));
  return selectHits([...pool.values()], limit, perDocument, mainQuota);
}

function selectHits<T extends Hit>(hits: T[], limit: number, perDocument: number, mainQuota: number): T[] {
  const ranked = [...hits].sort((a, b) => (b.documentMatch ?? 0) - (a.documentMatch ?? 0) || b.score - a.score || a.chunkId - b.chunkId);
  const out: T[] = [], counts = new Map<number, number>(), covered = new Set<number>();
  const main = (h: T) => (h.weight ?? 1) >= 1;
  const mainCounts = new Map<number, number>();
  ranked.filter(main).forEach(h => mainCounts.set(h.documentId, Math.min(perDocument, (mainCounts.get(h.documentId) || 0) + 1)));
  const targetMain = Math.min(mainQuota, limit, [...mainCounts.values()].reduce((n, count) => n + count, 0));
  const available = (h: T) => !out.includes(h) && (counts.get(h.documentId) || 0) < perDocument;
  const add = (h?: T) => {
    if (!h || out.length >= limit || !available(h)) return;
    if (!main(h) && limit - out.length <= targetMain - out.filter(main).length) return;
    out.push(h); counts.set(h.documentId, (counts.get(h.documentId) || 0) + 1);
    h.queryIndexes?.forEach(i => covered.add(i));
  };
  // Una ficha por documento antes de repetir párrafos de la misma norma.
  for (const h of ranked.filter(h => h.documentMatch)) if (!counts.has(h.documentId)) add(h);
  // Reserva real, incluso si los puntajes masivos son mayores (hasta lo disponible).
  while (out.filter(main).length < targetMain) {
    const h = ranked.find(h => main(h) && available(h));
    if (!h || out.length >= limit) break;
    add(h);
  }
  const queryIds = [...new Set(ranked.flatMap(h => h.queryIndexes || []))];
  for (const i of queryIds) if (!covered.has(i)) add(ranked.find(h => h.queryIndexes?.includes(i) && available(h)));
  for (const h of ranked) add(h);
  return out.sort((a, b) => (b.documentMatch ?? 0) - (a.documentMatch ?? 0));
}

/** RRF combina posiciones: los rangos léxico y coseno no comparten unidades. */
export function reciprocalRankFusion(lists: number[][], k = 60): Map<number, number> {
  const scores = new Map<number, number>();
  for (const list of lists) {
    const seen = new Set<number>();
    list.forEach((id,i) => {
      if (!seen.has(id)) scores.set(id,(scores.get(id) || 0)+1/(k+i+1));
      seen.add(id);
    });
  }
  return scores;
}
async function hasLexicalIndex(publicOnly: boolean): Promise<boolean> {
  const [row] = await all<{ available: boolean }>(`SELECT EXISTS (
    SELECT 1 FROM chunk_search s JOIN chunks c ON c.id=s.chunk_id
    JOIN documents d ON d.id=c.document_id ${publicOnly ? "WHERE d.status='aprobado'" : ""}
  ) AS available`);
  return row.available;
}

async function topicDocumentIds(topicIds: number[]): Promise<Set<number>> {
  if (!topicIds.length) return new Set();
  const marks = topicIds.map(() => "?").join(",");
  const rows = await all<{ document_id: number }>(`SELECT DISTINCT dc.document_id FROM document_categories dc
    JOIN categories c ON c.id=dc.category_id WHERE c.id IN (${marks}) OR c.parent_id IN (${marks})`, ...topicIds, ...topicIds);
  return new Set(rows.map(r => r.document_id));
}

export type SearchContext = { approvedDocumentIds: number[]; topicDocs: Set<number>; lexicalIndex: boolean };

/** Contexto limitado a esta recuperación: no conserva aprobaciones obsoletas entre peticiones. */
export async function prepareSearchContext(topicIds: number[]): Promise<SearchContext> {
  const [documents, topicDocs, lexicalIndex] = await Promise.all([
    all<{ id: number }>("SELECT id FROM documents WHERE status='aprobado'"),
    topicDocumentIds(topicIds), hasLexicalIndex(true),
  ]);
  return { approvedDocumentIds: documents.map(d => d.id), topicDocs, lexicalIndex };
}

export async function lexicalCandidates(query: string, publicOnly = true, indexed?: boolean): Promise<HitRow[]> {
  const terms = queryTerms(query);
  if (!terms.length) return [];
  const synonyms = expand(terms);
  const match = ftsQuery([...new Set([...terms,...[...synonyms.values()].flat()])],"OR");
  const condition = publicOnly ? "AND d.status='aprobado'" : "";
  // El respaldo se decide por biblioteca, no por coincidencias de esta consulta.
  const useIndex = indexed ?? await hasLexicalIndex(publicOnly);
  const candidates = useIndex ? `
      SELECT chunk_id AS id, ts_rank_cd(tsv,to_tsquery('simple',$1)) AS rank
      FROM chunk_search WHERE tsv @@ to_tsquery('simple',$1)
      ORDER BY rank DESC,chunk_id LIMIT 3000` : `
      SELECT id, ts_rank_cd(to_tsvector('simple',f_fold(heading || ' ' || content)),to_tsquery('simple',$1)) AS rank
      FROM chunks WHERE content IS NOT NULL AND
        to_tsvector('simple',f_fold(heading || ' ' || content)) @@ to_tsquery('simple',$1)
      ORDER BY rank DESC,id LIMIT 3000`;
  // Primero limita usando el tsv almacenado; después obtiene fragmentos y fichas.
  const primary = await all<HitRow>(`
    SELECT ${COLUMNS}, hit.rank FROM (
      ${candidates}
    ) hit JOIN chunks c ON c.id=hit.id JOIN documents d ON d.id=c.document_id
    WHERE true ${condition} ORDER BY hit.rank DESC,c.id`,match);
  // Las masivas solo consultan sus fichas en GIN; nunca se descarga un corpus para buscar.
  const cards = await all<HitRow>(`
    SELECT ${COLUMNS},hit.rank FROM (
      SELECT id,ts_rank_cd(to_tsvector('simple',f_fold(title || ' ' || summary || ' ' || entity)),to_tsquery('simple',$1)) AS rank
      FROM documents WHERE to_tsvector('simple',f_fold(title || ' ' || summary || ' ' || entity)) @@ to_tsquery('simple',$1)
      ${publicOnly ? "AND status='aprobado'" : ""}
      ORDER BY rank DESC,id LIMIT 300
    ) hit JOIN documents d ON d.id=hit.id
    JOIN LATERAL (SELECT * FROM chunks WHERE document_id=d.id ORDER BY ord LIMIT 3) c ON true
    ORDER BY hit.rank DESC,c.id`,match);
  const unique = new Map<number,HitRow>();
  for (const row of [...primary,...cards].sort((a,b) => b.rank-a.rank || a.chunk_id-b.chunk_id)) {
    if (!unique.has(row.chunk_id)) unique.set(row.chunk_id,row);
  }
  return [...unique.values()];
}
export async function vectorCandidates(vector: Float32Array, model: string, approvedDocumentIds?: number[]): Promise<HitRow[]> {
  return tx(async database => {
    // El bloque maneja parámetros ausentes sin dejar abortada la transacción local.
    await database.exec(`DO $$ BEGIN
      PERFORM set_config('hnsw.ef_search', '320', true);
      PERFORM set_config('hnsw.iterative_scan', 'relaxed_order', true);
    EXCEPTION WHEN undefined_object OR invalid_parameter_value OR feature_not_supported THEN NULL;
    END $$;`);
    const ids = approvedDocumentIds ?? (await database.query<{ id: number }>(
      "SELECT id FROM documents WHERE status='aprobado'",
    )).map(d => d.id);
    if (!ids.length) return [];
      // El ORDER BY interior debe ser solo el operador de distancia para usar HNSW.
      // + 0 impide elegir el índice de document_id en vez de HNSW; ANY filtra el escaneo iterativo.
      const candidates = await database.query<HitRow>(`SELECT ${COLUMNS},c.rank FROM (
        SELECT id,document_id,ord,heading,content,embedding <=> $1::halfvec(384) AS rank
        FROM chunks WHERE embedding IS NOT NULL AND embedding_model=$2
          AND (document_id + 0) = ANY($3::integer[])
        ORDER BY embedding <=> $1::halfvec(384) LIMIT 320
      ) c JOIN documents d ON d.id=c.document_id
      WHERE d.status='aprobado'
      ORDER BY c.rank + 0,c.id`, [toPgvector(vector), model, `{${ids.join(",")}}`]);
    const ordered = candidates.sort((a,b) => a.rank-b.rank || a.chunk_id-b.chunk_id);
    const general = ordered.slice(0,180);
    const main = ordered.filter(r => r.weight>=1).slice(0,60);
    return [...new Map([...general,...main].sort((a,b) => a.rank-b.rank || a.chunk_id-b.chunk_id)
      .map(r => [r.chunk_id,r])).values()];
  });
}

export async function searchChunks(
  query: string,
  opts: { topicIds?: number[]; limit?: number; boostText?: string; publicOnly?: boolean; perDocument?: number; hydrate?: boolean; documentIds?: number[];
    context?: SearchContext; vector?: Float32Array | null; timings?: Timings } = {},
): Promise<Hit[]> {
  const terms = queryTerms(query);
  if (!terms.length) return [];
  const limit = opts.limit ?? 6;
  const synonyms = expand(terms);
  const timings = opts.timings ?? createTimings();
  const [[lexical,cards],semantic] = await Promise.all([
    timings.measure("lexica", () => Promise.all([
      lexicalCandidates(query,opts.publicOnly ?? true, opts.publicOnly === false ? undefined : opts.context?.lexicalIndex),
      matchingDocumentCandidates(query,opts.publicOnly ?? true),
    ])),
    (async () => {
      const vector = opts.vector !== undefined ? opts.vector : await timings.measure("embeddings", () => embedQuery(query));
      return vector ? timings.measure("vectorial", () => vectorCandidates(vector,embeddingModel(),opts.context?.approvedDocumentIds)) : [];
    })(),
  ]);
  const fused = reciprocalRankFusion([lexical.map(r => r.chunk_id),semantic.map(r => r.chunk_id),cards.map(r => r.chunk_id)]);
  const semanticIds = new Set(semantic.map(r => r.chunk_id));
  const candidates = [...new Map([...lexical,...semantic,...cards].map(r => [r.chunk_id,r])).values()];
  const allowed = opts.documentIds ? new Set(opts.documentIds) : null;
  const pool = candidates.filter(r => !allowed || allowed.has(r.document_id))
    .sort((a,b) => (fused.get(b.chunk_id) || 0)-(fused.get(a.chunk_id) || 0));
  // Cupos de candidatos y de resultados para la colección principal.
  const rows = [...new Map([...pool.slice(0,Math.max(120,limit*10)),
    ...pool.filter(r => r.weight>=1).slice(0,Math.max(60,limit*3)),
    ...pool.filter(r => documentMatch(query,r.title))].map(r => [r.chunk_id,r])).values()];
  const topicDocs = opts.context?.topicDocs ?? await topicDocumentIds(opts.topicIds ?? []);
  const generic = ["pueblo","comunidad","resguardo","municipio","indigena"];
  const boostTerms = (fold(opts.boostText || "").match(/[a-z0-9]{4,}/g) || []).filter(w => !STOPWORDS.has(w) && !generic.includes(w));
  const scored = rows.map(r => {
    const hay = fold(`${r.title} ${r.heading} ${r.content ?? r.summary}`);
    const matched = terms.filter(t => hay.includes(t) || (synonyms.get(t) || []).some(x => hay.includes(x))).length;
    const coverage = matched/terms.length;
    let score = (fused.get(r.chunk_id) || 0)*(0.4+coverage*coverage);
    if (topicDocs.has(r.document_id)) score *= 1.6;
    if (boostTerms.some(w => hay.includes(w))) score *= 1.25;
    if (r.heading.startsWith("Artículo") || r.heading.includes("· Artículo")) score *= 1.1;
    score *= r.weight;
    return { chunkId:r.chunk_id,documentId:r.document_id,ord:r.ord,heading:r.heading,content:r.content,
      title:r.title,entity:r.entity,docType:r.doc_type,docDate:r.doc_date,officialUrl:r.official_url,score,coverage,
      weight:r.weight,documentMatch:documentMatch(query,r.title) };
  });
  const minMatched = terms.length>=5 ? 3 : terms.length>=3 ? 2 : 1;
  // La semántica admite paráfrasis que no contienen las palabras de la pregunta.
  const relevant = scored.filter(h => h.documentMatch || semanticIds.has(h.chunkId) || Math.round(h.coverage*terms.length)>=minMatched)
    .sort((a,b) => b.score-a.score);
  const out = selectHits(relevant as Hit[],limit,opts.perDocument ?? 2,3);
  // Solo aquí se recuperan los JSON completos de los documentos seleccionados.
  const result = opts.hydrate !== false
    ? (await timings.measure("hidratacion", () => hydrateChunks(out))).filter(h => h.content.length>0) : out as Hit[];
  if (!opts.timings) timings.report();
  return result;
}

export async function searchDocumentsByContent(query: string, publicOnly: boolean, documentIds?: number[]) {
  const hits = await searchChunks(query,{publicOnly,documentIds,limit:600,perDocument:1,hydrate:false});
  return new Map(hits.map(h => [h.documentId,{ snippet:h.content ? highlightExcerpt(h.content,query) : "", rank:-h.score, ord:h.ord }]));
}
export function highlightExcerpt(content: string, query: string): string {
  const text = excerpt(content,query);
  const terms = queryTerms(query);
  return text.replace(/[\p{L}\p{N}]+/gu, word => terms.some(t => fold(word).startsWith(t)) ? MARK_OPEN+word+MARK_CLOSE : word);
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
