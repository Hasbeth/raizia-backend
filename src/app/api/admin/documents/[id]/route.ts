import { deleteDocument, getDocument, getDocumentChunks, updateDocument } from "@/lib/documents";
import { adminRoute, body, documentMeta, json, positiveId, RequestError, validationError } from "../../_utils";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Context) {
  return adminRoute(async () => {
    const id = positiveId((await params).id);
    const document = getDocument(id);
    if (!document) throw new RequestError("No encontramos este documento.", 404);
    const chunks = getDocumentChunks(id);
    return json({ document, chunks: chunks.slice(0, 12), totalChunks: chunks.length });
  });
}

export async function PATCH(request: Request, { params }: Context) {
  return adminRoute(async () => {
    const id = positiveId((await params).id);
    const patch = documentMeta(await body(request));
    let document;
    try { document = updateDocument(id, patch); }
    catch (error) { validationError(error, "No pudimos actualizar el documento."); }
    if (!document) throw new RequestError("No encontramos este documento.", 404);
    return json({ document });
  });
}

export async function DELETE(_request: Request, { params }: Context) {
  return adminRoute(async () => {
    if (!deleteDocument(positiveId((await params).id))) throw new RequestError("No encontramos este documento.", 404);
    return json({ ok: true });
  });
}
