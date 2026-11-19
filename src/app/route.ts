export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({
    name: "RAIZIA · API",
    endpoints: [
      "GET /api/home",
      "GET /api/library",
      "GET /api/documents/[id]",
      "GET /api/documents/[id]/file",
      "GET /api/status",
      "POST /api/chat",
      "POST /api/tools/orientar",
      "POST /api/tools/organizar",
      "POST /api/tools/[kind]",
      "GET /api/admin/session",
      "POST /api/admin/login",
      "POST /api/admin/logout",
      "GET, POST /api/admin/documents",
      "GET, PATCH, DELETE /api/admin/documents/[id]",
      "POST /api/admin/documents/[id]/file",
      "POST /api/admin/documents/[id]/reindex",
      "POST /api/admin/import-url",
      "GET, POST /api/admin/categories",
      "PATCH, DELETE /api/admin/categories/[id]",
      "POST /api/seed",
    ],
  }, { headers: { "Cache-Control": "no-store" } });
}
