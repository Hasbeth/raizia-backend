import { getDocument, getDocumentChunks } from "@/lib/documents";
export const dynamic = "force-dynamic";
export async function GET(_request: Request, { params }: {
    params: Promise<{
        id: string;
    }>;
}) {
    const { id } = await params;
    const docId = Number(id);
    const document = Number.isInteger(docId) && docId > 0 ? await getDocument(docId, true) : null;
    const headers = { "Cache-Control": "no-store" };
    if (!document)
        return Response.json({ error: "Documento no encontrado." }, { status: 404, headers });
    return Response.json({ document, chunks: await getDocumentChunks(docId) }, { headers });
}
