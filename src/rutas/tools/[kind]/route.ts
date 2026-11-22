import { buildDocument, buildModel } from "@/lib/docgen";
import { TOOLS, validateTool, type ToolData } from "@/lib/tools-config";
export const dynamic = "force-dynamic";
/** Genera el borrador en Word a partir de los datos del formulario guiado. */
export async function POST(req: Request, ctx: {
    params: Promise<{
        kind: string;
    }>;
}) {
    const { kind } = await ctx.params;
    const config = Object.hasOwn(TOOLS, kind) ? TOOLS[kind] : undefined;
    if (!config)
        return Response.json({ error: "Herramienta no disponible." }, { status: 404 });
    const body = (await req.json().catch(() => null)) as ToolData | null;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
        return Response.json({ error: "Los datos del formulario no son válidos." }, { status: 400 });
    }
    // Solo se aceptan los campos definidos para la herramienta.
    const data: ToolData = {};
    for (const f of config.steps.flatMap((s) => s.fields)) {
        const v = body[f.name];
        if (Array.isArray(v) && (v.length > 100 || v.some(item => typeof item !== "string" || item.length > 8000))) return Response.json({ error: "Una respuesta es demasiado larga o no es válida." }, { status: 400 });
        data[f.name] = Array.isArray(v) ? v.map(String) : String(v ?? "");
    }
    const errors = validateTool(config, data);
    const missing = config.confirmations.filter((c) => body[c.name] !== "si");
    if (Object.keys(errors).length || missing.length) {
        return Response.json({ error: "Faltan datos o confirmaciones para generar el documento.", fields: errors }, { status: 400 });
    }
    for (const confirmation of config.confirmations) data[confirmation.name] = body[confirmation.name];
    if (typeof body.fechaDocumento === "string" && body.fechaDocumento.length < 80) data.fechaDocumento = body.fechaDocumento;
    for (const section of buildModel(kind, data).sections) {
        const key = `edicion_${section.id}`;
        if (typeof body[key] === "string") {
            if (body[key].length > 16000) return Response.json({ error: "Una sección editada es demasiado larga." }, { status: 400 });
            data[key] = body[key];
        }
    }
    try {
        const buffer = await buildDocument(kind, data);
        return new Response(new Uint8Array(buffer), {
            headers: {
                "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                "Content-Disposition": `attachment; filename="${config.fileName}.docx"`,
                "Cache-Control": "no-store",
            },
        });
    }
    catch {
        return Response.json({ error: "No fue posible generar el documento. Intenta de nuevo." }, { status: 500 });
    }
}
