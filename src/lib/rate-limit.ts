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

type ChatWindow = "minuto" | "dia_ip" | "global";
class ChatLimitReached extends Error { constructor(readonly window: ChatWindow, readonly retryAfter: number) { super("limite"); } }
function chatLimitMessage(window: ChatWindow, retryAfter: number, now: Date) {
  if (window === "minuto") return `Enviaste varias consultas seguidas. Espera ${retryAfter} segundos y vuelve a intentarlo; tu conversación sigue aquí.`;
  const hour = new Date(now.getTime() + retryAfter * 1000).toLocaleTimeString("es-CO", { timeZone: "America/Bogota", hour: "numeric", minute: "2-digit" });
  return window === "dia_ip" ? `Se alcanzó el límite diario de consultas desde esta conexión. Podrás seguir a las ${hour}; tu conversación sigue aquí.`
    : `RAIZIA alcanzó su límite diario de consultas. Podrás seguir a las ${hour}; tu conversación sigue aquí.`;
}

/** Chat y herramientas con IA. Ventanas UTC; ningún identificador contiene la IP en claro. Un intento rechazado no consume cupo. */
export async function checkChatLimit(request: Request, now = new Date()): Promise<{ allowed: boolean; retryAfter: number; window?: ChatWindow; message?: string }> {
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
      { name: "minuto" as const, bucket: `chat:minute:${identifier}`, start: minuteStart, ms: 60_000, max: limit("CHAT_LIMIT_IP_PER_MINUTE", 12) },
      // Varias personas pueden compartir IP en una universidad, una comunidad o una red móvil.
      { name: "dia_ip" as const, bucket: `chat:day:${identifier}`, start: dayStart, ms: 86_400_000, max: limit("CHAT_LIMIT_IP_PER_DAY", 300) },
      { name: "global" as const, bucket: "chat:global", start: dayStart, ms: 86_400_000, max: limit("CHAT_LIMIT_GLOBAL_PER_DAY", 1500) },
    ];
    return await tx(async database => {
      for (const window of windows) {
        const [row] = await database.query<{ count: number }>(`INSERT INTO rate_limits(bucket,window_start,count)
          VALUES($1,$2::timestamptz,1) ON CONFLICT(bucket,window_start)
          DO UPDATE SET count=rate_limits.count+1 RETURNING count`, [window.bucket, window.start.toISOString()]);
        // Al lanzar, la transacción revierte también las ventanas ya contadas.
        if (row.count > window.max) throw new ChatLimitReached(window.name, Math.max(1, Math.ceil((window.start.getTime() + window.ms - now.getTime()) / 1000)));
      }
      return { allowed: true, retryAfter: 0 };
    });
  } catch (error) {
    if (error instanceof ChatLimitReached) {
      console.warn(`[chat-rate-limit] bloqueado ventana=${error.window} retry=${error.retryAfter}s`);
      return { allowed: false, retryAfter: error.retryAfter, window: error.window, message: chatLimitMessage(error.window, error.retryAfter, now) };
    }
    // No imprimir el error original: algunos drivers incluyen parámetros de consulta.
    console.error("[chat-rate-limit] No se pudo contar la consulta; se permite continuar.");
    return { allowed: true, retryAfter: 0 };
  }
}
