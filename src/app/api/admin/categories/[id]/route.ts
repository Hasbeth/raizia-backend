import { deleteCategory, updateCategory } from "@/lib/documents";
import { adminRoute, body, categoryPatch, json, positiveId, RequestError, validationError } from "../../_utils";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Context) {
  return adminRoute(async () => {
    const id = positiveId((await params).id);
    const patch = categoryPatch(await body(request));
    let category;
    try { category = updateCategory(id, patch); }
    catch (error) { validationError(error, "No pudimos actualizar la categoría."); }
    if (!category) throw new RequestError("No encontramos esta categoría.", 404);
    return json({ category });
  });
}

export async function DELETE(_request: Request, { params }: Context) {
  return adminRoute(async () => {
    if (!deleteCategory(positiveId((await params).id))) throw new RequestError("No encontramos esta categoría.", 404);
    return json({ ok: true });
  });
}
