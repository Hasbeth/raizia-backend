import { query } from "./db";
import { createStorage, packViewer, unpackViewer } from "../../scripts/lib/storage-core.mjs";

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
