import { cookies } from "next/headers";
import { SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth";
import { adminRoute, json } from "../_utils";
export const dynamic = "force-dynamic";
export async function POST() {
    return adminRoute(async () => {
        (await cookies()).set(SESSION_COOKIE, "", { ...sessionCookieOptions, maxAge: 0 });
        return json({ ok: true });
    });
}
