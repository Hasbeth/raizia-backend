import { mentionedGroups, normalize, type Identity } from "./identity";
import type { Hit } from "./search";
export type SourceKind = "norma" | "jurisprudencia" | "contexto";
export function sourceKind(h: Pick<Hit, "docType">): SourceKind {
  const type = normalize(h.docType);
  if (/boletin|cartilla|guia|caso/.test(type)) return "contexto";
  return /sentencia|auto|jurisprudencia/.test(type) ? "jurisprudencia" : "norma";
}
export const CONTEXT_RULES = `Las fuentes tienen tipo norma, jurisprudencia o contexto. Lo que debe hacerse se sustenta en norma o jurisprudencia. Boletín, Cartilla, Guía y Caso son contexto: nunca crean una obligación legal. Úsalos solo para explicar cómo ha pasado o cómo se hace en la práctica, atribuyendo "Según un boletín de [entidad]…" o "En el caso de…", con fecha si existe. Toda cifra dice "según [entidad], a esa fecha". La sección opcional "Qué ha pasado en casos parecidos" SOLO aparece si hay contexto citado. No traslades derechos entre poblaciones.`;
export function wantsContext(q: string) {
  return /como (?:se |puedo |hago|hacer|present|tramita)|tramite|que paso|casos?|cifras?|experiencias?|practica|estadistic|boletin|cartilla|guia/.test(normalize(q));
}
export function populationScope(h: Pick<Hit, "title" | "heading">): string[] {
  const title = normalize(h.title);
  const text = `${title} ${normalize(h.heading)}`;
  const groups: string[] = mentionedGroups(text);
  if (/ley\s+70\b|decreto(?: ley)?\s+4635\b/.test(title)) groups.push("narp");
  if (/decreto(?: ley)?\s+4633\b/.test(title)) groups.push("indigena");
  if (/decreto(?: ley)?\s+4634\b/.test(title)) groups.push("rrom");
  if (/cedaw|belem|ley\s+51\s+de\s+1981|ley\s+248\s+de\s+1995|mujer|femenin/.test(text)) groups.push("mujeres");
  if (/infancia|adolescen|ninez|ninos|ninas|menores de edad/.test(text)) groups.push("ninez");
  if (/victimas|conflicto armado|decreto(?: ley)?\s+463[345]\b/.test(text)) groups.push("victimas");
  return [...new Set(groups)];
}
export type PopulationContext = { identity: Identity; text: string };
export function populationAllowed(h: Pick<Hit, "title" | "heading">, ctx: PopulationContext): boolean {
  const active = new Set<string>(ctx.identity.comparisonGroups);
  const q = normalize(ctx.text);
  // Nombrar una norma/caso activa su población como TEMA, sin atribuir identidad.
  const reference = normalize(h.title).match(/\b(ley|decreto(?: ley)?|[tcs]u?|auto)\s*[-–]?\s*(\d{1,5})\b/);
  if (reference && new RegExp(`\\b${reference[1].replace(/ /g, "\\s+")}\\s*[-–]?\\s*${reference[2]}\\b`).test(q)) return true;
  if (/cabildo|resguardo|consulta previa|lenguas nativas|pueblo.*(?:no quiere contacto|aislamiento)|(?:lugares|sitios) sagrados.*sierra/.test(q)) active.add("indigena");
  if (/mujer|femenin|cedaw|belem|embaraz|mi esposa|mi novia|mi madre/.test(q)) active.add("mujeres");
  // La violencia de pareja activa una posible vía condicionada, no presume sexo.
  if (/mi (?:esposo|pareja).*me (?:pega|golpea)|violencia (?:de pareja|intrafamiliar)/.test(q)) active.add("mujeres");
  if (/nino|nina|menor|infancia|adolescen|mi hij|colegio|escuela/.test(q)) active.add("ninez");
  if (/victima|conflicto|armad|desplaz|reparacion|restitucion|guerra|masacre|sacaron.*violencia|huir.*violencia/.test(q)) active.add("victimas");
  const scope = populationScope(h);
  // Los documentos sobre varios grupos pueden respaldar cualquiera de ellos;
  // los ejes mujer/niñez/víctimas sí exigen activación propia.
  const ethnic = scope.filter(s => ["indigena", "narp", "rrom", "campesino"].includes(s));
  return (!ethnic.length || ethnic.some(g => active.has(g))) && scope.filter(s => !ethnic.includes(s)).every(s => active.has(s));
}
export function racialDiscrimination(text: string, identity: Identity) {
  return /discrimin|racis/.test(normalize(text)) && (identity.groups.includes("narp") || /racial|raza|color de piel/.test(normalize(text)));
}
export function racialPriority(h: Pick<Hit, "title" | "heading" | "content">): number {
  const t = normalize(`${h.title} ${h.heading} ${h.content || ""}`);
  if (/1482|134\s*[ab]|actos de discriminacion/.test(t)) return 3;
  if (/constitucion/.test(normalize(h.title)) && /articulo\s+13\b|igualdad|discrimin/.test(t)) return 2;
  if (/queja|disciplinari/.test(t) && /funcionari|servidor|policia/.test(t)) return 1;
  return 0;
}
