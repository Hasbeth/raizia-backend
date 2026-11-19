/**
 * Asistente con recuperación (RAG) sobre documentos aprobados.
 * El modelo de lenguaje puede ser Gemini (API de Google) u Ollama local:
 * - Con GEMINI_API_KEY en .env.local se usa Gemini (salvo LLM_PROVIDER=ollama).
 * - Sin clave se usa Ollama.
 * Si la IA no está disponible, el flujo degrada a búsqueda documental sin IA.
 */
import type { ChatSource } from "./constants";
import { detectTopics, excerpt, queryTerms, searchChunks, type Hit, type Topic } from "./search";

export const OLLAMA_URL = (process.env.OLLAMA_URL || "http://127.0.0.1:11434").replace(/\/$/, "");
export const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "qwen3.5:4b";

const GEMINI_API_KEY = (process.env.GEMINI_API_KEY || "").trim();
// gemini-3.5-flash: buen equilibrio entre fidelidad y rapidez (medido el 2026-11-19: ~3,6 s por respuesta corta).
const GEMINI_MODEL = (process.env.GEMINI_MODEL || "gemini-3.5-flash").replace(/^models\//, "");
const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";

export type Provider = "gemini" | "ollama";
export const PROVIDER: Provider =
  process.env.LLM_PROVIDER === "ollama" || !GEMINI_API_KEY ? "ollama" : "gemini";

export type OllamaStatus = { available: boolean; model: string | null; reason?: string; provider?: Provider };

/** Estado de la IA configurada (el nombre se conserva por compatibilidad con las rutas). */
export async function ollamaStatus(): Promise<OllamaStatus> {
  return PROVIDER === "gemini" ? geminiStatus() : localStatus();
}

let geminiCache: { at: number; value: OllamaStatus } | null = null;

async function geminiStatus(): Promise<OllamaStatus> {
  if (geminiCache && Date.now() - geminiCache.at < (geminiCache.value.available ? 300_000 : 20_000)) {
    return geminiCache.value;
  }
  let value: OllamaStatus;
  try {
    const res = await fetch(`${GEMINI_BASE}/models?pageSize=1000`, {
      headers: { "x-goog-api-key": GEMINI_API_KEY },
      signal: AbortSignal.timeout(5000),
    });
    if (res.status === 400 || res.status === 401 || res.status === 403) {
      value = { available: false, model: null, provider: "gemini", reason: "La clave de Gemini no es válida o no tiene permiso." };
    } else if (!res.ok) {
      value = { available: false, model: null, provider: "gemini", reason: `Gemini respondió con el código ${res.status}.` };
    } else {
      const data = (await res.json()) as { models?: { name: string; supportedGenerationMethods?: string[] }[] };
      const names = (data.models || [])
        .filter((m) => (m.supportedGenerationMethods || []).includes("generateContent"))
        .map((m) => m.name.replace(/^models\//, ""));
      // Si el modelo pedido ya no existe, se usa otro Flash estable.
      const model =
        names.find((n) => n === GEMINI_MODEL) ||
        names.find((n) => n === "gemini-3.5-flash") ||
        names.find((n) => /^gemini-\d+(?:\.\d+)?-flash$/.test(n)) ||
        null;
      value = model
        ? { available: true, model, provider: "gemini" }
        : { available: false, model: null, provider: "gemini", reason: `El modelo ${GEMINI_MODEL} no está disponible.` };
    }
  } catch {
    value = { available: false, model: null, provider: "gemini", reason: "No hay conexión con Gemini (revisa internet)." };
  }
  geminiCache = { at: Date.now(), value };
  return value;
}

type Msg = { role: string; content: string };
type GenOpts = { temperature: number; topP?: number; maxTokens: number };

/** Gemini: el sistema va aparte, los roles son user/model y deben alternarse empezando por user. */
function geminiBody(messages: Msg[], opts: GenOpts, thinking: object | null) {
  const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const contents: { role: "user" | "model"; parts: { text: string }[] }[] = [];
  for (const m of messages) {
    if (m.role === "system") continue;
    const role = m.role === "assistant" ? "model" : "user";
    if (!contents.length && role === "model") continue;
    const last = contents[contents.length - 1];
    if (last && last.role === role) last.parts[0].text += "\n\n" + m.content;
    else contents.push({ role, parts: [{ text: m.content }] });
  }
  return {
    ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
    contents,
    generationConfig: {
      temperature: opts.temperature,
      ...(opts.topP ? { topP: opts.topP } : {}),
      // Margen amplio: la extensión real la fija el prompt; así no se corta a mitad de frase.
      maxOutputTokens: Math.max(opts.maxTokens * 3, 600),
      ...(thinking ? { thinkingConfig: thinking } : {}),
    },
    // Los relatos describen agresiones o abusos reales: solo se bloquea lo de riesgo alto.
    safetySettings: [
      "HARM_CATEGORY_HARASSMENT",
      "HARM_CATEGORY_HATE_SPEECH",
      "HARM_CATEGORY_SEXUALLY_EXPLICIT",
      "HARM_CATEGORY_DANGEROUS_CONTENT",
    ].map((category) => ({ category, threshold: "BLOCK_ONLY_HIGH" })),
  };
}

/**
 * Razonamiento mínimo para responder rápido. Cada familia de modelos acepta un ajuste distinto:
 * se prueba en orden y se recuerda el que funcionó para no repetir el intento.
 */
const THINKING_OPTIONS: (object | null)[] = [{ thinkingBudget: 0 }, { thinkingLevel: "low" }, null];
const thinkingByModel = new Map<string, number>();

async function geminiFetch(model: string, method: string, messages: Msg[], opts: GenOpts, signal?: AbortSignal) {
  let i = thinkingByModel.get(model) ?? 0;
  for (;;) {
    const res = await fetch(`${GEMINI_BASE}/models/${model}:${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_API_KEY },
      body: JSON.stringify(geminiBody(messages, opts, THINKING_OPTIONS[i])),
      signal,
    });
    if (res.status === 400 && i < THINKING_OPTIONS.length - 1) {
      i++;
      continue;
    }
    if (res.ok) thinkingByModel.set(model, i);
    return res;
  }
}

type GeminiChunk = {
  candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[];
  error?: { message?: string };
};

function geminiText(json: GeminiChunk): string {
  return (json.candidates?.[0]?.content?.parts || [])
    .filter((p) => !p.thought)
    .map((p) => p.text || "")
    .join("");
}

/** Texto en streaming, sin filtrar, del proveedor configurado. */
async function* streamChat(model: string, messages: Msg[], opts: GenOpts, signal?: AbortSignal): AsyncGenerator<string> {
  if (PROVIDER === "gemini") {
    const res = await geminiFetch(model, "streamGenerateContent?alt=sse", messages, opts, signal);
    if (!res.ok || !res.body) {
      if (res.status === 429) geminiCache = null;
      throw new Error(`Gemini respondió con el código ${res.status}.`);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let pending = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      pending += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = pending.indexOf("\n")) >= 0) {
        const line = pending.slice(0, nl).trim();
        pending = pending.slice(nl + 1);
        if (!line.startsWith("data:")) continue;
        let json: GeminiChunk;
        try {
          json = JSON.parse(line.slice(5));
        } catch {
          continue;
        }
        if (json.error) throw new Error(json.error.message || "Error de Gemini");
        const text = geminiText(json);
        if (text) yield text;
      }
    }
    return;
  }

  const body = {
    model,
    messages,
    stream: true,
    think: false,
    keep_alive: "15m",
    options: { temperature: opts.temperature, top_p: opts.topP ?? 0.9, num_ctx: 4096, num_predict: opts.maxTokens },
  };
  let res = await ollamaPost(body, signal);
  if (res.status === 400) {
    // Modelos sin modo de razonamiento rechazan el parámetro "think".
    const { think: _omit, ...rest } = body;
    void _omit;
    res = await ollamaPost(rest, signal);
  }
  if (!res.ok || !res.body) throw new Error(`Ollama respondió con el código ${res.status}.`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    pending += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = pending.indexOf("\n")) >= 0) {
      const line = pending.slice(0, nl).trim();
      pending = pending.slice(nl + 1);
      if (!line) continue;
      let json: { message?: { content?: string }; error?: string };
      try {
        json = JSON.parse(line);
      } catch {
        continue;
      }
      if (json.error) throw new Error(json.error);
      if (json.message?.content) yield json.message.content;
    }
  }
}

/** Una sola respuesta completa. Devuelve null si el proveedor falla. */
async function completeChat(model: string, messages: Msg[], opts: GenOpts, signal?: AbortSignal): Promise<string | null> {
  if (PROVIDER === "gemini") {
    const res = await geminiFetch(model, "generateContent", messages, opts, signal);
    if (!res.ok) return null;
    return geminiText((await res.json()) as GeminiChunk).trim();
  }
  const body = {
    model,
    messages,
    stream: false,
    think: false,
    keep_alive: "15m",
    options: { temperature: opts.temperature, num_ctx: 4096, num_predict: opts.maxTokens },
  };
  let res = await ollamaPost(body, signal);
  if (res.status === 400) {
    const { think: _omit, ...rest } = body;
    void _omit;
    res = await ollamaPost(rest, signal);
  }
  if (!res.ok) return null;
  const json = (await res.json()) as { message?: { content?: string } };
  return (json.message?.content || "").replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}

function ollamaPost(payload: object, signal?: AbortSignal) {
  return fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal,
  });
}

async function localStatus(): Promise<OllamaStatus> {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(1500) });
    if (!res.ok) return { available: false, model: null, reason: "Ollama respondió con un error." };
    const data = (await res.json()) as { models?: { name: string }[] };
    const names = (data.models || []).map((m) => m.name);
    if (!names.length) {
      return { available: false, model: null, reason: "Ollama no tiene modelos instalados." };
    }
    const model =
      names.find((n) => n === OLLAMA_MODEL) ||
      names.find((n) => n.startsWith(OLLAMA_MODEL.split(":")[0])) ||
      names.find((n) => !/embed/i.test(n)) ||
      null;
    return model
      ? { available: true, model, provider: "ollama" }
      : { available: false, model: null, provider: "ollama", reason: "No hay un modelo de conversación instalado." };
  } catch {
    return { available: false, model: null, provider: "ollama", reason: "Ollama no está en ejecución en este equipo." };
  }
}

/** Contexto que la persona decide compartir al iniciar el chat. */
export type AskerProfile = { group: string; community: string; territory: string };

export type Retrieval = { topics: Topic[]; hits: Hit[]; sources: ChatSource[] };

export function retrieve(
  message: string,
  previousUserMessage = "",
  profile?: AskerProfile,
): Retrieval {
  // Las preguntas de seguimiento cortas ("¿y quién la hace?") heredan el tema anterior.
  const short = queryTerms(message).length < 3;
  const query = short && previousUserMessage ? `${previousUserMessage} ${message}` : message;
  const topics = detectTopics(query);
  const hits = searchChunks(query, {
    topicIds: topics.map((t) => t.id),
    limit: 6,
    // Los apartados que mencionan a su pueblo o territorio ganan prioridad, sin excluir los demás.
    boostText: profile ? profile.community + " " + profile.territory : "",
  });
  const sources: ChatSource[] = hits.map((h, i) => ({
    n: i + 1,
    documentId: h.documentId,
    chunkId: h.chunkId,
    title: h.title,
    entity: h.entity,
    docType: h.docType,
    docDate: h.docDate,
    heading: h.heading || `Fragmento ${h.ord + 1}`,
    excerpt: excerpt(h.content, query),
    officialUrl: h.officialUrl,
  }));
  return { topics, hits, sources };
}

const SYSTEM_PROMPT = `Eres RAIZIA, un asistente de orientación jurídica para comunidades y personas en Colombia. Hablas con respeto, calidez y palabras sencillas, como quien explica a un vecino.

Reglas obligatorias:
1. Responde ÚNICAMENTE con la información de las FUENTES numeradas que recibes. No uses conocimiento externo.
2. Cada dato jurídico debe llevar la cita de su fuente entre corchetes, por ejemplo [1] o [2]. Cita solo números de fuentes que existan.
3. Nunca inventes normas, artículos, sentencias, fechas, plazos ni entidades. Solo menciona los que aparezcan escritos en las fuentes.
4. Si las fuentes no bastan para responder, dilo con claridad y explica solo lo que sí dicen.
5. Formato: empieza con una respuesta directa de dos o tres frases. Después, si ayuda, una lista corta con los puntos clave. Termina con "Qué puedes hacer" solo si las fuentes indican pasos concretos.
6. Sé breve (máximo 160 palabras). No repitas la pregunta ni copies párrafos largos.
7. Es orientación general, no asesoría legal definitiva.
8. Las sentencias resuelven casos concretos: preséntalas como "en un caso parecido, la Corte decidió…". No asegures que el caso de la persona se resolverá igual ni califiques como ilegal la conducta de nadie.`;

export type ConversationKind = "charla" | "sin_fuentes";

const SMALL_TALK =
  /^[¡¿\s]*(?:hola+|buen[oa]s(?:\s+(?:d[ií]as|tardes|noches))?|saludos|hey|qu[eé] tal|c[oó]mo est[aá]s?|(?:muchas\s+)?gracias|ok(?:ay)?|vale|listo|de acuerdo|entiendo|perfecto|adi[oó]s|chao|hasta luego|qui[eé]n eres|qu[eé] eres|qu[eé] (?:puedes|sabes) hacer|c[oó]mo funcionas?|para qu[eé] sirves|c[oó]mo me (?:puedes )?ayudas?|ayuda|necesito ayuda|tengo una (?:duda|pregunta|consulta))\b/i;

/** Saludos, agradecimientos y preguntas sobre el propio asistente: no requieren buscar documentos. */
export function isSmallTalk(message: string): boolean {
  return SMALL_TALK.test(message.trim()) && queryTerms(message).length <= 2 && message.length < 90;
}

/** Respuesta fija para saludar cuando la IA local no está disponible. */
export const STATIC_GREETING =
  "Hola. Soy RAIZIA. En este momento la inteligencia artificial no está disponible, pero puedo buscar en la biblioteca de documentos oficiales: cuéntame tu situación y te muestro los apartados relacionados.";

const CONVERSATION_PROMPT = `Eres RAIZIA, un asistente de orientación jurídica para comunidades y personas en Colombia. Hablas con respeto, calidez y palabras sencillas.

En este turno NO tienes documentos de respaldo, así que solo conversas. Reglas obligatorias:
1. Responde breve (máximo 70 palabras) y de forma natural, como en una conversación.
2. No des información jurídica: no menciones leyes, artículos, sentencias, plazos, trámites ni entidades competentes. No inventes nada.
3. Si la persona saluda o agradece, responde con amabilidad e invítala a contar su situación.
4. Si pregunta quién eres o qué haces: explica que buscas en documentos oficiales colombianos ya revisados (leyes, decretos y sentencias) y respondes con palabras sencillas citando la fuente; que también hay una biblioteca para leer los documentos y herramientas para preparar escritos como el derecho de petición o la tutela.
5. Si dice que necesita ayuda sin dar detalles, hazle una o dos preguntas concretas: qué pasó, quién está involucrado, dónde y cuándo.`;

const NO_SOURCES_RULE = `
6. La persona hizo una consulta, pero en la biblioteca no hay documentos aprobados que la respalden. Díselo con claridad y sin rodeos, NO intentes responder el fondo, y hazle una o dos preguntas concretas para entender mejor su situación o sugiérele contarla con otras palabras.`;

function buildConversation(
  message: string,
  history: { role: "user" | "assistant"; content: string }[],
  kind: ConversationKind,
  profile?: AskerProfile,
) {
  const past = history.slice(-6).map((m) => ({ role: m.role, content: m.content.slice(0, 500) }));
  return [
    { role: "system", content: CONVERSATION_PROMPT + (kind === "sin_fuentes" ? NO_SOURCES_RULE : "") },
    ...past,
    { role: "user", content: describeAsker(profile).replace(/ Ten en cuenta[^\n]*/, "") + message },
  ];
}

function describeAsker(profile?: AskerProfile): string {
  if (!profile?.group) return "";
  const parts = [profile.group];
  if (profile.community) parts.push("pueblo o comunidad: " + profile.community);
  if (profile.territory) parts.push("territorio: " + profile.territory);
  return (
    "QUIÉN CONSULTA (dato que la persona compartió): " +
    parts.join("; ") +
    ". Ten en cuenta este contexto al explicar, pero no afirmes sobre su pueblo o territorio nada que no esté en las fuentes.\n\n"
  );
}

function buildMessages(
  message: string,
  hits: Hit[],
  history: { role: "user" | "assistant"; content: string }[],
  profile?: AskerProfile,
) {
  const context = hits
    .map((h, i) => {
      const where = [h.title, h.heading].filter(Boolean).join(" — ");
      return `[${i + 1}] ${where}\n${h.content.slice(0, 950)}`;
    })
    .join("\n\n");
  const past = history.slice(-4).map((m) => ({
    role: m.role,
    content: m.content.slice(0, 600),
  }));
  return [
    { role: "system", content: SYSTEM_PROMPT },
    ...past,
    {
      role: "user",
      content: `${describeAsker(profile)}FUENTES:\n${context}\n\nPREGUNTA: ${message}\n\nResponde en español sencillo, citando las fuentes con [número].`,
    },
  ];
}

/** Genera la respuesta en streaming. Emite fragmentos de texto ya limpios. */
export async function* generateAnswer(
  model: string,
  message: string,
  hits: Hit[],
  history: { role: "user" | "assistant"; content: string }[],
  signal?: AbortSignal,
  profile?: AskerProfile,
  conversation?: ConversationKind,
): AsyncGenerator<string> {
  const messages = conversation
    ? buildConversation(message, history, conversation, profile)
    : buildMessages(message, hits, history, profile);
  const opts: GenOpts = conversation
    ? { temperature: 0.4, topP: 0.9, maxTokens: 220 }
    : { temperature: 0.2, topP: 0.9, maxTokens: 420 };

  let inThink = false;
  let carry = "";
  {
    for await (const piece of streamChat(model, messages, opts, signal)) {
      let text = carry + piece;
      carry = "";
      // Descarta bloques <think>…</think> si el modelo los emite dentro del contenido.
      let out = "";
      while (text) {
        if (inThink) {
          const end = text.indexOf("</think>");
          if (end < 0) {
            text = "";
          } else {
            inThink = false;
            text = text.slice(end + 8).replace(/^\s+/, "");
          }
        } else {
          const start = text.indexOf("<think>");
          if (start >= 0) {
            out += text.slice(0, start);
            inThink = true;
            text = text.slice(start + 7);
          } else {
            const partial = text.lastIndexOf("<");
            if (partial >= 0 && "<think>".startsWith(text.slice(partial))) {
              out += text.slice(0, partial);
              carry = text.slice(partial);
            } else {
              out += text;
            }
            text = "";
          }
        }
      }
      if (out) yield out;
    }
  }
  if (carry) yield carry;
}

const ORGANIZE_PROMPTS = {
  hechos: `Ordenas relatos para documentos jurídicos en Colombia. La persona puede escribir con errores o mezclar ideas porque el español no es su primera lengua.

Tarea: reescribe SU relato como una lista de hechos, uno por línea, en español claro y respetuoso, en primera persona y en orden de tiempo cuando sea posible.

Reglas obligatorias:
1. No agregues ningún hecho, fecha, nombre, lugar, cifra, norma ni conclusión que la persona no haya dicho.
2. No quites información que la persona dio.
3. Si algo no se entiende, déjalo con sus mismas palabras.
4. No des consejos, opiniones ni explicaciones.
5. Devuelve solo la lista: una línea por hecho, sin numeración, sin título y sin texto adicional.`,
  peticiones: `Ordenas solicitudes para documentos jurídicos en Colombia. La persona puede escribir con errores porque el español no es su primera lengua.

Tarea: reescribe lo que la persona pide como una lista de solicitudes concretas, una por línea, en español claro y respetuoso. Cada línea empieza con "Que".

Reglas obligatorias:
1. No agregues solicitudes, fechas, nombres, cifras ni normas que la persona no haya dicho.
2. No quites nada de lo que pidió.
3. Si algo no se entiende, déjalo con sus mismas palabras.
4. No des consejos ni explicaciones.
5. Devuelve solo la lista: una línea por solicitud, sin numeración, sin título y sin texto adicional.`,
};

/** Reescribe el relato en líneas claras. Devuelve "" si el resultado no es confiable. */
export async function organizeNarrative(
  model: string,
  text: string,
  kind: "hechos" | "peticiones",
  signal?: AbortSignal,
): Promise<string> {
  const reply = await completeChat(
    model,
    [
      { role: "system", content: ORGANIZE_PROMPTS[kind] },
      { role: "user", content: text },
    ],
    { temperature: 0.1, maxTokens: 700 },
    signal,
  );
  if (reply === null) return "";
  const lines = reply
    .split(/\r?\n+/)
    .map((l) => l.replace(/^\s*(?:[-•*]|\d+[.)])\s*/, "").replace(/\*\*/g, "").trim())
    .filter(Boolean);
  const out = lines.join("\n");
  // Si el modelo se extendió mucho más que el relato original, pudo haber añadido contenido: se descarta.
  if (!out || out.length > text.length * 2 + 200) return "";
  return out;
}

const PROBE_PROMPTS = {
  hechos: `Lees el relato de una persona que prepara un escrito para una entidad o un juez en Colombia. El español puede no ser su primera lengua.

Decide si falta información importante para entender el caso: cuándo ocurrió, dónde ocurrió, quién lo hizo o qué respuesta recibió.
- Si falta, escribe como máximo 2 preguntas cortas y muy sencillas, una por línea, para pedir SOLO lo que falta.
- No preguntes lo que ya dijo. No des consejos ni explicaciones.
- Si no falta nada importante, responde exactamente: COMPLETO`,
  peticiones: `Lees lo que una persona quiere pedir en un escrito para una entidad o un juez en Colombia. El español puede no ser su primera lengua.

Decide si queda claro qué quiere exactamente que hagan, entreguen o respondan.
- Si no queda claro, escribe como máximo 2 preguntas cortas y muy sencillas, una por línea, para aclararlo.
- No preguntes lo que ya dijo. No des consejos ni sugieras qué pedir.
- Si está claro, responde exactamente: COMPLETO`,
};

/** Preguntas de seguimiento (0 a 2) para completar el relato antes de redactarlo. */
export async function probeNarrative(
  model: string,
  text: string,
  kind: "hechos" | "peticiones",
  signal?: AbortSignal,
): Promise<string[]> {
  const content = await completeChat(
    model,
    [
      { role: "system", content: PROBE_PROMPTS[kind] },
      { role: "user", content: text },
    ],
    { temperature: 0.1, maxTokens: 120 },
    signal,
  );
  if (content === null) return [];
  if (/^\s*COMPLETO/i.test(content)) return [];
  return content
    .split(/\r?\n+|(?<=\?)\s+(?=¿)/)
    .map((l) => l.replace(/^\s*(?:[-•*]|\d+[.)])\s*/, "").replace(/\*\*/g, "").trim())
    .filter((l) => l.endsWith("?") && l.length < 160)
    .filter((q) => !alreadyAnswered(q, text))
    .slice(0, 2);
}

/** Descarta preguntas sobre algo que el relato ya dice (el modelo pequeño tiende a repetirlas). */
function alreadyAnswered(question: string, text: string): boolean {
  const months = "enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre";
  const checks: [RegExp, RegExp][] = [
    [
      /cu[aá]ndo|fecha/i,
      new RegExp(`\\b(?:19|20)\\d{2}\\b|\\b(?:${months})\\b|hace\\s+\\S+\\s+(?:d[ií]as?|semanas?|mes(?:es)?|a[nñ]os?)|\\bayer\\b`, "i"),
    ],
    [/d[oó]nde|lugar/i, /vereda|municipio|resguardo|barrio|corregimiento|territorio|comunidad de/i],
    [/respuesta|respond|contest/i, /respond|contest|dijeron|dijo que|negaron|rechaz/i],
    [/qui[eé]n/i, /empresa|alcald|entidad|gobernaci|funcionari|eps\b|hospital|m[aá]quina|se[nñ]or/i],
  ];
  return checks.some(([about, present]) => about.test(question) && present.test(text));
}

/** Pregunta breve a la IA local con una sola respuesta (sin streaming). */
export async function askOnce(
  model: string,
  system: string,
  user: string,
  maxTokens: number,
  signal?: AbortSignal,
): Promise<string> {
  const reply = await completeChat(
    model,
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    { temperature: 0, maxTokens },
    signal,
  );
  return reply ?? "";
}
