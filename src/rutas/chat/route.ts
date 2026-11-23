import type { ChatEvent } from "@/lib/constants";
import { suggestTool } from "@/lib/tools-config";
import { generateAnswer, isSmallTalk, ollamaStatus, retrieve, smallTalkReply } from "@/lib/rag";
import { checkChatLimit, CHAT_LIMIT_MESSAGE } from "@/lib/rate-limit";
import { resolveIdentity } from "@/lib/identity";
import { askGeminiJSON } from "@/lib/rag";
import { companionTurn, isCaseTurn } from "@/lib/companion";
import { officialNote } from "@/lib/official-check";
import { TOOLS } from "@/lib/tools-config";
export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";
type Turn = {
    role: "user" | "assistant";
    content: string;
};
export async function POST(req: Request) {
    const body = await req.json().catch(() => null);
    const message = String(body?.message || "").trim().slice(0, 1500);
    if (!message) {
        return Response.json({ error: "Escribe una consulta." }, { status: 400 });
    }
    const smallTalk = isSmallTalk(message);
    if (!smallTalk) {
        const limit = await checkChatLimit(req);
        if (!limit.allowed) return Response.json({ message: limit.message || CHAT_LIMIT_MESSAGE, window: limit.window }, {
            status: 429,
            headers: { "Retry-After": String(limit.retryAfter), "Cache-Control": "no-store" },
        });
    }
    const history: Turn[] = (Array.isArray(body?.history) ? body.history : [])
        .filter((m: Turn) => (m?.role === "user" || m?.role === "assistant") && typeof m?.content === "string" && m.content)
        .slice(-6);
    const clip = (v: unknown) => String(v ?? "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 80);
    const profile = {
        group: clip(body?.profile?.group),
        community: clip(body?.profile?.community),
        territory: clip(body?.profile?.territory),
    };
    const previousUser = [...history].reverse().find((m) => m.role === "user")?.content || "";
    let identityQuestion = resolveIdentity(message, profile, history).question;
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
            let subtemas: string[] = [];
            const send = (e: ChatEvent) => controller.enqueue(encoder.encode(JSON.stringify(e.type === "meta" ? { ...e, subtemas, identityQuestion } : e) + "\n"));
            try {
                // Un relato todavía incompleto se conversa con la misma lógica de las herramientas.
                if (!smallTalk && isCaseTurn(message, history)) {
                    const mensajes = [...history.map(m => ({ role: m.role, content: m.content.slice(0, 2000) })), { role: "user" as const, content: message }];
                    while (mensajes.length > 16 || mensajes[0]?.role === "assistant") mensajes.shift();
                    const turn = await companionTurn({ kind: "tutela", mensajes, confirmados: {}, preguntados: {} }, { libre: true, ask: askGeminiJSON, signal: req.signal,
                        retrieve: (text, signal) => retrieve(text, "", profile, [], { signal, reformulate: async () => null }) });
                    const slug = turn.mecanismo?.tool?.slug;
                    const offered = slug ? Object.values(TOOLS).find(t => t.slug === slug) : undefined;
                    identityQuestion = undefined;
                    send({ type: "meta", mode: "conversacion", topics: [], sources: turn.fuentes, tool: offered ? { slug: offered.slug, name: offered.name } : undefined });
                    send({ type: "token", text: turn.respuesta });
                    send({ type: "done" });
                    return;
                }
                // La reformulación clasifica antes de consultar la biblioteca.
                const retrieval = smallTalk
                    ? { topics: [], hits: [], sources: [], subtemas: [], reformulation: null, clarification: null, reply: smallTalkReply(message, history) }
                    : await retrieve(message, previousUser, profile, history, { signal: req.signal, reformulate: async () => null });
                const { topics, hits, sources, reformulation, clarification } = retrieval;
                subtemas = retrieval.subtemas;
                if (retrieval.reply) {
                    identityQuestion = undefined;
                    send({ type: "meta", mode: "conversacion", topics: [], sources: [] });
                    send({ type: "token", text: retrieval.reply });
                    send({ type: "done" });
                    return;
                }
                const topicList = topics.map((t) => ({ id: t.id, name: t.name }));
                const tool = smallTalk ? undefined : suggestTool(message) || undefined;
                if (clarification) {
                    send({ type: "meta", mode: "conversacion", topics: topicList, sources: [] });
                    send({ type: "token", text: clarification });
                    send({ type: "done" });
                    return;
                }
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
                        }
                        catch {
                            if (req.signal.aborted)
                                return;
                            console.error("[chat] Generación no disponible");
                            send({ type: "error", message: "No pude responder en este momento. Intenta de nuevo." });
                        }
                    }
                    else if (smallTalk) {
                        send({ type: "meta", mode: "conversacion", topics: [], sources: [] });
                        send({ type: "token", text: smallTalkReply(message, history) });
                    }
                    else {
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
                    for await (const text of generateAnswer(status.model, message, hits, history, req.signal, profile, undefined, reformulation)) {
                        send({ type: "token", text });
                    }
                    // Solo si nombra una sentencia ausente de lo recuperado: se consulta su número, nunca el relato.
                    const note = await officialNote(message, hits.map(h => `${h.title} ${h.heading}`).join(" "));
                    if (note) send({ type: "token", text: `\n\n${note}` });
                }
                catch {
                    if (req.signal.aborted)
                        return;
                    send({
                        type: "error",
                        message: "No pude redactar la respuesta en este momento. Intenta de nuevo; abajo quedan los documentos encontrados.",
                    });
                    console.error("[chat] Generación no disponible");
                }
                send({ type: "done" });
            }
            catch {
                console.error("[chat] Búsqueda no disponible");
                send({ type: "error", message: "Ocurrió un problema al buscar en la biblioteca. Intenta de nuevo." });
                send({ type: "done" });
            }
            finally {
                try {
                    controller.close();
                }
                catch {
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
