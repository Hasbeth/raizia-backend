import { randomUUID, timingSafeEqual } from "node:crypto";
import { db, query, get } from "./db";
import { hydrateChunks } from "./storage";
import { embedDocuments, embeddingModel, toPgvector } from "./embeddings";
import { measureSpace } from "../../scripts/lib/space.mjs";
export async function getSpace() { return measureSpace(await db()); }
export function validCron(request:Request):boolean {
  const secret=process.env.CRON_SECRET;
  if (!secret) return false;
  const a=Buffer.from(request.headers.get("authorization")||""); const b=Buffer.from("Bearer "+secret);
  return a.length===b.length && timingSafeEqual(a,b);
}
type Pending={id:number;documentId:number;ord:number;content:string|null;content_hash:string};
export async function calculatePending({budgetMs=240_000,maxTexts=320,signal}:{budgetMs?:number;maxTexts?:number;signal?:AbortSignal}={}) {
  const start=Date.now(); const owner=randomUUID(); const model=embeddingModel();
  const lease=await query(`INSERT INTO maintenance_jobs(name,owner,expires_at) VALUES('embeddings',$1,CURRENT_TIMESTAMP+interval '270 seconds')
    ON CONFLICT(name) DO UPDATE SET owner=excluded.owner,expires_at=excluded.expires_at
    WHERE maintenance_jobs.expires_at<CURRENT_TIMESTAMP RETURNING owner`,[owner]);
  const remaining=async () => Number((await get<{n:number}>("SELECT count(*)::int n FROM chunks WHERE embedding IS NULL"))!.n);
  if (!lease.length) return {processed:0,remaining:await remaining(),busy:true,model};
  let processed=0; let reason:string|undefined;
  let cursor=0;
  try {
    while (processed<maxTexts && Date.now()-start<budgetMs-15_000 && !signal?.aborted) {
      const batch=await query<Pending>('SELECT id,document_id AS "documentId",ord,content,content_hash FROM chunks WHERE embedding IS NULL AND id>$1 ORDER BY id LIMIT $2',[cursor,Math.min(32,maxTexts-processed)]);
      if (!batch.length) break;
      const hydrated=await hydrateChunks(batch); cursor=batch.at(-1)!.id;
      const ready=hydrated.filter(h=>h.content);
      if (!ready.length) continue;
      const rate=await get<{wait:number}>("SELECT GREATEST(0,EXTRACT(EPOCH FROM (expires_at-CURRENT_TIMESTAMP))*1000)::int wait FROM maintenance_jobs WHERE name='embedding-rate'");
      const wait=rate?.wait||0;
      if (Date.now()-start+wait>=budgetMs-15_000) break;
      if (wait) await new Promise(resolve=>setTimeout(resolve,wait));
      signal?.throwIfAborted();
      // Reserva persistente, también ante errores/429; mantiene ~90 textos/min entre invocaciones.
      await query(`INSERT INTO maintenance_jobs(name,owner,expires_at) VALUES('embedding-rate',$1,CURRENT_TIMESTAMP+($2::int*interval '1 millisecond'))
        ON CONFLICT(name) DO UPDATE SET owner=excluded.owner,expires_at=excluded.expires_at`,[owner,Math.ceil(ready.length*60_000/90)]);
      const vectors=await embedDocuments(ready.map(h=>h.content),{signal});
      for (let i=0;i<ready.length;i++) {
        const changed=await query("UPDATE chunks SET embedding=$1::halfvec(384),embedding_model=$2 WHERE id=$3 AND content_hash=$4 AND embedding IS NULL RETURNING id",
          [toPgvector(vectors[i]),model,ready[i].id,ready[i].content_hash]);
        processed+=changed.length;
      }
    }
  } catch {
    reason="El proveedor no está disponible o se agotó su cuota. Puedes reanudar después.";
  } finally {
    await query("DELETE FROM maintenance_jobs WHERE name='embeddings' AND owner=$1",[owner]);
  }
  return {processed,remaining:await remaining(),busy:false,model,reason,elapsedMs:Date.now()-start};
}
