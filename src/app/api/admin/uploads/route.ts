import { randomUUID } from "node:crypto";
import { storage } from "@/lib/storage";
import { query,get } from "@/lib/db";
import { adminRoute,body,json,RequestError,fileMime } from "../_utils";
export const dynamic="force-dynamic";
export const runtime="nodejs";
export async function POST(request:Request) {
  return adminRoute(async()=>{
    const input=await body(request);
    if (typeof input.fileName!=="string" || typeof input.size!=="number") throw new RequestError("Indica el nombre y tamaño del archivo.");
    fileMime({name:input.fileName,size:input.size,type:typeof input.mime==="string"?input.mime:""} as File);
    const name="uploads/"+randomUUID()+"."+input.fileName.split(".").pop()!.toLowerCase();
    const result=await storage().signedUpload(name);
    await query("INSERT INTO storage_objects(bucket,path,bytes,content_hash) VALUES('documentos',$1,0,'')",[name]);
    return json(result);
  });
}
export async function PUT(request:Request) {
  return adminRoute(async()=>{
    if (storage().remote) throw new RequestError("Sube el archivo directamente a la URL firmada.",400);
    const name=new URL(request.url).searchParams.get("path")||"";
    if (!/^uploads\/[a-f0-9-]+\.(pdf|docx)$/.test(name) || !await get("SELECT 1 FROM storage_objects WHERE bucket='documentos' AND path=?",name)) throw new RequestError("Subida no encontrada.",404);
    const reader=request.body?.getReader(); if (!reader) throw new RequestError("El archivo está vacío.");
    const parts:Uint8Array[]=[]; let bytes=0;
    for (;;) {
      const {done,value}=await reader.read(); if (done) break;
      bytes+=value.byteLength;
      if (bytes>30*1024*1024) { await reader.cancel(); throw new RequestError("El archivo supera el límite de 30 MB.",413); }
      parts.push(value);
    }
    const buffer=Buffer.concat(parts);
    if (!buffer.length) throw new RequestError("El archivo está vacío.");
    await storage().put("documentos",name,buffer);
    return json({ok:true,path:name});
  });
}
