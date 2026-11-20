/**
 * Procesamiento documental: extracción de texto (PDF, DOCX, HTML) y
 * fragmentación en apartados citables.
 */
import * as cheerio from "cheerio";

export type Extracted = { text: string; title: string; kind: "pdf" | "docx" | "html" | "txt" };
export type Chunk = { heading: string; content: string };

export function detectKind(fileName: string, mime: string): Extracted["kind"] | null {
  const ext = fileName.toLowerCase().split(".").pop() || "";
  if (mime.includes("pdf") || ext === "pdf") return "pdf";
  if (mime.includes("wordprocessingml") || ext === "docx") return "docx";
  if (mime.includes("html") || ext === "html" || ext === "htm") return "html";
  if (mime.startsWith("text/plain") || ext === "txt") return "txt";
  return null;
}

export async function extractText(
  buffer: Buffer,
  kind: Extracted["kind"],
  charsetHint = "",
): Promise<Extracted> {
  if (kind === "pdf") {
    const { extractText: pdfText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const { text } = await pdfText(pdf, { mergePages: false });
    const pages = (text as string[]).map((p, i) => `[[pág. ${i + 1}]]\n${p}`);
    return { text: normalize(pages.join("\n\n")), title: "", kind };
  }
  if (kind === "docx") {
    const mammoth = (await import("mammoth")).default;
    const { value } = await mammoth.extractRawText({ buffer });
    return { text: normalize(value), title: "", kind };
  }
  if (kind === "html") {
    const html = decodeHtml(buffer, charsetHint);
    const $ = cheerio.load(html);
    const title = clean($("title").first().text()) || clean($("h1").first().text());
    $("script,style,noscript,nav,header,footer,form,iframe,svg,button,select,aside").remove();
    $("br").replaceWith("\n");
    $("p,div,li,tr,h1,h2,h3,h4,h5,h6,blockquote,section,article,table,center,pre").each((_, el) => {
      $(el).append("\n");
    });
    // Usa el contenedor del documento cuando el sitio lo distingue del menú y el pie de página.
    const bodyText = $("body").text();
    let rootText = bodyText;
    for (const sel of [".descripcion-contenido", "article", "main"]) {
      const t = $(sel).first().text();
      if (t.length > 1500 && t.length > bodyText.length * 0.3) {
        rootText = t;
        break;
      }
    }
    return { text: normalize(rootText), title, kind };
  }
  return { text: normalize(buffer.toString("utf8")), title: "", kind };
}

/**
 * Normaliza un HTML descargado a UTF-8. El juego de caracteres real viene en la
 * cabecera HTTP y se pierde al guardar el archivo; así se conserva de forma estable.
 */
export function toUtf8Html(buffer: Buffer, charsetHint = ""): Buffer {
  const html = decodeHtml(buffer, charsetHint);
  return Buffer.from(`<!-- charset=utf-8 · copia normalizada por RAIZIA -->
${html}`, "utf8");
}

function decodeHtml(buffer: Buffer, charsetHint: string): string {
  const head = buffer.subarray(0, 4096).toString("latin1");
  const m = /charset\s*=\s*["']?([\w-]+)/i.exec(charsetHint) || /charset\s*=\s*["']?([\w-]+)/i.exec(head);
  let charset = (m?.[1] || "utf-8").toLowerCase();
  if (charset === "iso-8859-1" || charset === "latin1") charset = "windows-1252";
  try {
    return new TextDecoder(charset).decode(buffer);
  } catch {
    return buffer.toString("utf8");
  }
}

function clean(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

export function normalize(text: string): string {
  return text
    .replace(/\r/g, "")
    .replace(/ /g, " ")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/(\p{L})-\n(\p{Ll})/gu, "$1$2")
    .split("\n")
    .map((l) => l.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const MAX = 1200;
const MIN = 200;

const ART_START = /^(?:ART[ÍI]CULO|Art[íi]culo)\s+((?:\d+[\w-]*|transitorio|[úu]nico|primero|segundo|tercero|cuarto|quinto)(?:\s+transitorio)?)\s*[°ºo]?\s*[.:\-–—]/i;
const SECTION_START =
  /^(?:T[ÍI]TULO|CAP[ÍI]TULO|SECCI[ÓO]N|LIBRO|PARTE|PRE[ÁA]MBULO|CONSIDERANDO|RESUELVE|DECRETA|ANTECEDENTES|CONSIDERACIONES|FUNDAMENTOS|DECISI[ÓO]N|HECHOS|S[ÍI]NTESIS|SALVAMENTO|ACLARACI[ÓO]N|DISPOSICIONES|DE LOS|DE LAS|DEL|DE LA)\b/;
const NUMBERED_SECTION = /^(?:T[ÍI]TULO|CAP[ÍI]TULO|SECCI[ÓO]N|LIBRO|PARTE)\b/;

/**
 * Divide el texto en fragmentos de ~1200 caracteres, respetando artículos
 * y títulos para que cada cita indique el apartado de donde proviene.
 */
const JUDICIAL_SECTION =
  /^(?:[IVX]+\.?\s*|\d+\.?\s*)?(ANTECEDENTES|CONSIDERACIONES|FUNDAMENTOS|DECISI[ÓO]N|RESUELVE|HECHOS|S[ÍI]NTESIS|SALVAMENTO|ACLARACI[ÓO]N|COMPETENCIA|PRUEBAS|CASO CONCRETO|PROBLEMA JUR[ÍI]DICO)\b/;

export function chunkText(text: string, options: { judicial?: boolean } = {}): Chunk[] {
  // En sentencias y autos los artículos que aparecen son citas de otras normas:
  // solo se usan como encabezado las partes propias de la providencia.
  const judicial = options.judicial ?? /\b(?:Sentencia|Auto)\s+(?:No\.?\s*)?(?:SU|T|C|A)?[-\s]?\d+/i.test(text.slice(0, 500));
  // Asegura que cada artículo comience en su propia línea (útil en PDF).
  const prepared = text.replace(/[ \t]+(?=ART[ÍI]CULO\s+\d+[\w-]*\s*[°ºo]?\s*\.)/g, "\n");
  const paras = prepared
    .split(/\n+/)
    .map((p) => p.trim())
    .filter(Boolean);

  const chunks: Chunk[] = [];
  let section = "";
  let article = "";
  let page = "";
  let buf = "";
  let awaitingName = false;

  const heading = () => [section, article || page].filter(Boolean).join(" · ");
  const flush = () => {
    const content = buf.trim();
    buf = "";
    // Un artículo corto ("Derogado.") también es contenido: nunca se descarta texto.
    if (!content) return;
    const last = chunks[chunks.length - 1];
    const h = heading();
    if (last && last.heading === h && last.content.length + content.length < MIN * 2) {
      last.content += "\n" + content;
    } else {
      chunks.push({ heading: h, content });
    }
  };

  for (const p of paras) {
    const pg = /^\[\[(pág\. \d+)\]\]$/.exec(p);
    if (pg) {
      if (!article) flush();
      page = pg[1];
      continue;
    }
    const art = judicial ? null : ART_START.exec(p);
    if (judicial) {
      if (p.length < 110 && p === p.toUpperCase() && JUDICIAL_SECTION.test(p)) {
        flush();
        section = titleCase(p.replace(/^(?:[IVX]+|\d+)\.?\s*/, ""));
      }
    } else if (art) {
      flush();
      article = `Artículo ${art[1].toLowerCase()}`;
      awaitingName = false;
    } else if (p.length < 110 && p === p.toUpperCase() && /\p{L}{3}/u.test(p)) {
      if (awaitingName && !SECTION_START.test(p.replace(/^(?:DE LOS|DE LAS|DEL|DE LA)\b/, "x"))) {
        // Nombre del título o capítulo recién anunciado ("CAPÍTULO I" + "DERECHO DE PETICIÓN…").
        section = `${section}: ${titleCase(p)}`.slice(0, 110);
        awaitingName = false;
      } else if (SECTION_START.test(p)) {
        flush();
        section = titleCase(p);
        article = "";
        awaitingName = NUMBERED_SECTION.test(p);
      }
    } else {
      awaitingName = false;
    }

    for (const piece of splitLong(p)) {
      if (buf && buf.length + piece.length + 1 > MAX) flush();
      buf += (buf ? "\n" : "") + piece;
    }
  }
  flush();
  return chunks;
}

function splitLong(p: string): string[] {
  if (p.length <= MAX) return [p];
  const sentences = p.split(/(?<=[.;:])\s+(?=[A-ZÁÉÍÓÚÑ(“"])/);
  const out: string[] = [];
  let cur = "";
  for (const s of sentences) {
    if (cur.length + s.length + 1 > MAX && cur) {
      out.push(cur);
      cur = "";
    }
    if (s.length > MAX) {
      for (let i = 0; i < s.length; i += MAX) out.push(s.slice(i, i + MAX));
    } else {
      cur += (cur ? " " : "") + s;
    }
  }
  if (cur) out.push(cur);
  return out;
}

function titleCase(s: string): string {
  const t = s
    .toLowerCase()
    .replace(/[.:\s]+$/g, "")
    .replace(/\.(?=\s)/g, "")
    .replace(/\b(?=[ivx])x{0,3}(?:ix|iv|v?i{0,3})\b/g, (m) => m.toUpperCase());
  return (t.charAt(0).toUpperCase() + t.slice(1)).slice(0, 90);
}
