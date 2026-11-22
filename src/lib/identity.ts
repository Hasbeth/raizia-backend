/** Resolución por turno. Nunca escribe ni modifica el perfil guardado. */
export type Group = "indigena" | "narp" | "rrom" | "campesino";
type Profile = { group: string; community: string; territory: string };
type Turn = { role: "user" | "assistant"; content: string };
export const normalize = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const PATTERNS: Record<Group, string> = {
  indigena: "indigen[ao]s?|nasa|wayuu|wayu|misak|embera|arhuac[oa]s?|iku|kogui|kaggaba|kogi|kankuam[oa]s?|wiwa|zenu|pijao|inga|awa|u['’ -]?wa|sikuani|uitoto|huitoto|tikuna|tukano|kamentsa|pastos|yanacona|murui|ette ennaka|chimila",
  narp: "negr[oa]s?|afro(?:colombian[oa]s?|descendientes?)?|raizal(?:es)?|palenquer[oa]s?|narp",
  rrom: "rrom|rom|gitan[oa]s?", campesino: "campesin[oa]s?",
};
export const GROUP_LABELS: Record<Group, string> = {
  indigena: "pueblos indígenas", narp: "comunidades negras, afrocolombianas, raizales y palenqueras",
  rrom: "pueblo Rrom", campesino: "campesinado",
};
export function mentionedGroups(text: string): Group[] {
  const clean = normalize(text).replace(/\blinea negra\b/g, "territorio ancestral de la Sierra Nevada")
    .replace(/\bno (?:soy|somos|pertenezco a|me identifico como)\s+(?:un[ao]?\s+)?[^.,;?\n]+/g, "");
  return (Object.keys(PATTERNS) as Group[]).filter(g => new RegExp(`\\b(?:${PATTERNS[g]})\\b`).test(clean));
}
/** El relato ampliado contiene preguntas anteriores; no son dichos de la persona. */
export function userNarrativeParts(message: string) {
  return message.split(/\n\n/).map(part => part.match(/^[^\n]*\?\n([\s\S]*)$/)?.[1] || part).filter(Boolean);
}
export function resolveIdentity(message: string, profile?: Profile, history: Turn[] = []) {
  const parts = userNarrativeParts(message);
  let text = [...parts].reverse().find(p => mentionedGroups(p).length || /\bamb[ao]s\b/.test(normalize(p))) || parts.join("\n");
  const choice = text;
  let both = /\bamb[ao]s\b/.test(normalize(choice));
  let groups = mentionedGroups(text);
  if (!groups.length && both) groups = [...parts].reverse().map(mentionedGroups).find(g => g.length) || [];
  let origin: "mensaje" | "historial" | "perfil" = "mensaje";
  const profileGroups = mentionedGroups(`${profile?.group || ""} ${profile?.community || ""}`);
  const deniedIdentity = /\bno (?:soy|somos|pertenezco|me identifico)/.test(normalize(message));
  if (!groups.length && !deniedIdentity) {
    const recent = [...history].reverse().filter(t => t.role === "user").slice(0, 3);
    const prior = recent.find(t => mentionedGroups(t.content).length || /\bamb[ao]s\b/.test(normalize(t.content)));
    if (prior) {
      text = prior.content; groups = mentionedGroups(text); origin = "historial";
      both ||= /\bamb[ao]s\b/.test(normalize(text));
      if (!groups.length && both) groups = recent.map(t => mentionedGroups(t.content)).find(g => g.length) || [];
    }
    else { groups = profileGroups; origin = "perfil"; }
  }
  const directSelf = groups.some(g => new RegExp(`\\b(?:soy|somos|me identifico como|pertenezco a)\\s+(?:(?:una?|persona|comunidad|pueblo|la|el)\\s+){0,3}(?:${PATTERNS[g]})\\b`).test(normalize(text)));
  const causalSelf = /\b(?:me|nos)\b/.test(normalize(text)) && groups.some(g => new RegExp(`\\bpor (?:ser )?(?:${PATTERNS[g]})\\b`).test(normalize(text)));
  const self = origin === "perfil" || directSelf || causalSelf;
  const explicitChoice = /^orientarme para /i.test(choice.trim()) || /^orientarme para /i.test(text.trim());
  if (both) { groups = [...new Set([...groups, ...profileGroups])]; if (origin === "perfil") origin = "mensaje"; }
  const conflict = origin !== "perfil" && profileGroups.some(g => !groups.includes(g));
  const compare = /compar|diferencia|ademas.*perfil/.test(normalize(message));
  const comparisonGroups = compare ? [...new Set([...groups, ...profileGroups])] : groups;
  const question = !both && !explicitChoice && ((conflict && self) || (groups.length > 1 && !compare)) ? {
    texto: `¿Quieres que te oriente para ${groups.map(g => GROUP_LABELS[g]).join(" y ")}, para ${profileGroups.filter(g => !groups.includes(g)).map(g => GROUP_LABELS[g]).join(" y ") || "uno de esos grupos"} o para ambos?`,
    opciones: [...new Set([...groups, ...profileGroups])].map(g => `Orientarme para ${GROUP_LABELS[g]}`).concat("Orientarme para ambos grupos"),
  } : undefined;
  const effectiveProfile: Profile | undefined = origin === "perfil" ? profile : groups.length ? {
    group: groups.map(g => GROUP_LABELS[g]).join(" y "), community: "", territory: "",
  } : undefined;
  return { groups, profileGroups, origin, attribution: self ? "identificacion" : "tema_o_tercero", conflict,
    comparisonGroups, effectiveProfile, question };
}
export type Identity = ReturnType<typeof resolveIdentity>;
export const IDENTITY_RULES = `El mensaje actual manda sobre el perfil. La identidad resuelta es el tema de este turno, no una corrección de la identidad de la persona. Si pregunta por terceros o por un grupo no se lo atribuyas. Usa un inicio neutral o "Para las comunidades…" con el grupo resuelto; nunca un saludo fijo indígena. No cambies el perfil. Solo compara con el perfil si se pidió y hay fuentes de AMBOS grupos; cada derecho requiere fuente de ESE grupo. Si falta evidencia di "en las fuentes que revisé no encontré…". La pregunta de identidad, si existe, va DESPUÉS de orientar en general y es la única aclaración del chat.`;
