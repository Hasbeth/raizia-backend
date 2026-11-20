/**
 * Repositorio async. Postgres guarda fichas e índice; Storage guarda originales y visor.
 */
import crypto from "node:crypto";
import path from "node:path";
import { all, get, run, slugify, tx } from "./db";
import { detectKind, extractText, toUtf8Html } from "./ingest";
import { detectTopics, fold, queryTerms, searchDocumentsByContent, highlightExcerpt } from "./search";
import { fetchOfficial } from "./fetcher";
import { readViewer, saveViewer, storage, invalidateViewer } from "./storage";
import { fragmentDocument, selectChunks } from "../../scripts/lib/biblioteca-core.mjs";
import type { Category, CategoryNode, DocStatus, DocumentSummary } from "./constants";
import { STATUSES } from "./constants";

type DocRow = {
  id:number; title:string; entity:string; doc_type:string; doc_date:string; official_url:string;
  summary:string; status:DocStatus; file_name:string; file_path:string; mime:string; file_size:number;
  source_kind:"upload"|"url"; content_hash:string; text_chars:number; review_note:string; created_at:string;
  updated_at:string; chunk_count:number; weight:number;
};
const DOC_SELECT = "SELECT d.*, (SELECT COUNT(*)::int FROM chunks c WHERE c.document_id=d.id) AS chunk_count FROM documents d";
async function mapDocs(rows: DocRow[]): Promise<DocumentSummary[]> {
  if (!rows.length) return [];
  const cats = await all<{document_id:number;id:number;name:string;parent_id:number|null}>(
    "SELECT dc.document_id,c.id,c.name,c.parent_id FROM document_categories dc JOIN categories c ON c.id=dc.category_id ORDER BY c.parent_id IS NOT NULL,c.sort");
  const byDoc = new Map<number,DocumentSummary["categories"]>();
  for (const c of cats) {
    const list = byDoc.get(c.document_id) || [];
    list.push({id:c.id,name:c.name,parentId:c.parent_id}); byDoc.set(c.document_id,list);
  }
  return rows.map(r => ({id:r.id,title:r.title,entity:r.entity,docType:r.doc_type,docDate:r.doc_date,
    officialUrl:r.official_url,summary:r.summary,status:r.status,fileName:r.file_name,mime:r.mime,
    fileSize:Number(r.file_size),sourceKind:r.source_kind,textChars:r.text_chars,chunkCount:r.chunk_count,
    reviewNote:r.review_note,createdAt:r.created_at,updatedAt:r.updated_at,categories:byDoc.get(r.id)||[]}));
}
export type ListOptions = {q?:string;categoryId?:number;docType?:string;entity?:string;status?:DocStatus;publicOnly?:boolean};
const snippetOrd = new WeakMap<DocumentSummary,number>();
export async function listDocuments(opts:ListOptions = {}): Promise<DocumentSummary[]> {
  const where:string[] = []; const params:(string|number)[] = [];
  if (opts.publicOnly) where.push("d.status='aprobado'");
  else if (opts.status) {where.push("d.status=?");params.push(opts.status);}
  if (opts.categoryId) {
    where.push("d.id IN (SELECT dc.document_id FROM document_categories dc JOIN categories c ON c.id=dc.category_id WHERE c.id=? OR c.parent_id=?)");
    params.push(opts.categoryId,opts.categoryId);
  }
  if (opts.docType) {where.push("d.doc_type=?");params.push(opts.docType);}
  if (opts.entity) {where.push("d.entity=?");params.push(opts.entity);}
  const order = opts.publicOnly ? "CASE d.doc_type WHEN 'Constitución' THEN 0 WHEN 'Ley' THEN 1 WHEN 'Decreto' THEN 2 WHEN 'Sentencia' THEN 3 WHEN 'Auto' THEN 5 ELSE 4 END,d.weight DESC,d.doc_date DESC,lower(d.title)" : "d.created_at DESC,d.id DESC";
  const docs = await mapDocs(await all<DocRow>(DOC_SELECT+(where.length ? " WHERE "+where.join(" AND ") : "")+" ORDER BY "+order,...params));
  const q = opts.q?.trim();
  if (!q) return docs;
  const terms = queryTerms(q); const words = terms.length ? terms : [fold(q)];
  const content = await searchDocumentsByContent(q,!!opts.publicOnly,docs.map(d=>d.id));
  const ranked:{doc:DocumentSummary;order:number}[] = [];
  for (const doc of docs) {
    const meta = fold(`${doc.title} ${doc.summary} ${doc.entity} ${doc.docType} ${doc.categories.map(c=>c.name).join(" ")}`);
    const metaMatch = words.every(w=>meta.includes(w)); const hit = content.get(doc.id);
    if (!metaMatch && !hit) continue;
    if (hit) { doc.snippet = hit.snippet || undefined; snippetOrd.set(doc,hit.ord); }
    ranked.push({doc,order:(metaMatch ? -1000 : 0)+(hit?.rank ?? 0)});
  }
  return ranked.sort((a,b)=>a.order-b.order).map(r=>r.doc);
}
/** Después de paginar: descarga como máximo los 25 textos de una página. */
export async function hydrateLibraryPage(docs:DocumentSummary[],query:string): Promise<DocumentSummary[]> {
  if (!query.trim()) return docs;
  for (const doc of docs) {
    const ord = snippetOrd.get(doc);
    if (ord === undefined || doc.snippet) continue;
    const viewer = await readViewer(doc.id);
    const content = viewer?.chunks.find(c=>c.ord===ord)?.content;
    if (content) doc.snippet = highlightExcerpt(content,query);
  }
  return docs;
}
export async function getDocument(id:number,publicOnly=false): Promise<DocumentSummary|null> {
  const row = await get<DocRow>(DOC_SELECT+" WHERE d.id=?"+(publicOnly ? " AND d.status='aprobado'" : ""),id);
  return row ? (await mapDocs([row]))[0] : null;
}
export async function getDocumentChunks(id:number): Promise<{id:number;heading:string;content:string}[]> {
  const viewer = await readViewer(id);
  const chunks = await all<{id:number;ord:number;heading:string;content:string|null}>("SELECT id,ord,heading,content FROM chunks WHERE document_id=? ORDER BY ord",id);
  if (!viewer) return chunks.map(c=>({id:c.id,heading:c.heading,content:c.content||""}));
  const ids = new Map(chunks.map(c=>[c.ord,c.id]));
  return viewer.chunks.map(c=>({id:ids.get(c.ord) ?? -(c.ord+1),heading:c.heading,content:c.content}));
}
export async function getDocumentFile(id:number) {
  const row = await get<{file_path:string;file_name:string;mime:string}>("SELECT file_path,file_name,mime FROM documents WHERE id=?",id);
  return row?.file_path ? {path:row.file_path,fileName:row.file_name,mime:row.mime} : null;
}
export async function listFacets(publicOnly:boolean) {
  const where = publicOnly ? "WHERE status='aprobado'" : "";
  const entities = await all<{v:string}>(`SELECT DISTINCT entity AS v FROM documents ${where} ORDER BY v`);
  const docTypes = await all<{v:string}>(`SELECT DISTINCT doc_type AS v FROM documents ${where} ORDER BY v`);
  return {entities:entities.map(e=>e.v).filter(Boolean),docTypes:docTypes.map(e=>e.v).filter(Boolean)};
}
export async function getStats() {
  const s = (await get<{approved:number;total:number;pending:number}>("SELECT count(*) FILTER(WHERE status='aprobado')::int AS approved,count(*)::int AS total,count(*) FILTER(WHERE status!='aprobado')::int AS pending FROM documents"))!;
  const chunks = (await get<{n:number}>("SELECT count(*)::int n FROM chunks c JOIN documents d ON d.id=c.document_id WHERE d.status='aprobado'"))!;
  const cats = (await get<{n:number}>("SELECT count(*)::int n FROM categories WHERE parent_id IS NULL"))!;
  return {...s,chunks:chunks.n,categories:cats.n};
}
export async function listCategories(publicOnly=false):Promise<Category[]> {
  const rows = await all<{id:number;parent_id:number|null;name:string;slug:string;description:string;keywords:string;sort:number}>("SELECT * FROM categories ORDER BY parent_id IS NOT NULL,sort,name");
  const links = await all<{document_id:number;category_id:number}>(`SELECT dc.document_id,dc.category_id FROM document_categories dc JOIN documents d ON d.id=dc.document_id ${publicOnly ? "WHERE d.status='aprobado'" : ""}`);
  const sets = new Map<number,Set<number>>(); const parentOf = new Map(rows.map(r=>[r.id,r.parent_id]));
  for (const l of links) for (const id of [l.category_id,parentOf.get(l.category_id)]) {
    if (!id) continue;
    if (!sets.has(id)) sets.set(id,new Set()); sets.get(id)!.add(l.document_id);
  }
  return rows.map(r=>({id:r.id,parentId:r.parent_id,name:r.name,slug:r.slug,description:r.description,keywords:r.keywords,sort:r.sort,docCount:sets.get(r.id)?.size||0}));
}
export async function categoryTree(publicOnly=false):Promise<CategoryNode[]> {
  const cats = await listCategories(publicOnly);
  return cats.filter(c=>c.parentId===null).map(c=>({...c,children:cats.filter(s=>s.parentId===c.id)}));
}
export async function createCategory(input:{name:string;parentId?:number|null;description?:string;keywords?:string}):Promise<Category> {
  const name = input.name.trim(); if (!name) throw new Error("El nombre de la categoría es obligatorio.");
  const parentId = input.parentId || null;
  if (parentId) {
    const parent = await get<{parent_id:number|null}>("SELECT parent_id FROM categories WHERE id=?",parentId);
    if (!parent) throw new Error("La categoría principal no existe.");
    if (parent.parent_id) throw new Error("Solo se admiten dos niveles: categoría y subcategoría.");
  }
  const base = (parentId ? parentId+"--" : "")+(slugify(name)||"categoria");
  let slug = base; let n=1;
  while (await get("SELECT 1 FROM categories WHERE slug=?",slug)) slug=base+"-"+(++n);
  const max = await get<{m:number|null}>("SELECT max(sort) m FROM categories WHERE parent_id IS NOT DISTINCT FROM ?",parentId);
  const r = await run("INSERT INTO categories(parent_id,name,slug,description,keywords,sort) VALUES(?,?,?,?,?,?) RETURNING id",parentId,name,slug,input.description?.trim()||"",input.keywords?.trim()||"",(max?.m||0)+1);
  return (await listCategories()).find(c=>c.id===r.lastInsertRowid)!;
}
export async function updateCategory(id:number,patch:{name?:string;description?:string;keywords?:string}):Promise<Category|null> {
  const cur = await get<{name:string;description:string;keywords:string}>("SELECT name,description,keywords FROM categories WHERE id=?",id);
  if (!cur) return null;
  await run("UPDATE categories SET name=?,description=?,keywords=? WHERE id=?",patch.name?.trim()||cur.name,patch.description?.trim()??cur.description,patch.keywords?.trim()??cur.keywords,id);
  return (await listCategories()).find(c=>c.id===id)||null;
}
export async function deleteCategory(id:number):Promise<boolean> {
  return (await run("DELETE FROM categories WHERE id=? RETURNING id",id)).changes>0;
}
export type DocumentMeta = {title?:string;entity?:string;docType?:string;docDate?:string;officialUrl?:string;summary?:string;status?:DocStatus;reviewNote?:string;categoryIds?:number[];weight?:number};
export type CreateResult = {document:DocumentSummary;duplicate:boolean;warning?:string};
function guessMeta(title: string, text: string, url: string): Required<Pick<DocumentMeta, "title" | "entity" | "docType" | "docDate">> {
  const head = `${title}\n${text.slice(0, 1500)}`;
  let docType = "Otro";
  let entity = "";
  let docDate = "";
  let host = "";
  try {
    host = url ? new URL(url).hostname : "";
  } catch {
    /* sin URL */
  }
  const sent = /\b(?:Sentencia\s+)?(SU|T|C)[-\s]?(\d{1,4})(?:\/|\s+de\s+)(\d{2,4})\b/i.exec(head);
  const auto = /\bAuto\s+(?:No\.\s*)?(\d{1,4})(?:\/|\s+de\s+)(\d{2,4})\b/i.exec(head);
  const ley = /\bLEY\s+(?:ESTATUTARIA\s+)?(\d{1,4})\s+DE\s+(\d{4})\b/i.exec(head);
  const dec = /\bDECRETO\s+(?:LEY\s+|[ÚU]NICO\s+REGLAMENTARIO\s+)?(\d{1,4})\s+DE\s+(\d{4})\b/i.exec(head);
  const year = (y: string) => (y.length === 2 ? (Number(y) > 80 ? "19" : "20") + y : y);

  if (/constituci[óo]n pol[íi]tica/i.test(title)) {
    docType = "Constitución";
    entity = "Asamblea Nacional Constituyente";
    docDate = "1991";
  } else if (host.includes("corteconstitucional") && sent) {
    docType = "Sentencia";
    entity = "Corte Constitucional";
    docDate = year(sent[3]);
  } else if (host.includes("corteconstitucional") && auto) {
    docType = "Auto";
    entity = "Corte Constitucional";
    docDate = year(auto[2]);
  } else if (ley && (!dec || ley.index <= dec.index)) {
    docType = "Ley";
    entity = "Congreso de la República";
    docDate = ley[2];
  } else if (dec) {
    docType = "Decreto";
    entity = "Presidencia de la República";
    docDate = dec[2];
  } else if (sent && /corte constitucional/i.test(head)) {
    docType = "Sentencia";
    entity = "Corte Constitucional";
    docDate = year(sent[3]);
  }
  return { title, entity, docType, docDate };
}


