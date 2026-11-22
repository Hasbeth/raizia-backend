/** Comprobaciones locales de evidencia; no interpretan instrucciones del relato. */
export const normalizeEvidence = (text: string) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const words = (text: string) => normalizeEvidence(text).match(/[\p{L}\p{N}]+/gu) || [];
const compact = (text: string) => normalizeEvidence(text).trim().replace(/[.!?,;:…]+$/u, "").replace(/\s+/g, "");
export function containsQuote(message: string, quote: string): boolean {
  return !!compact(quote) && compact(message).includes(compact(quote));
}
export const prohibited = /\b(?:articulo\s*\d|ley\s*\d|decreto\s*\d|sentencia\b|[tcsu]{1,2}[-–]\d|delito\b|criminal\b|tutela\s+(?:si\s+)?(?:es\s+)?proced|ganaras|garantiz(?:o|amos)|ignora\s+(?:las|todas)|instrucciones\s+(?:previas|anteriores)|system\s*:|sistema\s*:)/i;
export const hasProhibited = (text: string) => prohibited.test(normalizeEvidence(text));
const stop = new Set(words("a al ante bajo con contra de del desde durante el ella ellos en entre era es esa ese esta este fue ha la las le les lo los me mi mis o para por que se sin sobre su sus te tu un una unos unas y yo"));
const datesAndNumbers = new Set(words("enero febrero marzo abril mayo junio julio agosto septiembre octubre noviembre diciembre lunes martes miercoles jueves viernes sabado domingo hoy ayer manana anteayer cero uno una dos tres cuatro cinco seis siete ocho nueve diez once doce trece catorce quince veinte treinta cuarenta cincuenta cien mil primero segundo tercero"));
const negations = new Set(["no", "nunca", "tampoco", "sin"]);

export function groundedText(text: string, quote: string, ratio = 0.8, neutral = new Set<string>()): boolean {
  const source = new Set(words(quote));
  const tokens = words(text);
  // Ni el margen de limpieza ni las palabras de cortesía autorizan cifras, fechas o nombres nuevos.
  if (tokens.some(w => (/\d/.test(w) || datesAndNumbers.has(w) || negations.has(w)) && !source.has(w) && !stop.has(w))) return false;
  const capitals = (text.match(/[\p{L}\p{N}]+/gu) || []).filter(w => /^\p{Lu}/u.test(w));
  if (capitals.some(w => !source.has(normalizeEvidence(w)) && !stop.has(normalizeEvidence(w)) && !neutral.has(normalizeEvidence(w)))) return false;
  const meaningful = tokens.filter(w => !stop.has(w) && !neutral.has(w));
  return meaningful.length ? meaningful.filter(w => source.has(w)).length / meaningful.length >= ratio : neutral.size > 0;
}

/** Sí/No solo ante una afirmación explícita de riesgo o una respuesta a esa pregunta. */
export function supportedOption(option: string, quote: string, riskContext: boolean): boolean {
  const q = words(quote).join(" ");
  if (/[¿?]/.test(quote) || /\b(?:no se|quizas|tal vez)\b/.test(q)) return false;
  const negative = /\bno (?:hay|tengo|existe|corro) (?:ningun )?(?:peligro|riesgo)\b/.test(q) || /\bpuedo esperar sin (?:peligro|riesgo)\b/.test(q);
  const positive = !negative && (/\b(?:mi vida|mi salud) (?:corre peligro|esta en (?:peligro|riesgo))\b/.test(q) || /\b(?:hay|tengo|existe|corro) (?:un )?(?:peligro|riesgo)\b/.test(q) && !/\bno\b/.test(q));
  if (option === "Sí") return positive || riskContext && /^si(?: |$)/.test(q);
  if (option === "No") return negative || riskContext && q === "no";
  return false;
}

const acknowledgmentWords = new Set(words("gracias por contarme contarmelo compartir compartirme explicarme decirme entiendo comprendo escucho lamento siento podemos ayudarte ayudar organizar ordenar revisar juntos paso poco esto eso detalle detalles situacion dificil preocupacion preocupante tranquilamente calma bien acuerdo quieres corregir anterior sabes agregar dicho cuentas contado entiendo gracias"));
export function validAcknowledgment(text: string, story: string): boolean {
  return !!text.trim() && text.length <= 500 && !/[¿?]/.test(text) && !hasProhibited(text) &&
    text.split(/[.!…]+/).filter(s => s.trim()).length <= 2 && groundedText(text, story, 1, acknowledgmentWords);
}
export function validConversationQuestion(text: unknown): text is string {
  return typeof text === "string" && text.length <= 240 && text.trim().endsWith("?") &&
    (text.match(/\?/g) || []).length === 1 && (text.match(/¿/g) || []).length <= 1 && !hasProhibited(text) &&
    !/\b(?:cedula|documento de identidad|numero de documento|identificacion|telefono|celular|correo|email|e mail|direccion|domicilio|contacto|donde vives|donde vive)\b/.test(normalizeEvidence(text));
}
