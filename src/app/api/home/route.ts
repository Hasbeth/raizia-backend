import { categoryTree, getStats } from "@/lib/documents";
export const dynamic = "force-dynamic";
export async function GET() {
    return Response.json({ stats: await getStats(), categories: await categoryTree(true) }, {
        headers: { "Cache-Control": "no-store" },
    });
}
