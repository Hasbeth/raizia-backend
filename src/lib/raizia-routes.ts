import { all } from "./db";
import { fold, queryTerms, documentMatch, type Hit } from "./search";

export type RouteTopic = "discriminacion" | "salud" | "educacion";
const patterns: Record<RouteTopic, RegExp> = {
  discriminacion: /\b(?:discrimin\w*|racis\w*|polici\w*|abus\w* de (?:su )?autoridad|insult\w*|humill\w*|requis\w*|dejaron entrar|dejan entrar|negaron (?:la )?entrada|por ser (?:indigena|negr\w*|afro\w*|raizal|palenquer\w*|rrom|gitan\w*)|por mi (?:color|raza|etnia))\b/,
  salud: /\b(?:salud|eps|medicamento\w*|cita\w*|transporte|remisi\w*|hospital\w*|medic\w*)\b/,
  educacion: /\b(?:educaci\w*|universidad\w*|cupo\w*|icetex|docente\w*|escuela\w*|colegio\w*|estudi\w*)\b/,
};
export function routeTopics(question: string, subtopics: string[] = []): RouteTopic[] {
  const direct = (Object.keys(patterns) as RouteTopic[]).filter(k => patterns[k].test(fold(question)));
  // Los subtemas respaldan consultas indirectas; no borran el tema explícito.
  return direct.length ? direct : (Object.keys(patterns) as RouteTopic[]).filter(k => subtopics.some(s => patterns[k].test(fold(s))));
}
export function routeRelevant(hit: Pick<Hit, "title">, question: string, topics: RouteTopic[]): boolean {
  if (!topics.length || documentMatch(question, hit.title) === 2 || fold(question).includes(fold(hit.title))) return true;
  const title = fold(hit.title);
  if (/codigo de comercio/.test(title) && !/comercio|comerciante|sociedad comercial/.test(fold(question))) return false;
  if (/ley 1861/.test(title) && !/militar|reclutamiento|libreta|1861/.test(fold(question))) return false;
  return true;
}

/** Consulta por ficha aprobada: las rutas no dependen de entrar al ranking vectorial. */
export async function routeCandidates(question: string, subtopics: string[] = []): Promise<Hit[]> {
  const topics = routeTopics(question, subtopics);
  if (!topics.length) return [];
  const docs = await all<{ id: number; title: string; entity: string; doc_type: string; doc_date: string; official_url: string; weight: number }>(
    `SELECT id,title,entity,doc_type,doc_date,official_url,weight FROM documents WHERE status='aprobado' AND
    (title LIKE 'Ruta RAIZIA%' OR ($1 AND (f_fold(title) ~ 't[- –]?(122[ /-]*(de )?(21|2021)|407[ /-]*(de )?(24|2024))' OR (f_fold(doc_type) LIKE '%concepto%' AND f_fold(entity || ' ' || title) ~ 'supersalud|superintendencia nacional de salud'))))`, topics.includes("salud"));
  const selected = docs.filter(d => /^Ruta RAIZIA\s*[—–-]/i.test(d.title)
    ? topics.some(k => patterns[k].test(fold(d.title)))
    : topics.includes("salud") && /transporte|traslado|remisi|viatico|alojamiento|acompanante/.test(fold([question, ...subtopics].join(" "))));
  if (!selected.length) return [];
  const rows = await all<{ id: number; document_id: number; ord: number; heading: string; content: string }>(
    `SELECT id,document_id,ord,heading,content FROM chunks WHERE document_id IN (${selected.map((_, i) => `$${i + 1}`).join(",")}) AND content IS NOT NULL`, ...selected.map(d => d.id));
  const terms = [...new Set(queryTerms([question, ...subtopics].join(" ")))];
  const relevance = (r: typeof rows[number]) => terms.filter(t => fold(r.heading + " " + r.content).includes(t)).length + (/pasos|acudir|llevar|radicar|responden|ruta|que hacer/.test(fold(r.heading)) ? 1 : 0);
  return selected.flatMap(d => rows.filter(r => r.document_id === d.id).sort((a, b) => relevance(b) - relevance(a) || a.ord - b.ord).slice(0, /^Ruta RAIZIA/.test(d.title) ? 2 : 1).map(r => ({
    chunkId: r.id, documentId: d.id, ord: r.ord, heading: r.heading,
    // Una ruta se entrega completa para no perder pasos como "a dónde denunciar".
    content: /^Ruta RAIZIA/.test(d.title) && r.id === rows.filter(x => x.document_id === d.id).sort((a, b) => relevance(b) - relevance(a) || a.ord - b.ord)[0].id
      ? rows.filter(x => x.document_id === d.id).sort((a, b) => a.ord - b.ord).map(x => `${x.heading}\n${x.content}`).join("\n\n").slice(0, 7000) : r.content,
    title: d.title, entity: d.entity, docType: d.doc_type, docDate: d.doc_date, officialUrl: d.official_url,
    weight: d.weight, score: 1, coverage: relevance(r) / Math.max(1, terms.length), documentMatch: documentMatch(question, d.title),
  })));
}

export function reserveRoutes(ranked: Hit[], direct: Hit[]): Hit[] {
  const result = [...ranked];
  const reserved = new Set<number>();
  // Conserva al menos la primera norma/sentencia del tema y las referencias expresas.
  const notRoute = (h: Hit) => !/^Ruta RAIZIA/.test(h.title);
  const primary = result.find(h => notRoute(h) && /^(?:constituci|ley |decreto)/i.test(h.title)) || result.find(notRoute);
  if (primary) reserved.add(primary.chunkId);
  result.filter(h => h.documentMatch === 2).forEach(h => reserved.add(h.chunkId));
  for (const hit of direct) {
    const existing = result.find(h => h.chunkId === hit.chunkId || h.articleKey && h.articleKey === hit.articleKey);
    if (existing) { reserved.add(existing.chunkId); continue; }
    // Las dos plazas de cada ruta se reservan incluso si estaba otro fragmento suyo.
    let index = result.findLastIndex(h => h.documentId === hit.documentId && !reserved.has(h.chunkId));
    if (result.filter(h => h.documentId === hit.documentId).length < 2) index = result.length >= 9 ? result.findLastIndex(h => !reserved.has(h.chunkId)) : -1;
    if (index >= 0) result.splice(index, 1);
    if (result.length < 9) { result.push(hit); reserved.add(hit.chunkId); }
  }
  return result.slice(0, 9);
}
