import { categoryTree, getStats } from "@/lib/documents";

export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ stats: getStats(), categories: categoryTree(true) }, {
    headers: { "Cache-Control": "no-store" },
  });
}
