import { isAdmin } from "@/lib/auth";
import { getDocument, getDocumentFile } from "@/lib/documents";
import { storage } from "@/lib/storage";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function GET(req:Request,ctx:{params:Promise<{id:string}>}) {
  const {id}=await ctx.params; const docId=Number(id);
  const admin=await isAdmin();
  const doc=Number.isSafeInteger(docId)&&docId>0 ? await getDocument(docId,!admin) : null;
  const file=doc ? await getDocumentFile(doc.id) : null;
  if (!doc||!file) return new Response("Documento no encontrado",{status:404});
  const download=new URL(req.url).searchParams.has("descargar");
  const html=file.mime.startsWith("text/html");
  if (!html) {
    const signed=await storage().signedDownload(file.path,download);
    if (signed) return new Response(null,{status:302,headers:{Location:signed,"Cache-Control":"private, no-store"}});
  }
  const buffer=await storage().get("documentos",file.path);
  if (!buffer) return new Response("Documento no encontrado",{status:404});
  const headers:Record<string,string>={
    "Content-Type":file.mime||"application/octet-stream",
    "Content-Disposition":`${download ? "attachment" : "inline"}; filename="${file.fileName.replace(/[^\w.\- ]+/g,"_")}"`,
    "X-Content-Type-Options":"nosniff","Cache-Control":"private, no-store",
  };
  if (html) headers["Content-Security-Policy"]="sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:";
  const stream=new ReadableStream<Uint8Array>({start(controller) {
    for (let i=0;i<buffer.length;i+=64*1024) controller.enqueue(new Uint8Array(buffer.subarray(i,i+64*1024)));
    controller.close();
  }});
  return new Response(stream,{headers});
}
