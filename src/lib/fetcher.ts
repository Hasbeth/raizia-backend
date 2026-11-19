/**
 * Descarga de documentos desde fuentes oficiales.
 * Solo dominios permitidos, respeta robots.txt y limita el tamaño.
 */
import tls from "node:tls";
import { OFFICIAL_DOMAINS } from "./constants";

/**
 * Algunos sitios oficiales no envían su cadena completa de certificados.
 * Se añaden las autoridades de confianza del sistema operativo a las de Node:
 * la verificación TLS permanece activa en todo momento.
 */
let systemCaLoaded = false;
function trustSystemCertificates() {
  if (systemCaLoaded) return;
  systemCaLoaded = true;
  try {
    const merged = new Set([...tls.getCACertificates("default"), ...tls.getCACertificates("system")]);
    tls.setDefaultCACertificates([...merged]);
  } catch {
    /* versión de Node sin esta función: se conservan las autoridades por defecto */
  }
}

export const USER_AGENT =
  "RAIZIA/0.1 (prototipo academico de orientacion juridica; importador documental)";
const MAX_BYTES = 30 * 1024 * 1024;

export class ImportError extends Error {}

export function isOfficialHost(host: string): boolean {
  const h = host.toLowerCase();
  return OFFICIAL_DOMAINS.some((d) => h === d || h.endsWith(`.${d}`));
}

type RobotsRule = { allow: boolean; pattern: string };
const robotsCache = new Map<string, RobotsRule[]>();

async function robotsRules(origin: string): Promise<RobotsRule[]> {
  const cached = robotsCache.get(origin);
  if (cached) return cached;
  const rules: RobotsRule[] = [];
  try {
    const res = await fetch(`${origin}/robots.txt`, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(10_000),
    });
    // Algunos sitios devuelven una página HTML en lugar de robots.txt: no contiene reglas.
    if (res.ok && (res.headers.get("content-type") || "").includes("text/plain")) {
      const txt = await res.text();
      let applies = false;
      for (const raw of txt.split(/\r?\n/)) {
        const line = raw.replace(/#.*/, "").trim();
        const m = /^([\w-]+)\s*:\s*(.*)$/.exec(line);
        if (!m) continue;
        const key = m[1].toLowerCase();
        const val = m[2].trim();
        if (key === "user-agent") applies = val === "*" || /raizia/i.test(val);
        else if ((key === "disallow" || key === "allow") && applies && val) {
          rules.push({ allow: key === "allow", pattern: val });
        }
      }
    }
  } catch {
    /* sin robots.txt accesible: no hay reglas que aplicar */
  }
  robotsCache.set(origin, rules);
  return rules;
}

function robotsMatch(pattern: string, target: string): boolean {
  const anchored = pattern.endsWith("$");
  const body = (anchored ? pattern.slice(0, -1) : pattern)
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${body}${anchored ? "$" : ""}`).test(target);
}

/** Regla de robots.txt más específica (la más larga) que coincide con la ruta. */
export function robotsAllows(rules: RobotsRule[], target: string): boolean {
  let best: RobotsRule | null = null;
  for (const r of rules) {
    if (!robotsMatch(r.pattern, target)) continue;
    if (!best || r.pattern.length > best.pattern.length || (r.pattern.length === best.pattern.length && r.allow)) {
      best = r;
    }
  }
  return best ? best.allow : true;
}

export async function fetchOfficial(rawUrl: string): Promise<{
  buffer: Buffer;
  contentType: string;
  finalUrl: string;
  fileName: string;
}> {
  trustSystemCertificates();
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    throw new ImportError("La dirección no es válida.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new ImportError("Solo se admiten direcciones http o https.");
  }
  if (!isOfficialHost(url.hostname)) {
    throw new ImportError(
      `El dominio ${url.hostname} no está en la lista de fuentes oficiales permitidas.`,
    );
  }
  const rules = await robotsRules(url.origin);
  if (!robotsAllows(rules, url.pathname + url.search)) {
    throw new ImportError("El sitio no permite la descarga automática de esta dirección (robots.txt).");
  }

  let res: Response;
  try {
    res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/pdf,*/*;q=0.8" },
      redirect: "follow",
      signal: AbortSignal.timeout(45_000),
    });
  } catch (e) {
    const cause = (e as { cause?: { code?: string } })?.cause?.code;
    throw new ImportError(
      `No fue posible conectar con ${url.hostname}${cause ? ` (${cause})` : ""}.`,
    );
  }
  if (!res.ok) throw new ImportError(`El sitio respondió con el código ${res.status}.`);
  if (!isOfficialHost(new URL(res.url).hostname)) {
    throw new ImportError("La dirección redirige a un dominio no permitido.");
  }
  const len = Number(res.headers.get("content-length") || 0);
  if (len > MAX_BYTES) throw new ImportError("El archivo supera el tamaño máximo (30 MB).");
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length > MAX_BYTES) throw new ImportError("El archivo supera el tamaño máximo (30 MB).");

  const contentType = res.headers.get("content-type") || "";
  const last = decodeURIComponent(new URL(res.url).pathname.split("/").pop() || "");
  let fileName = last || "documento";
  if (!/\.(pdf|docx|html?|txt)$/i.test(fileName)) {
    fileName += contentType.includes("pdf")
      ? ".pdf"
      : contentType.includes("wordprocessingml")
        ? ".docx"
        : ".html";
  }
  return { buffer, contentType, finalUrl: res.url, fileName };
}
