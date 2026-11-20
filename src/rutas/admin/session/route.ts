import { adminConfigured, isAdmin } from "@/lib/auth";
export const dynamic = "force-dynamic";
export async function GET() {
    const configured = adminConfigured();
    return Response.json({ configured, admin: configured && await isAdmin() }, {
        headers: { "Cache-Control": "no-store" },
    });
}
