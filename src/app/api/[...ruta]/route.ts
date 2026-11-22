// Generado: una sola función serverless para todas las rutas /api (límite de 12 funciones en Vercel Hobby).
// Los handlers viven en src/rutas con la misma estructura de carpetas que tenían en src/app/api.
import * as r4 from "@/rutas/admin/documents/[id]/file/route";
import * as r5 from "@/rutas/admin/documents/[id]/reindex/route";
import * as r2 from "@/rutas/admin/documents/ingest/route";
import * as r7 from "@/rutas/admin/embeddings/pendientes/route";
import * as r1 from "@/rutas/admin/categories/[id]/route";
import * as r6 from "@/rutas/admin/documents/[id]/route";
import * as r15 from "@/rutas/documents/[id]/file/route";
import * as r0 from "@/rutas/admin/categories/route";
import * as r3 from "@/rutas/admin/documents/route";
import * as r8 from "@/rutas/admin/espacio/route";
import * as r9 from "@/rutas/admin/import-url/route";
import * as r10 from "@/rutas/admin/login/route";
import * as r11 from "@/rutas/admin/logout/route";
import * as r12 from "@/rutas/admin/session/route";
import * as r13 from "@/rutas/admin/uploads/route";
import * as r21 from "@/rutas/tools/organizar/route";
import * as r22 from "@/rutas/tools/orientar/route";
import * as conversar from "@/rutas/tools/conversar/route";
import * as r16 from "@/rutas/documents/[id]/route";
import * as r23 from "@/rutas/tools/[kind]/route";
import * as r14 from "@/rutas/chat/route";
import * as r17 from "@/rutas/home/route";
import * as r18 from "@/rutas/library/route";
import * as r19 from "@/rutas/seed/route";
import * as r20 from "@/rutas/status/route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

type Handler = (request: Request, context: { params: Promise<Record<string, string>> }) => Response | Promise<Response>;
type Entry = { segments: string[]; module: Record<string, unknown> };
const routes: Entry[] = [
  { segments: ["admin","documents","[id]","file"], module: r4 },
  { segments: ["admin","documents","[id]","reindex"], module: r5 },
  { segments: ["admin","documents","ingest"], module: r2 },
  { segments: ["admin","embeddings","pendientes"], module: r7 },
  { segments: ["admin","categories","[id]"], module: r1 },
  { segments: ["admin","documents","[id]"], module: r6 },
  { segments: ["documents","[id]","file"], module: r15 },
  { segments: ["admin","categories"], module: r0 },
  { segments: ["admin","documents"], module: r3 },
  { segments: ["admin","espacio"], module: r8 },
  { segments: ["admin","import-url"], module: r9 },
  { segments: ["admin","login"], module: r10 },
  { segments: ["admin","logout"], module: r11 },
  { segments: ["admin","session"], module: r12 },
  { segments: ["admin","uploads"], module: r13 },
  { segments: ["tools","organizar"], module: r21 },
  { segments: ["tools","orientar"], module: r22 },
  { segments: ["tools","conversar"], module: conversar },
  { segments: ["documents","[id]"], module: r16 },
  { segments: ["tools","[kind]"], module: r23 },
  { segments: ["chat"], module: r14 },
  { segments: ["home"], module: r17 },
  { segments: ["library"], module: r18 },
  { segments: ["seed"], module: r19 },
  { segments: ["status"], module: r20 },
];

function match(path: string[]): { entry: Entry; params: Record<string, string> } | null {
  for (const entry of routes) {
    if (entry.segments.length !== path.length) continue;
    const params: Record<string, string> = {};
    let ok = true;
    entry.segments.forEach((segment, i) => {
      if (segment.startsWith("[")) params[segment.slice(1, -1)] = decodeURIComponent(path[i]);
      else if (segment !== path[i]) ok = false;
    });
    if (ok) return { entry, params };
  }
  return null;
}

async function dispatch(method: string, request: Request, context: { params: Promise<{ ruta?: string[] }> }) {
  const found = match((await context.params).ruta ?? []);
  if (!found) return Response.json({ error: "Ruta no encontrada." }, { status: 404 });
  const handler = found.entry.module[method] as Handler | undefined;
  if (!handler) return Response.json({ error: "Método no permitido." }, { status: 405 });
  return handler(request, { params: Promise.resolve(found.params) });
}

type Ctx = { params: Promise<{ ruta?: string[] }> };
export const GET = (request: Request, context: Ctx) => dispatch("GET", request, context);
export const POST = (request: Request, context: Ctx) => dispatch("POST", request, context);
export const PUT = (request: Request, context: Ctx) => dispatch("PUT", request, context);
export const PATCH = (request: Request, context: Ctx) => dispatch("PATCH", request, context);
export const DELETE = (request: Request, context: Ctx) => dispatch("DELETE", request, context);
