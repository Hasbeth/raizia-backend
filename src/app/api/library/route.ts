import { categoryTree, getStats, listDocuments, listFacets } from "@/lib/documents";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const docs = listDocuments({
    publicOnly: true,
    q: params.get("q") ?? undefined,
    categoryId: Number(params.get("categoria")) || undefined,
    docType: params.get("tipo") ?? undefined,
    entity: params.get("entidad") ?? undefined,
  });
  const size = Math.min(100, Math.max(1, Math.floor(Number(params.get("tamano")) || 25)));
  const pages = Math.max(1, Math.ceil(docs.length / size));
  const page = Math.min(pages, Math.max(1, Number(params.get("pagina")) || 1));

  return Response.json({
    documents: docs.slice((page - 1) * size, page * size),
    total: docs.length,
    page,
    pages,
    approved: getStats().approved,
    facets: listFacets(true),
    categories: categoryTree(true),
  }, { headers: { "Cache-Control": "no-store" } });
}
