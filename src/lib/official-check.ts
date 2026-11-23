import { createSessionCache } from "./session-cache";

export type OfficialReference = { ref: string; url: string; found: boolean };
const cache = createSessionCache<OfficialReference | null>(86_400_000, 64);
const HOST = "https://www.corteconstitucional.gov.co/relatoria";

/** Solo extrae el número de la sentencia: ningún dato del relato sale hacia la web. */
export function sentenceReferences(text: string) {
  const out = new Map<string, { type: string; number: string; year: number; yy: string }>();
  for (const m of text.matchAll(/\b(SU|T|C)\s*[-–]\s*(\d{1,4})\s*(?:\/|-|\s+de\s+|\s+del\s+)\s*((?:19|20)?\d{2})\b/gi)) {
    const type = m[1].toUpperCase(), number = m[2].padStart(3, "0"), yy = m[3].slice(-2);
    const year = m[3].length === 4 ? Number(m[3]) : Number(yy) >= 91 ? 1900 + Number(yy) : 2000 + Number(yy);
    if (year >= 1992 && year <= new Date().getFullYear()) out.set(`${type}-${number}-${yy}`, { type, number, year, yy });
  }
  return [...out.values()].slice(0, 2);
}

/** Comprueba en la relatoría oficial; si la web falla, responde null y la app sigue con la biblioteca. */
export async function checkOfficialSentence(reference: { type: string; number: string; year: number; yy: string }, fetcher: typeof fetch = fetch): Promise<OfficialReference | null> {
  const code = `${reference.type}-${reference.number}-${reference.yy}`;
  const url = `${HOST}/${reference.year}/${code}.htm`;
  return cache({ code }, async () => {
    const response = await fetcher(url, { method: "GET", redirect: "follow", signal: AbortSignal.timeout(4000), headers: { "User-Agent": "RAIZIA-verificador" } });
    const ref = `${reference.type}-${reference.number} de ${reference.year}`;
    if (response.status === 404) { await response.body?.cancel(); return { ref, url, found: false }; }
    if (!response.ok) { await response.body?.cancel(); throw new Error("no disponible"); }
    // La relatoría responde 200 también cuando la sentencia no existe: se exige su número en la página.
    const page = await response.text();
    return { ref, url, found: new RegExp(`${reference.type}\\s*-\\s*0*${Number(reference.number)}\\b`, "i").test(page) };
  }).catch(() => null);
}

/** Vacío de la biblioteca: se consulta solo si la persona nombra una sentencia que no se recuperó. */
export async function officialNote(message: string, libraryText: string, fetcher: typeof fetch = fetch): Promise<string> {
  const known = libraryText.toUpperCase().replace(/\s+/g, "");
  const missing = sentenceReferences(message).filter(r => !known.includes(`${r.type}-${Number(r.number)}`) && !known.includes(`${r.type}-${r.number}`));
  if (!missing.length) return "";
  const checked = (await Promise.all(missing.map(r => checkOfficialSentence(r, fetcher)))).filter((r): r is OfficialReference => !!r);
  return checked.map(r => r.found
    ? `La sentencia ${r.ref} no está en mi biblioteca, pero sí aparece en la relatoría de la Corte Constitucional: ${r.url}. Léela allí antes de citarla; no la interpreto sin su texto.`
    : `No encontré la sentencia ${r.ref} en la relatoría de la Corte Constitucional. Revisa el número antes de citarla.`).join("\n\n");
}
