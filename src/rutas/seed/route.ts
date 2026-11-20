import { isAdmin } from "@/lib/auth";
import { seedOfficialSources } from "@/lib/seed";
export const dynamic = "force-dynamic";
export const maxDuration = 600;
/** Importa la colección inicial de fuentes oficiales. Emite una línea JSON por documento. */
export async function POST() {
    if (!(await isAdmin())) {
        return Response.json({ error: "Inicia sesión en Administración." }, { status: 401 });
    }
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
            try {
                for await (const ev of seedOfficialSources()) {
                    controller.enqueue(encoder.encode(JSON.stringify(ev) + "\n"));
                }
            }
            catch (e) {
                console.error("[seed]", e);
            }
            finally {
                controller.close();
            }
        },
    });
    return new Response(stream, {
        headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" },
    });
}
