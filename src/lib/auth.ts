/**
 * Acceso al panel de administración: una contraseña definida en .env.local
 * (ADMIN_PASSWORD) y una cookie de sesión firmada. Suficiente para uso local;
 * al migrar a la nube conviene sustituirlo por un proveedor de identidad.
 */
import crypto from "node:crypto";
import { cookies } from "next/headers";

export const SESSION_COOKIE = "raizia_admin";
const MAX_AGE = 60 * 60 * 8; // 8 horas

function password(): string {
  return process.env.ADMIN_PASSWORD || "";
}

function secret(): string {
  return crypto
    .createHash("sha256")
    .update(`raizia:${process.env.SESSION_SECRET || ""}:${password()}`)
    .digest("hex");
}

function sign(payload: string): string {
  return crypto.createHmac("sha256", secret()).update(payload).digest("hex");
}

export function adminConfigured(): boolean {
  return password().length > 0;
}

export function checkPassword(candidate: string): boolean {
  const a = crypto.createHash("sha256").update(candidate).digest();
  const b = crypto.createHash("sha256").update(password()).digest();
  return adminConfigured() && crypto.timingSafeEqual(a, b);
}

export function createSessionValue(): string {
  const exp = String(Math.floor(Date.now() / 1000) + MAX_AGE);
  return `${exp}.${sign(exp)}`;
}

export function verifySessionValue(value: string | undefined): boolean {
  if (!value || !adminConfigured()) return false;
  const [exp, sig] = value.split(".");
  if (!exp || !sig || Number(exp) < Date.now() / 1000) return false;
  const expected = sign(exp);
  return sig.length === expected.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}

/** Para páginas y rutas del servidor: ¿hay una sesión de administración válida? */
export async function isAdmin(): Promise<boolean> {
  const store = await cookies();
  return verifySessionValue(store.get(SESSION_COOKIE)?.value);
}

export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  maxAge: MAX_AGE,
};
