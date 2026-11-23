import { assistTool, ASSISTANCE_ACTIONS, type AssistanceAction } from "@/lib/tool-assistance";
import { explicitDanger } from "@/lib/emergency";
import { askGeminiJSON, retrieve } from "@/lib/rag";
import { checkChatLimit, CHAT_LIMIT_MESSAGE } from "@/lib/rate-limit";
import { CONVERSATION_LIMITS, fallbackConversation, parseConversationInput } from "@/lib/tool-conversation";
import { companionTurn } from "@/lib/companion";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

// Lectura acotada incluso sin Content-Length. El cuerpo nunca se persiste ni se registra.
async function readInput(req: Request) {
  const reader = req.body?.getReader();
  if (!reader) return null;
  const decoder = new TextDecoder();
  let text = "", bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > CONVERSATION_LIMITS.body) { await reader.cancel(); return null; }
      text += decoder.decode(value, { stream: true });
    }
    const raw = JSON.parse(text + decoder.decode());
    const input = parseConversationInput(raw);
    if (!input || raw.accion !== undefined && !ASSISTANCE_ACTIONS.includes(raw.accion)) return null;
    return { input, action: raw.accion as AssistanceAction | undefined };
  } catch { return null; }
  finally { reader.releaseLock(); }
}
export async function POST(req: Request) {
  const parsed = await readInput(req);
  if (!parsed) return Response.json({ error: "Envía una tutela con hasta 16 mensajes recientes de 2000 caracteres y 16000 caracteres en total." }, { status: 400, headers });
  const { input, action } = parsed;
  if (explicitDanger(input.mensajes.at(-1)?.content || "")) return Response.json(fallbackConversation(input), { headers });
  const limit = await checkChatLimit(req);
  if (!limit.allowed) return Response.json({ ...fallbackConversation(input), respuesta: CHAT_LIMIT_MESSAGE + " Puedes continuar paso a paso; tu texto se conserva." }, { status: 429, headers: { ...headers, "Retry-After": String(limit.retryAfter) } });
  if (action) return Response.json(await assistTool(input, action, { ask: askGeminiJSON, retrieve: (text, signal) => retrieve(text, "", undefined, [], { signal, reformulate: async () => null }), signal: req.signal }), { headers });
  return Response.json(await companionTurn(input, { ask: askGeminiJSON, signal: req.signal, retrieve: (text, signal) => retrieve(text, "", undefined, [], { signal, reformulate: async () => null }) }), { headers });
}
