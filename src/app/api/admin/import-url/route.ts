import { importFromUrl } from "@/lib/documents";
import { adminRoute, body, categoryIds, json, RequestError, validationError } from "../_utils";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return adminRoute(async () => {
    const input = await body(request);
    if (typeof input.url !== "string" || !input.url.trim()) throw new RequestError("Escribe la dirección oficial que quieres importar.");
    const ids = categoryIds(input.categoryIds);
    try { return json(await importFromUrl(input.url, { categoryIds: ids })); }
    catch (error) { validationError(error, "No pudimos importar el documento desde esta dirección."); }
  });
}
