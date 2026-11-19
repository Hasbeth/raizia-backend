import fs from "node:fs";
import { isAdmin } from "@/lib/auth";
import { getDocument, getDocumentFile } from "@/lib/documents";

export const dynamic = "force-dynamic";

/** Entrega el archivo original. Público solo si el documento está aprobado. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const docId = Number(id);
  const admin = await isAdmin();
  const doc = Number.isInteger(docId) ? getDocument(docId, !admin) : null;
  const file = doc ? getDocumentFile(doc.id) : null;
  if (!doc || !file) return new Response("Documento no encontrado", { status: 404 });

  const download = new URL(req.url).searchParams.has("descargar");
  const safeName = file.fileName.replace(/[^\w.\- ]+/g, "_");
  const headers: Record<string, string> = {
    "Content-Type": file.mime || "application/octet-stream",
    "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${safeName}"`,
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "private, max-age=300",
  };
  // Los HTML importados se muestran aislados: sin scripts ni acceso a la sesión.
  if (file.mime.startsWith("text/html")) {
    headers["Content-Security-Policy"] =
      "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:";
  }
  return new Response(new Uint8Array(fs.readFileSync(file.absPath)), { headers });
}
