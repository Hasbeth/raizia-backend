import { createHash } from "node:crypto";
import { tx } from "./db";

export const CHAT_LIMIT_MESSAGE = "Hay muchas consultas en este momento. Espera un momento y vuelve a preguntar.";

function limit(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

const LOGIN_WINDOW_MS = 15 * 60_000;
function loginKey(request: Request, scope: string) {
  const salt = process.env.CRON_SECRET || process.env.SESSION_SECRET || "raizia-local-rate-limit";
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip")?.trim() || "unknown";
  return `login:fail:${createHash("sha256").update(JSON.stringify([salt, scope, ip])).digest("hex")}`;
}
const loginStart = (now: Date) => new Date(Math.floor(now.getTime() / LOGIN_WINDOW_MS) * LOGIN_WINDOW_MS);
const productionRuntime = () => !!process.env.VERCEL || process.env.NODE_ENV === "production";

/** Máx. 5 fallos por IP cada 15 min y 30 intentos globales por minuto. En producción, si no se puede contar, no se deja entrar. */
export async function checkLoginLimit(request: Request, scope = "admin", now = new Date()): Promise<{ allowed: boolean; retryAfter: number }> {
  try {
    const start = loginStart(now);
    const retryAfter = Math.max(1, Math.ceil((start.getTime() + LOGIN_WINDOW_MS - now.getTime()) / 1000));
    return await tx(async database => {
      const [failed] = await database.query<{ count: number }>("SELECT count FROM rate_limits WHERE bucket=$1 AND window_start=$2::timestamptz", [loginKey(request, scope), start.toISOString()]);
      if (Number(failed?.count || 0) >= limit("LOGIN_MAX_FAILURES", 5)) return { allowed: false, retryAfter };
      const minute = new Date(Math.floor(now.getTime() / 60_000) * 60_000);
      const [global] = await database.query<{ count: number }>(`INSERT INTO rate_limits(bucket,window_start,count) VALUES('login:global',$1::timestamptz,1)
        ON CONFLICT(bucket,window_start) DO UPDATE SET count=rate_limits.count+1 RETURNING count`, [minute.toISOString()]);
      if (Number(global.count) > limit("LOGIN_GLOBAL_PER_MINUTE", 30)) return { allowed: false, retryAfter: 60 };
      return { allowed: true, retryAfter: 0 };
    });
  } catch {
    console.error("[login-rate-limit] No se pudo comprobar el límite.");
    return productionRuntime() ? { allowed: false, retryAfter: 60 } : { allowed: true, retryAfter: 0 };
  }
}
export async function recordLoginFailure(request: Request, scope = "admin", now = new Date()) {
  try {
    await tx(database => database.query(`INSERT INTO rate_limits(bucket,window_start,count) VALUES($1,$2::timestamptz,1)
      ON CONFLICT(bucket,window_start) DO UPDATE SET count=rate_limits.count+1`, [loginKey(request, scope), loginStart(now).toISOString()]));
  } catch { console.error("[login-rate-limit] No se pudo registrar el intento."); }
}
export async function clearLoginFailures(request: Request, scope = "admin", now = new Date()) {
  try {
    await tx(database => database.query("DELETE FROM rate_limits WHERE bucket=$1 AND window_start=$2::timestamptz", [loginKey(request, scope), loginStart(now).toISOString()]));
  } catch { /* el contador expira solo */ }
}

/** Solo /api/chat. Ventanas UTC; ningún identificador contiene la IP en claro. */
export async function checkChatLimit(request: Request, now = new Date()): Promise<{ allowed: boolean; retryAfter: number }> {
  try {
    const salt = process.env.CRON_SECRET || (process.env.RAIZIA_MODO === "local" ? "raizia-local-rate-limit" : "");
    if (!salt) throw new Error("missing-rate-limit-salt");
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
      || request.headers.get("x-real-ip")?.trim() || "unknown";
    const day = now.toISOString().slice(0, 10);
    const identifier = createHash("sha256").update(JSON.stringify([salt, day, ip])).digest("hex");
    const minuteStart = new Date(Math.floor(now.getTime() / 60_000) * 60_000);
    const dayStart = new Date(`${day}T00:00:00.000Z`);
    const windows = [
      { bucket: `chat:minute:${identifier}`, start: minuteStart, ms: 60_000, max: limit("CHAT_LIMIT_IP_PER_MINUTE", 12) },
      { bucket: `chat:day:${identifier}`, start: dayStart, ms: 86_400_000, max: limit("CHAT_LIMIT_IP_PER_DAY", 80) },
      { bucket: "chat:global", start: dayStart, ms: 86_400_000, max: limit("CHAT_LIMIT_GLOBAL_PER_DAY", 1500) },
    ];
    return await tx(async database => {
      for (const window of windows) {
        const [row] = await database.query<{ count: number }>(`INSERT INTO rate_limits(bucket,window_start,count)
          VALUES($1,$2::timestamptz,1) ON CONFLICT(bucket,window_start)
          DO UPDATE SET count=rate_limits.count+1 RETURNING count`, [window.bucket, window.start.toISOString()]);
        if (row.count > window.max) return {
          allowed: false,
          retryAfter: Math.max(1, Math.ceil((window.start.getTime() + window.ms - now.getTime()) / 1000)),
        };
      }
      return { allowed: true, retryAfter: 0 };
    });
  } catch {
    // No imprimir el error original: algunos drivers incluyen parámetros de consulta.
    console.error("[chat-rate-limit] No se pudo contar la consulta; se permite continuar.");
    return { allowed: true, retryAfter: 0 };
  }
}
