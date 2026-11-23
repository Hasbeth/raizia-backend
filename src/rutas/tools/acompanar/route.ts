import { askGeminiJSON, retrieve } from "@/lib/rag";
import { checkChatLimit, CHAT_LIMIT_MESSAGE } from "@/lib/rate-limit";
import { companionTurn } from "@/lib/companion";
import { parseConversationInput } from "@/lib/tool-conversation";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

/** Conversación libre de «¿No sabes qué mecanismo necesitas?». El relato no se guarda ni se registra. */
export async function POST(req: Request) {
  const raw = await req.json().catch(() => null);
  const input = parseConversationInput({ kind: "tutela", confirmados: {}, preguntados: {}, mensajes: raw?.mensajes });
  if (!input) return Response.json({ error: "Envía hasta 16 mensajes recientes de 2000 caracteres." }, { status: 400, headers });
  const limit = await checkChatLimit(req);
  if (!limit.allowed) return Response.json({ error: CHAT_LIMIT_MESSAGE }, { status: 429, headers: { ...headers, "Retry-After": String(limit.retryAfter) } });
  return Response.json(await companionTurn(input, { libre: true, ask: askGeminiJSON, signal: req.signal,
    retrieve: (text, signal) => retrieve(text, "", undefined, [], { signal, reformulate: async () => null }) }), { headers });
}
