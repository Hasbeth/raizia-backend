import { reindexDocument } from "@/lib/documents";
import { adminRoute, json, positiveId, RequestError } from "../../../_utils";
export const dynamic = "force-dynamic";
export async function POST(_request: Request, { params }: {
    params: Promise<{
        id: string;
    }>;
}) {
    return adminRoute(async () => {
        const id = positiveId((await params).id);
        let document;
        try {
            document = await reindexDocument(id);
        }
        catch {
            throw new RequestError("No pudimos extraer el texto. Intenta reemplazar el archivo por una copia legible.");
        }
        if (!document)
            throw new RequestError("No encontramos el documento o su archivo original.", 404);
        return json({ document });
    });
}
