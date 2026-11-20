import { createDocument, getStats, listDocuments, listFacets, type CreateResult } from "@/lib/documents";
import { STATUSES, type DocStatus } from "@/lib/constants";
import { adminRoute, fileMime, formCategoryIds, json, multipart, positiveId, RequestError } from "../_utils";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
    return adminRoute(async () => {
        const query = new URL(request.url).searchParams;
        const status = query.get("status") || undefined;
        if (status && !STATUSES.some((item) => item === status))
            throw new RequestError("El filtro de estado no es válido.");
        return json({
            documents: await listDocuments({
                q: query.get("q") || undefined,
                status: status as DocStatus | undefined,
                categoryId: query.get("categoryId") ? positiveId(query.get("categoryId")!) : undefined,
                docType: query.get("docType") || undefined,
            }),
            stats: await getStats(),
            facets: await listFacets(false),
        });
    });
}
export async function POST(request: Request) {
    return adminRoute(async () => {
        const form = await multipart(request);
        const ids = formCategoryIds(form.get("categoryIds"));
        const publish = form.get("publicar") === "si";
        const files = [...form.values()].filter((entry): entry is File => entry instanceof File);
        if (!files.length)
            throw new RequestError("Selecciona al menos un archivo PDF o DOCX.");
        const results: ({
            fileName: string;
            ok: boolean;
            error?: string;
        } & Partial<CreateResult>)[] = [];
        for (const file of files) {
            try {
                const mime = fileMime(file);
                const result = await createDocument({ buffer: Buffer.from(await file.arrayBuffer()), fileName: file.name, mime, sourceKind: "upload", meta: { categoryIds: ids, status: publish ? "aprobado" : "revision" } });
                results.push({ fileName: file.name, ok: true, ...result });
            }
            catch (error) {
                // Repository ingestion errors describe unreadable files without exposing a stack.
                const message = error instanceof RequestError || (error instanceof Error && /^(No se pudo leer|Formato no admitido)/.test(error.message))
                    ? error.message : "No pudimos guardar este archivo. Verifica que sea un PDF o DOCX legible e intenta de nuevo.";
                results.push({ fileName: file.name, ok: false, error: message });
            }
        }
        return json({ results });
    });
}
