import { categoryTree, createCategory } from "@/lib/documents";
import { adminRoute, body, categoryPatch, json, positiveId, RequestError, validationError } from "../_utils";
export const dynamic = "force-dynamic";
export async function GET() {
    return adminRoute(async () => json({ categories: await categoryTree(false) }));
}
export async function POST(request: Request) {
    return adminRoute(async () => {
        const input = await body(request);
        const patch = categoryPatch(input);
        if (!patch.name)
            throw new RequestError("Escribe un nombre para la categoría.");
        if (input.parentId !== undefined && input.parentId !== null && typeof input.parentId !== "number")
            throw new RequestError("La categoría principal no es válida.");
        const parentId = typeof input.parentId === "number" ? positiveId(input.parentId) : undefined;
        try {
            return json({ category: await createCategory({ ...patch, name: patch.name, parentId }) }, 201);
        }
        catch (error) {
            validationError(error, "No pudimos crear la categoría.");
        }
    });
}
