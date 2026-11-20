import { storage } from "@/lib/storage";
import { get } from "@/lib/db";
import { createDocument } from "@/lib/documents";
import { adminRoute,body,categoryIds,fileMime,json,RequestError,validationError } from "../../_utils";
export const dynamic="force-dynamic";
export const runtime="nodejs";
export const maxDuration=300;
export async function POST(request:Request) {
  return adminRoute(async()=>{
    const input=await body(request);
    const name=typeof input.path==="string"?input.path:"";
    if (!/^uploads\/[a-f0-9-]+\.(pdf|docx)$/.test(name) || typeof input.fileName!=="string") throw new RequestError("La ruta de subida no es válida.");
    if (!await get("SELECT 1 FROM storage_objects WHERE bucket='documentos' AND path=?",name)) throw new RequestError("La subida no existe o ya fue procesada.",404);
    const ids=categoryIds(input.categoryIds);
    const buffer=await storage().get("documentos",name);
    if (!buffer) throw new RequestError("No encontramos el archivo subido.",404);
    const mime=fileMime({name:input.fileName,size:buffer.length,type:""} as File);
    let result;
    try {
      result=await createDocument({buffer,fileName:input.fileName,mime,sourceKind:"upload",meta:{categoryIds:ids,status:input.publicar===true||input.publicar==="si"?"aprobado":"revision"}});
    } catch(error) { validationError(error,"No pudimos leer el archivo."); }
    await storage().remove("documentos",name);
    return json(result);
  });
}
