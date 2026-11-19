import { cookies } from "next/headers";
import { adminConfigured, checkPassword, createSessionValue, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth";
import { body, failure, json } from "../_utils";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    if (!adminConfigured()) return json({ error: "Configura ADMIN_PASSWORD en .env.local y reinicia la aplicación para habilitar el acceso." }, 503);
    const input = await body(request);
    if (typeof input.password !== "string" || !checkPassword(input.password)) {
      await new Promise((resolve) => setTimeout(resolve, 400));
      return json({ error: "La contraseña no es correcta. Intenta de nuevo." }, 401);
    }
    (await cookies()).set(SESSION_COOKIE, createSessionValue(), sessionCookieOptions);
    return json({ ok: true });
  } catch (error) {
    return failure(error, "No pudimos iniciar la sesión. Intenta de nuevo.");
  }
}
