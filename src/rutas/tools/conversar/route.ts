import { askGeminiJSON } from "@/lib/rag";
import { checkChatLimit, CHAT_LIMIT_MESSAGE } from "@/lib/rate-limit";
import { CONVERSATION_LIMITS, converse, fallbackConversation, parseConversationInput } from "@/lib/tool-conversation";
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
    return parseConversationInput(JSON.parse(text + decoder.decode()));
  } catch { return null; }
  finally { reader.releaseLock(); }
}
export async function POST(req: Request) {
  const input = await readInput(req);
  if (!input) return Response.json({ error: "Envía una tutela con hasta 16 mensajes recientes de 2000 caracteres y 16000 caracteres en total." }, { status: 400, headers });
  const limit = await checkChatLimit(req);
  if (!limit.allowed) return Response.json({ ...fallbackConversation(input), respuesta: CHAT_LIMIT_MESSAGE + " Puedes continuar paso a paso; tu texto se conserva." }, { status: 429, headers: { ...headers, "Retry-After": String(limit.retryAfter) } });
  return Response.json(await converse(input, { ask: askGeminiJSON, signal: req.signal }), { headers });
}
