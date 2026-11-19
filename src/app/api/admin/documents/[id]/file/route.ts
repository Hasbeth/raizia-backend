import { getDocument, replaceDocumentFile } from "@/lib/documents";
import { adminRoute, fileMime, json, multipart, positiveId, RequestError } from "../../../_utils";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return adminRoute(async () => {
    const id = positiveId((await params).id);
    if (!getDocument(id)) throw new RequestError("No encontramos este documento.", 404);
    const form = await multipart(request);
    const file = form.get("file");
    if (!(file instanceof File)) throw new RequestError("Selecciona un archivo PDF o DOCX para reemplazar el original.");
    const mime = fileMime(file);
    let result;
    try { result = await replaceDocumentFile(id, { buffer: Buffer.from(await file.arrayBuffer()), fileName: file.name, mime }); }
    catch (error) {
      throw new RequestError(error instanceof Error && error.message.startsWith("Ese archivo ya existe") ? error.message : "No pudimos leer o reemplazar el archivo. Comprueba que no esté dañado ni protegido.");
    }
    if (!result) throw new RequestError("No encontramos este documento.", 404);
    return json(result);
  });
}
