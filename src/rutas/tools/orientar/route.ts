import { askGeminiJSON, retrieve } from "@/lib/rag";
import { checkChatLimit, CHAT_LIMIT_MESSAGE } from "@/lib/rate-limit";
import { explicitDanger, fallbackOrientation, orientWithLibrary } from "@/lib/orientation";
import type { QueryTurn } from "@/lib/reformulation";
export const dynamic = "force-dynamic";
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if ((!explicitDanger(text) && text.length < 12) || text.length > 8000) return Response.json({ error: "Escribe un relato de entre 12 y 8000 caracteres." }, { status: 400 });
  const current = typeof body?.current === "string" ? body.current : "";
  const limit = await checkChatLimit(req);
  if (!limit.allowed) return Response.json({ ...fallbackOrientation(text), limitNotice: CHAT_LIMIT_MESSAGE }, {
    headers: { "Retry-After": String(limit.retryAfter), "Cache-Control": "no-store" },
  });
  const clip = (v: unknown) => typeof v === "string" ? v.trim().slice(0, 80) : "";
  const profile = { group: clip(body?.profile?.group), community: clip(body?.profile?.community), territory: clip(body?.profile?.territory) };
  const history: QueryTurn[] = (Array.isArray(body?.history) ? body.history : []).filter((t: QueryTurn) => t?.role === "user" && typeof t.content === "string").slice(-4).map((t: QueryTurn) => ({ ...t, content: t.content.slice(0, 1500) }));
  const result = await orientWithLibrary({ text, current, profile, history }, {
    retrieve: signal => retrieve(text, "", profile, history, { signal, reformulate: async () => null }), ask: (system, user, signal, schema) => askGeminiJSON(system, user, signal, schema, body?.background === true ? "background" : "foreground"), signal: req.signal,
  });
  return Response.json(result, { headers: { "Cache-Control": "no-store" } });
}
