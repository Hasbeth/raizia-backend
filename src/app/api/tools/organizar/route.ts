import { ollamaStatus, organizeNarrative, probeNarrative } from "@/lib/rag";
export const dynamic = "force-dynamic";
/**
 * Ordena el relato de la persona (hechos o solicitudes) con la IA local.
 * Nunca es obligatorio: si la IA no está disponible, se devuelve el texto tal cual.
 */
export async function POST(req: Request) {
    const body = await req.json().catch(() => null);
    const text = String(body?.text || "").trim().slice(0, 6000);
    const kind = body?.kind === "peticiones" ? "peticiones" : "hechos";
    if (!text)
        return Response.json({ text: "", organized: false, questions: [] });
    const status = await ollamaStatus();
    if (!status.available || !status.model)
        return Response.json({ text, organized: false, questions: [] });
    try {
        // Paso 1 (opcional): ¿falta algo importante? Devuelve hasta dos preguntas de seguimiento.
        if (body?.step === "preguntas") {
            return Response.json({ questions: await probeNarrative(status.model, text, kind, req.signal) });
        }
        const organized = await organizeNarrative(status.model, text, kind, req.signal);
        return Response.json(organized ? { text: organized, organized: true } : { text, organized: false });
    }
    catch (e) {
        if (!req.signal.aborted)
            console.error("[organizar]", e);
        return Response.json({ text, organized: false, questions: [] });
    }
}
