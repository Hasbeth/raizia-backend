/**
 * Búsqueda híbrida sobre Postgres/pgvector y detección de temáticas.
 * Fusión RRF con degradación léxica si el proveedor de embeddings no está disponible.
 */
import { all } from "./db";
import { embedQuery, embeddingModel, toPgvector } from "./embeddings";
import { hydrateChunks } from "./storage";
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
};

type HitRow = {
  chunk_id: number; document_id: number; ord: number; heading: string; content: string | null;
  title: string; summary: string; entity: string; doc_type: string; doc_date: string; official_url: string;
  weight: number; rank: number;
};
const COLUMNS = "c.id AS chunk_id,c.document_id,c.ord,c.heading,c.content,d.title,d.summary,d.entity,d.doc_type,d.doc_date,d.official_url,d.weight";

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
export async function lexicalCandidates(query: string, publicOnly = true): Promise<HitRow[]> {
  const terms = queryTerms(query);
  if (!terms.length) return [];
  const synonyms = expand(terms);
  const match = ftsQuery([...new Set([...terms,...[...synonyms.values()].flat()])],"OR");
  const condition = publicOnly ? "AND d.status='aprobado'" : "";
  // Primero limita dentro del índice de expresión; después obtiene fichas.
  const primary = await all<HitRow>(`
    SELECT ${COLUMNS}, hit.rank FROM (
      SELECT id, ts_rank_cd(to_tsvector('simple',f_fold(heading || ' ' || content)),to_tsquery('simple',$1)) AS rank
      FROM chunks WHERE content IS NOT NULL AND
        to_tsvector('simple',f_fold(heading || ' ' || content)) @@ to_tsquery('simple',$1)
      ORDER BY rank DESC,id LIMIT 3000
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
export async function vectorCandidates(vector: Float32Array, model: string): Promise<HitRow[]> {
  const sql = `SELECT ${COLUMNS},(c.embedding <=> $1::halfvec(384)) AS rank
    FROM chunks c JOIN documents d ON d.id=c.document_id
    WHERE d.status='aprobado' AND c.embedding IS NOT NULL AND c.embedding_model=$2`;
  const params = [toPgvector(vector),model] as const;
  const [general,main] = await Promise.all([
    all<HitRow>(sql+" ORDER BY rank,c.id LIMIT 180",...params),
    all<HitRow>(sql+" AND d.weight>=1 ORDER BY rank,c.id LIMIT 60",...params),
  ]);
  return [...new Map([...general,...main].sort((a,b) => a.rank-b.rank).map(r => [r.chunk_id,r])).values()];
}

export async function searchChunks(
  query: string,
  opts: { topicIds?: number[]; limit?: number; boostText?: string; publicOnly?: boolean; perDocument?: number; hydrate?: boolean; documentIds?: number[] } = {},
): Promise<Hit[]> {
  const terms = queryTerms(query);
  if (!terms.length) return [];
  const limit = opts.limit ?? 6;
  const synonyms = expand(terms);
  const [lexical,vector] = await Promise.all([lexicalCandidates(query,opts.publicOnly ?? true),embedQuery(query)]);
  const semantic = vector ? await vectorCandidates(vector,embeddingModel()) : [];
  const fused = reciprocalRankFusion([lexical.map(r => r.chunk_id),semantic.map(r => r.chunk_id)]);
  const semanticIds = new Set(semantic.map(r => r.chunk_id));
  const candidates = [...new Map([...lexical,...semantic].map(r => [r.chunk_id,r])).values()];
  const allowed = opts.documentIds ? new Set(opts.documentIds) : null;
  const pool = candidates.filter(r => !allowed || allowed.has(r.document_id))
    .sort((a,b) => (fused.get(b.chunk_id) || 0)-(fused.get(a.chunk_id) || 0));
  // Cupos de candidatos y de resultados para la colección principal.
  const rows = [...new Map([...pool.slice(0,Math.max(120,limit*10)),
    ...pool.filter(r => r.weight>=1).slice(0,Math.max(60,limit*3))].map(r => [r.chunk_id,r])).values()];
  const topicDocs = new Set<number>();
  if (opts.topicIds?.length) {
    const marks = opts.topicIds.map(() => "?").join(",");
    const ids = await all<{ document_id: number }>(`SELECT DISTINCT dc.document_id FROM document_categories dc
      JOIN categories c ON c.id=dc.category_id WHERE c.id IN (${marks}) OR c.parent_id IN (${marks})`,...opts.topicIds,...opts.topicIds);
    ids.forEach(r => topicDocs.add(r.document_id));
  }
  const generic = ["pueblo","comunidad","resguardo","municipio","indigena"];
  const boostTerms = (fold(opts.boostText || "").match(/[a-z0-9]{4,}/g) || []).filter(w => !STOPWORDS.has(w) && !generic.includes(w));
  const weightOf = new Map(rows.map(r => [r.chunk_id,r.weight]));
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
      title:r.title,entity:r.entity,docType:r.doc_type,docDate:r.doc_date,officialUrl:r.official_url,score,coverage };
  });
  const minMatched = terms.length>=5 ? 3 : terms.length>=3 ? 2 : 1;
  // La semántica admite paráfrasis que no contienen las palabras de la pregunta.
  const relevant = scored.filter(h => semanticIds.has(h.chunkId) || Math.round(h.coverage*terms.length)>=minMatched)
    .sort((a,b) => b.score-a.score);
  const isBulk = (h: typeof scored[number]) => (weightOf.get(h.chunkId) ?? 1)<1;
  const perDoc = new Map<number,number>();
  const out: typeof scored = [];
  const pick = (overflow: boolean) => {
    for (const h of relevant) {
      if (out.length>=limit) break;
      if (out.includes(h) || (perDoc.get(h.documentId) || 0)>=(opts.perDocument ?? 3)) continue;
      if (!overflow && isBulk(h) && out.filter(isBulk).length>=Math.ceil(limit/2)) continue;
      perDoc.set(h.documentId,(perDoc.get(h.documentId) || 0)+1); out.push(h);
    }
  };
  pick(false); pick(true);
  out.sort((a,b) => b.score-a.score);
  // Solo aquí se recuperan los JSON completos (máximo 6 en chat).
  if (opts.hydrate !== false) return (await hydrateChunks(out)).filter(h => h.content.length>0);
  return out as Hit[];
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
