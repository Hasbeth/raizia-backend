import { query } from "./db";
import { createStorage, packViewer, unpackViewer } from "../../scripts/lib/storage-core.mjs";
import { isArticle, joinArticle, limitArticle } from "./article-context";
import type { Hit } from "./search";

export type ViewerChunk = { ord: number; heading: string; content: string };
export type Viewer = { id: number; title: string; chunks: ViewerChunk[] };
export const storage = () => createStorage({ query });
const cache = new Map<number, { value: Viewer; bytes: number; at: number }>();
let cacheBytes = 0;
export function invalidateViewer(id: number) {
  cacheBytes -= cache.get(id)?.bytes || 0;
  cache.delete(id);
}
export async function saveViewer(viewer: Viewer) {
  await storage().put("textos", `${viewer.id}.json.gz`, packViewer(viewer), "application/gzip");
  invalidateViewer(viewer.id);
}
export async function readViewer(id: number): Promise<Viewer | null> {
  const found = cache.get(id);
  if (found && Date.now() - found.at < 300_000) {
    cache.delete(id); cache.set(id, found); return found.value;
  }
  invalidateViewer(id);
  const buffer = await storage().get("textos", `${id}.json.gz`);
  if (!buffer) return null;
  const value = unpackViewer(buffer) as Viewer;
  const bytes = value.chunks.reduce((n,c) => n+c.content.length*2+c.heading.length*2+64,0);
  if (bytes <= 24*1024*1024) {
    while (cache.size >= 12 || cacheBytes + bytes > 24*1024*1024) invalidateViewer(cache.keys().next().value!);
    cache.set(id,{value,bytes,at:Date.now()}); cacheBytes += bytes;
  }
  return value;
}
export async function hydrateChunks<T extends { documentId: number; ord: number; content: string | null }>(hits: T[]): Promise<(T & { content: string })[]> {
  const docs = new Map<number, Viewer | null>();
  for (const h of hits) if (h.content === null && !docs.has(h.documentId)) docs.set(h.documentId, await readViewer(h.documentId));
  return hits.map(h => ({ ...h, content: h.content ?? docs.get(h.documentId)?.chunks.find(c => c.ord === h.ord)?.content ?? "" }));
}

/** Una consulta por lote; la contigüidad se resuelve en memoria, nunca por fuente. */
export async function hydrateArticleChunks(hits: Hit[], terms: string[]): Promise<Hit[]> {
  const articles = [...new Map(hits.filter(isArticle).map(h => [JSON.stringify([h.documentId, h.heading]), h])).values()];
  if (!articles.length) return hydrateChunks(hits);
  const params = articles.flatMap(h => [h.documentId, h.heading]);
  const rows = await query<{ chunkId: number; documentId: number; ord: number; heading: string; content: string | null }>(`
    WITH articles(document_id, heading) AS (VALUES ${articles.map((_, i) => `($${i * 2 + 1}::integer,$${i * 2 + 2}::text)`).join(",")})
    SELECT c.id AS "chunkId", c.document_id AS "documentId", c.ord, c.heading, c.content
    FROM articles a JOIN chunks c ON c.document_id=a.document_id AND c.heading=a.heading
    JOIN documents d ON d.id=c.document_id AND d.weight>=1
    ORDER BY c.document_id,c.ord`, params);
  const hydrated = await hydrateChunks([...hits, ...rows]);
  const groups = new Map<string, typeof rows>();
  for (const row of hydrated.slice(hits.length)) {
    const key = JSON.stringify([row.documentId, row.heading]);
    const group = groups.get(key) || [];
    group.push(row);
    groups.set(key, group);
  }
  const contexts = new Map<number, { articleKey: string; content: string }>();
  for (const group of groups.values()) {
    let start = 0;
    while (start < group.length) {
      let end = start + 1;
      while (end < group.length && group[end].ord === group[end - 1].ord + 1) end++;
      const parts = group.slice(start, end);
      const context = { articleKey: JSON.stringify([parts[0].documentId, parts[0].heading, parts[0].ord]),
        content: limitArticle(joinArticle(parts.map(c => c.content || "")), terms) };
      for (const part of parts) contexts.set(part.chunkId, context);
      start = end;
    }
  }
  return hits.map((hit, i) => {
    if (!isArticle(hit)) return { ...hit, content: hydrated[i].content };
    return { ...hit, ...(contexts.get(hit.chunkId) || { content: limitArticle(hydrated[i].content, terms) }), articleContext: true };
  });
}