type SelectedChunk = {ord:number;heading:string;section:string;content:string;content_hash:string;indexed:number};
async function indexDocument(id:number,title:string,text:string,weight:number) {
  const bulk = weight<1;
  const chunks = selectChunks(fragmentDocument(text,bulk),id,bulk) as SelectedChunk[];
  await run("DELETE FROM chunks WHERE document_id=?",id);
  for (const c of chunks.filter(c=>c.indexed)) {
    // Misma exclusión de duplicados globales masivos que fase 1.
    if (bulk && await get("SELECT 1 FROM chunks WHERE content_hash=? LIMIT 1",c.content_hash)) continue;
    await run("INSERT INTO chunks(document_id,ord,heading,section,content,content_hash) VALUES(?,?,?,?,?,?)",
      id,c.ord,c.heading,c.section,bulk ? null : c.content,c.content_hash);
  }
  await saveViewer({id,title,chunks:chunks.map(({ord,heading,content})=>({ord,heading,content}))});
}
async function setCategories(id:number,categoryIds:number[]) {
  await run("DELETE FROM document_categories WHERE document_id=?",id);
  for (const cid of new Set(categoryIds)) {
    if (await get("SELECT 1 FROM categories WHERE id=?",cid)) await run("INSERT INTO document_categories(document_id,category_id) VALUES(?,?) ON CONFLICT DO NOTHING",id,cid);
  }
}
export async function assignSubcategories(id:number):Promise<number> {
  const doc = await get<{title:string;summary:string;doc_type:string}>("SELECT title,summary,doc_type FROM documents WHERE id=?",id);
  if (!doc) return 0;
  const words = (s:string) => " "+fold(s).replace(/[^a-z0-9]+/g," ").trim()+" ";
  const head = words(doc.title+" "+doc.summary);
  const body = words((await all<{content:string|null}>("SELECT content FROM chunks WHERE document_id=? ORDER BY ord LIMIT 15",id)).map(c=>c.content||"").join(" "));
  const cats = await all<{id:number;parent_id:number|null;name:string;keywords:string}>("SELECT id,parent_id,name,keywords FROM categories");
  const current = new Set((await all<{category_id:number}>("SELECT category_id FROM document_categories WHERE document_id=?",id)).map(r=>r.category_id));
  const parentOf = new Map(cats.map(c=>[c.id,c.parent_id??c.id]));
  const myRoots = new Set([...current].map(c=>parentOf.get(c)));
  const add:number[]=[];
  for (const c of cats) {
    if (c.parent_id===null || current.has(c.id)) continue;
    const kws = c.keywords.split(",").map(k=>words(k).trim()).filter(Boolean).map(k=>" "+k+" ");
    let match = false;
    if (kws.length) match = kws.some(k=>head.includes(k)) || (myRoots.has(c.parent_id) && kws.reduce((n,k)=>n+body.split(k).length-1,0)>=2);
    else if (doc.doc_type==="Sentencia" || doc.doc_type==="Auto") {
      match = (/unificaci/i.test(c.name)&&/\bSU[-.\s]?\d/i.test(doc.title)) ||
        (/tutela \(T\)/.test(c.name)&&/\bT[-\s]\d/.test(doc.title)) ||
        (/constitucionalidad \(C\)/.test(c.name)&&/\bC[-\s]\d/.test(doc.title)) || (/^Autos/.test(c.name)&&doc.doc_type==="Auto");
    }
    if (match) add.push(c.id);
  }
  for (const cid of add) await run("INSERT INTO document_categories(document_id,category_id) VALUES(?,?) ON CONFLICT DO NOTHING",id,cid);
  return add.length;
}
const MIME:Record<string,string> = {pdf:"application/pdf",docx:"application/vnd.openxmlformats-officedocument.wordprocessingml.document",html:"text/html; charset=utf-8",txt:"text/plain; charset=utf-8"};
async function storeFile(buffer:Buffer,hash:string,fileName:string,contentType:string) {
  const stored = hash+(path.extname(fileName)||".bin").toLowerCase();
  await storage().put("documentos",stored,buffer,contentType,{skipUnchanged:true});
  return stored;
}
export async function createDocument(input:{buffer:Buffer;fileName:string;mime?:string;sourceKind:"upload"|"url";charsetHint?:string;meta?:DocumentMeta}):Promise<CreateResult> {
  const kind = detectKind(input.fileName,input.mime||"");
  if (!kind) throw new Error(`Formato no admitido: ${input.fileName}. Usa PDF o DOCX.`);
  const hash = crypto.createHash("sha256").update(input.buffer).digest("hex"); const meta=input.meta||{};
  const dupe = await get<{id:number}>("SELECT id FROM documents WHERE content_hash=?",hash) ||
    (meta.officialUrl ? await get<{id:number}>("SELECT id FROM documents WHERE official_url=?",meta.officialUrl) : undefined);
  if (dupe) return {document:(await getDocument(dupe.id))!,duplicate:true};
  const buffer = kind==="html" ? toUtf8Html(input.buffer,input.charsetHint) : input.buffer;
  let extracted;
  try {extracted=await extractText(buffer,kind);} catch {throw new Error(`No se pudo leer ${input.fileName}. El archivo puede estar dañado o protegido.`);}
  const baseTitle=meta.title?.trim()||extracted.title||path.basename(input.fileName,path.extname(input.fileName)).replace(/[_-]+/g," ");
  const guess=guessMeta(baseTitle,extracted.text,meta.officialUrl||""); const title=guess.title.slice(0,300);
  const warning=extracted.text.length<200 ? "No se encontró texto legible. Si es un PDF escaneado, necesita reconocimiento de texto (OCR) antes de poder consultarse." : undefined;
  const stored=await storeFile(buffer,hash,input.fileName,MIME[kind]);
  const status:DocStatus=warning ? "borrador" : meta.status&&STATUSES.includes(meta.status) ? meta.status : "revision";
  const weight = meta.weight && meta.weight>0 ? meta.weight : 1;
  const id = await tx(async () => {
    const r=await run(`INSERT INTO documents(title,entity,doc_type,doc_date,official_url,summary,status,file_name,file_path,mime,file_size,source_kind,content_hash,text_chars,review_note,weight)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING id`,title,meta.entity?.trim()||guess.entity,meta.docType?.trim()||guess.docType,meta.docDate?.trim()||guess.docDate,
      meta.officialUrl?.trim()||"",meta.summary?.trim()||"",status,input.fileName,stored,MIME[kind],buffer.length,input.sourceKind,hash,extracted.text.length,meta.reviewNote?.trim()||warning||"",weight);
    const docId=r.lastInsertRowid!;
    await indexDocument(docId,title,extracted.text,weight);
    const cats=meta.categoryIds?.length ? meta.categoryIds : (await detectTopics(title+" "+extracted.text.slice(0,4000),2)).map(t=>t.id);
    await setCategories(docId,cats); await assignSubcategories(docId); return docId;
  });
  return {document:(await getDocument(id))!,duplicate:false,warning};
}
export async function importFromUrl(url:string,meta:DocumentMeta={}):Promise<CreateResult> {
  const existing=await get<{id:number}>("SELECT id FROM documents WHERE official_url=?",url.trim());
  if (existing) return {document:(await getDocument(existing.id))!,duplicate:true};
  const f=await fetchOfficial(url);
  return createDocument({buffer:f.buffer,fileName:f.fileName,mime:f.contentType,charsetHint:f.contentType,sourceKind:"url",meta:{...meta,officialUrl:meta.officialUrl||url.trim()}});
}
export async function updateDocument(id:number,patch:DocumentMeta):Promise<DocumentSummary|null> {
  const cur=await getDocument(id); if (!cur) return null;
  if (patch.status&&!STATUSES.includes(patch.status)) throw new Error("Estado no válido.");
  if (patch.status==="aprobado"&&cur.chunkCount===0) throw new Error("No se puede aprobar un documento sin texto indexado.");
  await tx(async () => {
    await run(`UPDATE documents SET title=?,entity=?,doc_type=?,doc_date=?,official_url=?,summary=?,status=?,review_note=?,updated_at=CURRENT_TIMESTAMP::text WHERE id=?`,
      patch.title?.trim()||cur.title,patch.entity?.trim()??cur.entity,patch.docType?.trim()||cur.docType,patch.docDate?.trim()??cur.docDate,patch.officialUrl?.trim()??cur.officialUrl,
      patch.summary?.trim()??cur.summary,patch.status||cur.status,patch.reviewNote?.trim()??cur.reviewNote,id);
    if (patch.categoryIds) await setCategories(id,patch.categoryIds);
  });
  return getDocument(id);
}
async function removeUnusedOriginal(name:string) {
  if (name && !await get("SELECT 1 FROM documents WHERE file_path=? LIMIT 1",name)) await storage().remove("documentos",name);
}
export async function replaceDocumentFile(id:number,input:{buffer:Buffer;fileName:string;mime?:string}):Promise<CreateResult|null> {
  const cur=await get<{title:string;file_path:string;weight:number}>("SELECT title,file_path,weight FROM documents WHERE id=?",id);
  if (!cur) return null;
  const kind=detectKind(input.fileName,input.mime||""); if (!kind) throw new Error("Formato no admitido: usa PDF o DOCX.");
  const hash=crypto.createHash("sha256").update(input.buffer).digest("hex");
  if (await get("SELECT id FROM documents WHERE content_hash=? AND id!=?",hash,id)) throw new Error("Ese archivo ya existe en la biblioteca como otro documento.");
  const buffer=kind==="html" ? toUtf8Html(input.buffer) : input.buffer;
  const extracted=await extractText(buffer,kind); const stored=await storeFile(buffer,hash,input.fileName,MIME[kind]);
  await tx(async () => {
    await run("UPDATE documents SET file_name=?,file_path=?,mime=?,file_size=?,content_hash=?,text_chars=?,status='revision',updated_at=CURRENT_TIMESTAMP::text WHERE id=?",
      input.fileName,stored,MIME[kind],buffer.length,hash,extracted.text.length,id);
    await indexDocument(id,cur.title,extracted.text,cur.weight);
  });
  if (cur.file_path!==stored) await removeUnusedOriginal(cur.file_path);
  return {document:(await getDocument(id))!,duplicate:false};
}
export async function reindexDocument(id:number):Promise<DocumentSummary|null> {
  const cur=await get<{title:string;file_name:string;mime:string;weight:number}>("SELECT title,file_name,mime,weight FROM documents WHERE id=?",id);
  const file=await getDocumentFile(id); if (!cur||!file) return null;
  const kind=detectKind(cur.file_name,cur.mime); if (!kind) return null;
  const buffer=await storage().get("documentos",file.path); if (!buffer) return null;
  const extracted=await extractText(buffer,kind);
  await tx(async () => {
    await indexDocument(id,cur.title,extracted.text,cur.weight);
    await run("UPDATE documents SET text_chars=?,updated_at=CURRENT_TIMESTAMP::text WHERE id=?",extracted.text.length,id);
  });
  return getDocument(id);
}
export async function deleteDocument(id:number):Promise<boolean> {
  const cur=await get<{file_path:string}>("SELECT file_path FROM documents WHERE id=?",id); if (!cur) return false;
  await run("DELETE FROM documents WHERE id=?",id);
  await removeUnusedOriginal(cur.file_path); await storage().remove("textos",id+".json.gz"); invalidateViewer(id);
  return true;
}
