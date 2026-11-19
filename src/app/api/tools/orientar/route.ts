import { askOnce, ollamaStatus } from "@/lib/rag";
import { answerDoubts, buildRoute, CLASSIFY_PROMPT, ROUTE_IDS, toolFits, triageByRules } from "@/lib/triage";

export const dynamic = "force-dynamic";

/**
 * Orienta a partir del relato completo: hasta tres caminos ordenados por peso,
 * las dudas que la persona expresó y si la herramienta actual (`current`) corresponde.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const text = String(body?.text || "").trim().slice(0, 8000);
  const current = String(body?.current || "");
  if (text.length < 12) return Response.json({ routes: [], doubts: [], fits: true });

  let ids = triageByRules(text);
  if (!ids.length) {
    // Sin señales claras: la IA local elige dentro de un conjunto cerrado y pequeño.
    try {
      const status = await ollamaStatus();
      if (status.available && status.model) {
        const answer = await askOnce(status.model, CLASSIFY_PROMPT, text.slice(0, 2500), 12, req.signal);
        const word = answer.toLowerCase().replace(/[^a-z-]/g, "");
        const id = ROUTE_IDS.find((r) => word === r || word.startsWith(r));
        // Solo se le cree al modelo pequeño en lo urgente; lo demás va a orientación con una entidad.
        if (id && ["denuncia", "tutela"].includes(id)) ids = [id];
      }
    } catch (e) {
      if (!req.signal.aborted) console.error("[orientar]", e);
    }
  }
  const doubts = answerDoubts(text);
  // Sin clasificación confiable no se interrumpe a la persona dentro de una herramienta.
  if (!ids.length) {
    return Response.json({ routes: current ? [] : [buildRoute("acompanamiento", text)], doubts, fits: true });
  }
  return Response.json({
    routes: ids.slice(0, 3).map((id) => buildRoute(id, text)),
    doubts,
    fits: current ? toolFits(current, ids.slice(0, 3)) : true,
  });
}
