// Importa la colección inicial de documentos oficiales en una instancia de RAIZIA en ejecución.
// Uso:  npm run importar        (con la aplicación abierta en http://localhost:4000)
import fs from "node:fs";
import path from "node:path";

const base = process.env.RAIZIA_URL || "http://localhost:4000";
let password = process.env.ADMIN_PASSWORD || "";
if (!password) {
  try {
    const env = fs.readFileSync(path.join(import.meta.dirname, "..", ".env.local"), "utf8");
    password = /^ADMIN_PASSWORD=(.*)$/m.exec(env)?.[1]?.trim() || "";
  } catch {
    /* sin .env.local */
  }
}
if (!password) {
  console.error("Define ADMIN_PASSWORD en .env.local antes de importar.");
  process.exit(1);
}

const login = await fetch(`${base}/api/admin/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ password }),
}).catch(() => null);
if (!login?.ok) {
  console.error(
    login ? "No se pudo iniciar sesión: revisa ADMIN_PASSWORD." : `RAIZIA no responde en ${base}. Inicia la aplicación primero.`,
  );
  process.exit(1);
}
const cookie = (login.headers.getSetCookie?.() || []).map((c) => c.split(";")[0]).join("; ");

console.log("Importando fuentes oficiales (puede tardar unos minutos)…\n");
const res = await fetch(`${base}/api/seed`, { method: "POST", headers: { Cookie: cookie } });
if (!res.ok || !res.body) {
  console.error("La importación no pudo iniciar.");
  process.exit(1);
}
const marks = { importado: "✔ importado ", ya_existe: "• ya existe ", omitido: "– omitido   ", error: "✖ error     " };
const totals = {};
let pending = "";
const decoder = new TextDecoder();
for await (const chunk of res.body) {
  pending += decoder.decode(chunk, { stream: true });
  let nl;
  while ((nl = pending.indexOf("\n")) >= 0) {
    const line = pending.slice(0, nl).trim();
    pending = pending.slice(nl + 1);
    if (!line) continue;
    const ev = JSON.parse(line);
    totals[ev.outcome] = (totals[ev.outcome] || 0) + 1;
    console.log(`${marks[ev.outcome] || ev.outcome} ${ev.title}${ev.detail ? `  (${ev.detail})` : ""}`);
  }
}
console.log("\nResumen:", Object.entries(totals).map(([k, v]) => `${v} ${k}`).join(", ") || "sin cambios");
