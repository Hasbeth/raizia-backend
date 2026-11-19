import { isAdmin } from "@/lib/auth";
import { DOC_TYPES, STATUSES, type DocStatus } from "@/lib/constants";
import type { DocumentMeta } from "@/lib/documents";

export class RequestError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

export function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { "Cache-Control": "private, no-store" } });
}

export function failure(error: unknown, fallback: string) {
  return json({ error: error instanceof RequestError ? error.message : fallback }, error instanceof RequestError ? error.status : 500);
}

/** Authentication stays ahead of parsing bodies or accessing the repository. */
export async function adminRoute(action: () => Response | Promise<Response>) {
  try {
    if (!(await isAdmin())) return json({ error: "Tu sesión terminó. Vuelve a iniciar sesión." }, 401);
    return await action();
  } catch (error) {
    return failure(error, "No pudimos completar la solicitud. Intenta de nuevo.");
  }
}

export async function body(request: Request): Promise<Record<string, unknown>> {
  try {
    const value: unknown = await request.json();
    if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  } catch { /* handled below */ }
  throw new RequestError("Envía los datos como un objeto JSON válido.");
}

export async function multipart(request: Request) {
  try { return await request.formData(); }
  catch { throw new RequestError("No pudimos leer los archivos. Vuelve a seleccionarlos."); }
}

export function positiveId(value: string | number) {
  if ((typeof value === "string" && !/^\d+$/.test(value)) || !Number.isSafeInteger(Number(value)) || Number(value) < 1) {
    throw new RequestError("El identificador no es válido.");
  }
  return Number(value);
}

export function categoryIds(value: unknown): number[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((id) => typeof id !== "number" || !Number.isSafeInteger(id) || id < 1)) {
    throw new RequestError("Las categorías deben ser una lista de identificadores válidos.");
  }
  return [...new Set(value)] as number[];
}

export function formCategoryIds(value: FormDataEntryValue | null) {
  if (value === null) return undefined;
  if (typeof value !== "string") throw new RequestError("La lista de categorías no es válida.");
  let parsed: unknown;
  try { parsed = JSON.parse(value); }
  catch { throw new RequestError("La lista de categorías debe tener formato JSON."); }
  return categoryIds(parsed);
}

export function strings(input: Record<string, unknown>, keys: readonly string[]) {
  const output: Record<string, string> = {};
  for (const key of keys) {
    if (input[key] === undefined) continue;
    if (typeof input[key] !== "string") throw new RequestError("Los campos de texto deben contener texto válido.");
    output[key] = input[key];
  }
  return output;
}

export function documentMeta(input: Record<string, unknown>): DocumentMeta {
  const patch: DocumentMeta = strings(input, ["title", "entity", "docType", "docDate", "officialUrl", "summary", "reviewNote"]);
  if (patch.title !== undefined && !patch.title.trim()) throw new RequestError("Escribe un título para el documento.");
  if (patch.docType !== undefined && !DOC_TYPES.some((type) => type === patch.docType)) throw new RequestError("Selecciona un tipo de documento válido.");
  if (patch.docDate && !/^\d{4}(?:-\d{2}-\d{2})?$/.test(patch.docDate.trim())) throw new RequestError("Escribe la fecha como AAAA o AAAA-MM-DD.");
  if (patch.officialUrl?.trim()) {
    try {
      const url = new URL(patch.officialUrl);
      if (!["http:", "https:"].includes(url.protocol)) throw new Error();
    } catch { throw new RequestError("El enlace oficial debe ser una dirección http o https válida."); }
  }
  if (input.status !== undefined) {
    if (!STATUSES.some((status) => status === input.status)) throw new RequestError("Selecciona un estado válido.");
    patch.status = input.status as DocStatus;
  }
  if (input.categoryIds !== undefined) patch.categoryIds = categoryIds(input.categoryIds);
  return patch;
}

export function categoryPatch(input: Record<string, unknown>) {
  const patch = strings(input, ["name", "description", "keywords"]);
  if (patch.name !== undefined && !patch.name.trim()) throw new RequestError("Escribe un nombre para la categoría.");
  return patch;
}

export function fileMime(file: File) {
  if (file.size > 30 * 1024 * 1024) throw new RequestError("El archivo supera el límite de 30 MB.", 413);
  if (!file.size) throw new RequestError("El archivo está vacío.");
  const extension = file.name.split(".").pop()?.toLowerCase();
  const mime = extension === "pdf" ? "application/pdf" : extension === "docx" ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document" : null;
  if (!mime) throw new RequestError("Solo se admiten archivos PDF o DOCX.", 415);
  if (file.type && file.type !== "application/octet-stream" && file.type !== mime) {
    throw new RequestError("El formato del archivo no coincide con su extensión. Usa PDF o DOCX.", 415);
  }
  return mime;
}

export function validationError(error: unknown, fallback: string): never {
  throw new RequestError(error instanceof Error ? error.message : fallback);
}
