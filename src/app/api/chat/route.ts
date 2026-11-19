import type { ChatEvent } from "@/lib/constants";
import { suggestTool } from "@/lib/tools-config";
import { generateAnswer, isSmallTalk, ollamaStatus, retrieve, STATIC_GREETING } from "@/lib/rag";

export const dynamic = "force-dynamic";

type Turn = { role: "user" | "assistant"; content: string };

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const message = String(body?.message || "").trim().slice(0, 1500);
  if (!message) {
    return Response.json({ error: "Escribe una consulta." }, { status: 400 });
  }
  const history: Turn[] = (Array.isArray(body?.history) ? body.history : [])
    .filter(
      (m: Turn) =>
        (m?.role === "user" || m?.role === "assistant") && typeof m?.content === "string" && m.content,
    )
    .slice(-6);
  const clip = (v: unknown) =>
    String(v ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80);
  const profile = {
    group: clip(body?.profile?.group),
    community: clip(body?.profile?.community),
    territory: clip(body?.profile?.territory),
  };
  const previousUser = [...history].reverse().find((m) => m.role === "user")?.content || "";

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (e: ChatEvent) => controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
      try {
        // Saludos y charla breve no necesitan buscar; el resto siempre pasa por la biblioteca.
        const smallTalk = isSmallTalk(message);
        const { topics, hits, sources } = smallTalk
          ? { topics: [], hits: [], sources: [] }
          : retrieve(message, previousUser, profile);
        const topicList = topics.map((t) => ({ id: t.id, name: t.name }));
        const tool = smallTalk ? undefined : suggestTool(message) || undefined;
        const status = await ollamaStatus();

        if (!hits.length) {
          // Sin fuentes el modelo solo conversa: saluda, aclara o pide más detalles.
          if (status.available && status.model) {
            send({
              type: "meta",
              mode: "conversacion",
              topics: topicList,
              sources: [],
              model: status.model,
              notice: smallTalk ? undefined : "sin_fuentes",
            });
            try {
              const kind = smallTalk ? "charla" : "sin_fuentes";
              for await (const text of generateAnswer(status.model, message, [], history, req.signal, profile, kind)) {
                send({ type: "token", text });
              }
            } catch (e) {
              if (req.signal.aborted) return;
              console.error("[chat] Ollama:", e);
              send({ type: "error", message: "La IA local dejó de responder. Intenta de nuevo en un momento." });
            }
          } else if (smallTalk) {
            send({ type: "meta", mode: "conversacion", topics: [], sources: [] });
            send({ type: "token", text: STATIC_GREETING });
          } else {
            send({ type: "meta", mode: "sin_resultados", topics: topicList, sources: [] });
          }
          send({ type: "done" });
          return;
        }

        if (!status.available || !status.model) {
          send({
            type: "meta",
            mode: "busqueda",
            topics: topicList,
            sources,
            tool,
            notice: status.reason || "La IA local no está disponible.",
          });
          send({ type: "done" });
          return;
        }

        send({ type: "meta", mode: "ia", topics: topicList, sources, model: status.model, tool });
        try {
          for await (const text of generateAnswer(status.model, message, hits, history, req.signal, profile)) {
            send({ type: "token", text });
          }
        } catch (e) {
          if (req.signal.aborted) return;
          send({
            type: "error",
            message:
              "La IA local dejó de responder. Abajo quedan los documentos encontrados para que puedas consultarlos directamente.",
          });
          console.error("[chat] Ollama:", e);
        }
        send({ type: "done" });
      } catch (e) {
        console.error("[chat]", e);
        send({ type: "error", message: "Ocurrió un problema al buscar en la biblioteca. Intenta de nuevo." });
        send({ type: "done" });
      } finally {
        try {
          controller.close();
        } catch {
          /* la conexión ya estaba cerrada */
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
