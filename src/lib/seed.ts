/**
 * Colección inicial de documentos oficiales.
 *
 * Cada entrada apunta a una dirección oficial verificada. Antes de guardar se
 * comprueba que el texto descargado corresponda al documento esperado (`expect`);
 * si no coincide, se descarta. Nada se inventa: si una fuente no responde, se informa.
 */
import { get } from "./db";
import { createDocument } from "./documents";
import { fetchOfficial, ImportError } from "./fetcher";
import { detectKind, extractText, toUtf8Html } from "./ingest";
import { SEED_NORMAS } from "./seed-normas";

export type SeedSource = {
  url: string;
  title: string;
  entity: string;
  docType: string;
  docDate: string;
  summary: string;
  categories: string[];
  expect: RegExp;
};

const FP = (i: number) => `https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=${i}`;
const CC = (path: string) => `https://www.corteconstitucional.gov.co/relatoria/${path}`;

const CONGRESO = "Congreso de la República";
const PRESIDENCIA = "Presidencia de la República";
const CORTE = "Corte Constitucional";

export const SEED_SOURCES: SeedSource[] = [
  {
    url: FP(4125),
    title: "Constitución Política de Colombia de 1991",
    entity: "Asamblea Nacional Constituyente",
    docType: "Constitución",
    docDate: "1991",
    summary: "Norma superior del país. Reconoce la diversidad étnica y cultural, los derechos fundamentales y los mecanismos para protegerlos.",
    categories: ["derechos-fundamentales", "derechos-colectivos-autonomia", "gobierno-propio-jurisdiccion"],
    expect: /constituci[óo]n pol[íi]tica/i,
  },
  {
    url: FP(37032),
    title: "Ley 21 de 1991 — Aprueba el Convenio 169 de la OIT sobre pueblos indígenas y tribales",
    entity: CONGRESO,
    docType: "Ley",
    docDate: "1991",
    summary: "Incorpora a la legislación colombiana el Convenio 169 de la OIT, base del derecho a la consulta previa.",
    categories: ["territorio-consulta-previa", "derechos-colectivos-autonomia"],
    expect: /ley 21 de 1991/i,
  },
  {
    url: FP(65334),
    title: "Ley 1755 de 2015 — Derecho fundamental de petición",
    entity: CONGRESO,
    docType: "Ley",
    docDate: "2015",
    summary: "Regula cómo presentar peticiones ante las autoridades y los plazos que tienen para responder.",
    categories: ["procedimientos-administrativos", "derechos-fundamentales"],
    expect: /ley 1755 de 2015/i,
  },
  {
    url: FP(5304),
    title: "Decreto 2591 de 1991 — Reglamenta la acción de tutela",
    entity: PRESIDENCIA,
    docType: "Decreto",
    docDate: "1991",
    summary: "Establece cómo se presenta y se tramita la acción de tutela.",
    categories: ["derechos-fundamentales"],
    expect: /decreto 2591 de 1991/i,
  },
  {
    url: FP(188),
    title: "Ley 472 de 1998 — Acciones populares y de grupo",
    entity: CONGRESO,
    docType: "Ley",
    docDate: "1998",
    summary: "Desarrolla las acciones populares y de grupo para la defensa de los derechos e intereses colectivos.",
    categories: ["derechos-colectivos-autonomia", "derecho-ambiental"],
    expect: /ley 472 de 1998/i,
  },
  {
    url: FP(297),
    title: "Ley 99 de 1993 — Sistema Nacional Ambiental",
    entity: CONGRESO,
    docType: "Ley",
    docDate: "1993",
    summary: "Crea el Ministerio del Medio Ambiente y organiza el Sistema Nacional Ambiental, incluidas las licencias ambientales.",
    categories: ["derecho-ambiental"],
    expect: /ley 99 de 1993/i,
  },
  {
    url: FP(59636),
    title: "Decreto 1953 de 2014 — Funcionamiento de los territorios indígenas",
    entity: PRESIDENCIA,
    docType: "Decreto",
    docDate: "2014",
    summary: "Crea un régimen especial para poner en funcionamiento los territorios indígenas y la administración de sus sistemas propios.",
    categories: ["gobierno-propio-jurisdiccion", "territorio-consulta-previa", "educacion-salud"],
    expect: /decreto 1953 de 2014/i,
  },
  {
    url: FP(4920),
    title: "Ley 89 de 1890 — Cabildos y resguardos indígenas",
    entity: CONGRESO,
    docType: "Ley",
    docDate: "1890",
    summary: "Norma histórica sobre la organización de los cabildos y los resguardos indígenas.",
    categories: ["gobierno-propio-jurisdiccion"],
    expect: /ley 89 de 1890/i,
  },
  {
    url: FP(59594),
    title: "Decreto 2164 de 1995 — Dotación y titulación de tierras a comunidades indígenas",
    entity: PRESIDENCIA,
    docType: "Decreto",
    docDate: "1995",
    summary: "Reglamenta la constitución, reestructuración, ampliación y saneamiento de los resguardos indígenas.",
    categories: ["territorio-consulta-previa"],
    expect: /decreto 2164 de 1995/i,
  },
  {
    url: FP(1377),
    title: "Decreto 804 de 1995 — Atención educativa para grupos étnicos",
    entity: PRESIDENCIA,
    docType: "Decreto",
    docDate: "1995",
    summary: "Reglamenta la atención educativa para grupos étnicos (etnoeducación).",
    categories: ["educacion-salud", "derechos-culturales"],
    expect: /decreto 804 de 1995/i,
  },
  {
    url: FP(4454),
    title: "Ley 691 de 2001 — Participación de los grupos étnicos en el sistema de salud",
    entity: CONGRESO,
    docType: "Ley",
    docDate: "2001",
    summary: "Reglamenta la participación de los grupos étnicos en el Sistema General de Seguridad Social en Salud.",
    categories: ["educacion-salud"],
    expect: /ley 691 de 2001/i,
  },
  {
    url: FP(38741),
    title: "Ley 1381 de 2010 — Lenguas nativas",
    entity: CONGRESO,
    docType: "Ley",
    docDate: "2010",
    summary: "Dicta normas sobre el reconocimiento, fomento, protección y uso de las lenguas de los grupos étnicos.",
    categories: ["derechos-culturales"],
    expect: /ley 1381 de 2010/i,
  },
  {
    url: FP(60733),
    title: "Ley Estatutaria 1751 de 2015 — Derecho fundamental a la salud",
    entity: CONGRESO,
    docType: "Ley",
    docDate: "2015",
    summary: "Regula el derecho fundamental a la salud.",
    categories: ["educacion-salud", "derechos-fundamentales"],
    expect: /ley (estatutaria )?1751 de 2015/i,
  },
  {
    url: FP(338),
    title: "Ley 393 de 1997 — Acción de cumplimiento",
    entity: CONGRESO,
    docType: "Ley",
    docDate: "1997",
    summary: "Desarrolla la acción de cumplimiento para hacer efectivas las normas con fuerza de ley y los actos administrativos.",
    categories: ["procedimientos-administrativos", "derechos-colectivos-autonomia"],
    expect: /ley 393 de 1997/i,
  },
  {
    url: FP(330),
    title: "Ley 134 de 1994 — Mecanismos de participación ciudadana",
    entity: CONGRESO,
    docType: "Ley",
    docDate: "1994",
    summary: "Regula la iniciativa popular, el referendo, la consulta popular, la revocatoria del mandato, el plebiscito y el cabildo abierto.",
    categories: ["derechos-colectivos-autonomia"],
    expect: /ley 134 de 1994/i,
  },
  {
    url: FP(65335),
    title: "Ley Estatutaria 1757 de 2015 — Promoción y protección de la participación democrática",
    entity: CONGRESO,
    docType: "Ley",
    docDate: "2015",
    summary: "Dicta disposiciones sobre la promoción y protección del derecho a la participación democrática.",
    categories: ["derechos-colectivos-autonomia"],
    expect: /ley (estatutaria )?1757 de 2015/i,
  },
  {
    url: FP(10570),
    title: "Ley 850 de 2003 — Veedurías ciudadanas",
    entity: CONGRESO,
    docType: "Ley",
    docDate: "2003",
    summary: "Reglamenta las veedurías ciudadanas para vigilar la gestión pública.",
    categories: ["derechos-colectivos-autonomia"],
    expect: /ley 850 de 2003/i,
  },
  {
    url: FP(41249),
    title: "Ley 1437 de 2011 — Código de Procedimiento Administrativo y de lo Contencioso Administrativo",
    entity: CONGRESO,
    docType: "Ley",
    docDate: "2011",
    summary: "Regula las actuaciones ante las autoridades administrativas y los procesos ante la jurisdicción de lo contencioso administrativo.",
    categories: ["procedimientos-administrativos"],
    expect: /ley 1437 de 2011/i,
  },
  {
    url: CC("1997/SU039-97.htm"),
    title: "Sentencia SU-039 de 1997 — Consulta previa (pueblo U'wa)",
    entity: CORTE,
    docType: "Sentencia",
    docDate: "1997",
    summary: "Sentencia de unificación sobre el derecho de las comunidades indígenas a ser consultadas frente a la explotación de recursos naturales en sus territorios.",
    categories: ["jurisprudencia-constitucional", "territorio-consulta-previa", "derecho-ambiental"],
    expect: /SU[-\s]?039/i,
  },
  {
    url: CC("2018/SU123-18.htm"),
    title: "Sentencia SU-123 de 2018 — Reglas de unificación sobre consulta previa",
    entity: CORTE,
    docType: "Sentencia",
    docDate: "2018",
    summary: "Unifica criterios sobre cuándo procede la consulta previa y el concepto de afectación directa.",
    categories: ["jurisprudencia-constitucional", "territorio-consulta-previa"],
    expect: /SU[-\s]?123/i,
  },
  {
    url: CC("1993/T-380-93.htm"),
    title: "Sentencia T-380 de 1993 — Derechos fundamentales de la comunidad indígena",
    entity: CORTE,
    docType: "Sentencia",
    docDate: "1993",
    summary: "Reconoce a la comunidad indígena como sujeto colectivo de derechos fundamentales, en un caso de explotación forestal.",
    categories: ["jurisprudencia-constitucional", "derechos-colectivos-autonomia", "derecho-ambiental"],
    expect: /T[-\s]?380/i,
  },
  {
    url: CC("1996/C-139-96.htm"),
    title: "Sentencia C-139 de 1996 — Jurisdicción especial indígena",
    entity: CORTE,
    docType: "Sentencia",
    docDate: "1996",
    summary: "Revisa la constitucionalidad de artículos de la Ley 89 de 1890 y precisa el alcance de la jurisdicción indígena.",
    categories: ["jurisprudencia-constitucional", "gobierno-propio-jurisdiccion"],
    expect: /C[-\s]?139/i,
  },
  {
    url: CC("1994/T-254-94.htm"),
    title: "Sentencia T-254 de 1994 — Autonomía y jurisdicción indígena",
    entity: CORTE,
    docType: "Sentencia",
    docDate: "1994",
    summary: "Fija criterios sobre los límites y el alcance de la autonomía jurisdiccional de las comunidades indígenas.",
    categories: ["jurisprudencia-constitucional", "gobierno-propio-jurisdiccion"],
    expect: /T[-\s]?254/i,
  },
  {
    url: CC("2011/T-129-11.htm"),
    title: "Sentencia T-129 de 2011 — Consentimiento previo, libre e informado",
    entity: CORTE,
    docType: "Sentencia",
    docDate: "2011",
    summary: "Protege a resguardos Embera-Katío frente a obras y proyectos en su territorio y desarrolla el consentimiento previo, libre e informado.",
    categories: ["jurisprudencia-constitucional", "territorio-consulta-previa"],
    expect: /T[-\s]?129/i,
  },
  {
    url: CC("2016/T-622-16.htm"),
    title: "Sentencia T-622 de 2016 — Río Atrato como sujeto de derechos",
    entity: CORTE,
    docType: "Sentencia",
    docDate: "2016",
    summary: "Reconoce al río Atrato como sujeto de derechos y ordena medidas para su protección y la de las comunidades étnicas ribereñas.",
    categories: ["jurisprudencia-constitucional", "derecho-ambiental", "territorio-consulta-previa"],
    expect: /T[-\s]?622/i,
  },
  {
    url: CC("2014/T-849-14.htm"),
    title: "Sentencia T-849 de 2014 — Línea Negra y territorio ancestral de la Sierra Nevada",
    entity: CORTE,
    docType: "Sentencia",
    docDate: "2014",
    summary: "Protege el territorio ancestral delimitado por la Línea Negra de los pueblos de la Sierra Nevada de Santa Marta frente a una licencia ambiental otorgada sin consulta previa.",
    categories: ["jurisprudencia-constitucional", "territorio-consulta-previa"],
    expect: /T[-\s]?849/i,
  },
  {
    url: "https://www.defensoria.gov.co/documents/20123/3980270/boletin_pueblos_indigenas.pdf",
    title: "Boletín de la Defensoría del Pueblo sobre los derechos de los pueblos étnicos",
    entity: "Defensoría del Pueblo",
    docType: "Guía o informe",
    docDate: "",
    summary: "Boletín de la Defensoría del Pueblo sobre el contexto de los derechos de los pueblos étnicos.",
    categories: ["derechos-colectivos-autonomia"],
    expect: /pueblos\s+(?:[ée]tnicos|ind[íi]genas)/i,
  },
];

export type SeedEvent = {
  url: string;
  title: string;
  outcome: "importado" | "ya_existe" | "omitido" | "error";
  detail?: string;
};

function categoryIds(slugs: string[]): number[] {
  return slugs
    .map((s) => get<{ id: number }>("SELECT id FROM categories WHERE slug = ?", s)?.id)
    .filter((x): x is number => typeof x === "number");
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Descarga, verifica e indexa la colección inicial. Es seguro ejecutarlo varias veces. */
export async function* seedOfficialSources(): AsyncGenerator<SeedEvent> {
  for (const src of [...SEED_SOURCES, ...SEED_NORMAS]) {
    const base = { url: src.url, title: src.title };
    if (get("SELECT 1 AS x FROM documents WHERE official_url = ?", src.url)) {
      yield { ...base, outcome: "ya_existe" };
      continue;
    }
    try {
      const f = await fetchOfficial(src.url);
      const kind = detectKind(f.fileName, f.contentType);
      if (!kind) {
        yield { ...base, outcome: "omitido", detail: "Formato no admitido." };
        continue;
      }
      const { text } = await extractText(f.buffer, kind, f.contentType);
      if (text.length < 1500 || !src.expect.test(text.slice(0, 80000))) {
        yield {
          ...base,
          outcome: "omitido",
          detail: "El contenido descargado no corresponde al documento esperado.",
        };
        continue;
      }
      const res = await createDocument({
        buffer: f.buffer,
        fileName: f.fileName,
        mime: f.contentType,
        charsetHint: f.contentType,
        sourceKind: "url",
        meta: {
          title: src.title,
          entity: src.entity,
          docType: src.docType,
          docDate: src.docDate,
          officialUrl: src.url,
          summary: src.summary,
          categoryIds: categoryIds(src.categories),
          status: "aprobado",
          reviewNote:
            "Colección inicial: dirección oficial y encabezado verificados automáticamente. Pendiente de revisión jurídica humana.",
        },
      });
      yield {
        ...base,
        outcome: res.duplicate ? "ya_existe" : "importado",
        detail: res.duplicate ? undefined : `${res.document.chunkCount} fragmentos`,
      };
    } catch (e) {
      yield {
        ...base,
        outcome: "error",
        detail: e instanceof ImportError ? e.message : "No se pudo procesar el documento.",
      };
      if (!(e instanceof ImportError)) console.error("[seed]", src.url, e);
    }
    await wait(1200); // cortesía con los servidores oficiales
  }
  for (const src of MULTIPART_SOURCES) yield await importMultipart(src);
}

/* ------------- Documentos publicados en varias páginas (p. ej. Senado) ------------- */

type MultipartSource = Omit<SeedSource, "url"> & {
  /** Página inicial; las siguientes son <base>_pr001.html, _pr002.html… hasta la primera que falte. */
  base: string;
  maxParts: number;
};

const SENADO = "http://www.secretariasenado.gov.co/senado/basedoc/";

export const MULTIPART_SOURCES: MultipartSource[] = [
  {
    base: `${SENADO}codigo_civil`,
    maxParts: 120,
    title: "Ley 57 de 1887 — Código Civil",
    entity: CONGRESO,
    docType: "Ley",
    docDate: "1887",
    summary: "Regula las personas, la familia, los bienes, las sucesiones, los contratos y las obligaciones.",
    categories: ["otras-tematicas"],
    expect: /c[óo]digo civil/i,
  },
];

/** Descarga todas las partes, las une en un solo HTML y lo guarda como un documento. */
async function importMultipart(src: MultipartSource): Promise<SeedEvent> {
  const url = `${src.base}.html`;
  const base = { url, title: src.title };
  if (get("SELECT 1 AS x FROM documents WHERE official_url = ?", url)) return { ...base, outcome: "ya_existe" };
  try {
    const bodies: string[] = [];
    for (let n = 0; n <= src.maxParts; n++) {
      const partUrl = n === 0 ? url : `${src.base}_pr${String(n).padStart(3, "0")}.html`;
      let f;
      try {
        f = await fetchOfficial(partUrl);
      } catch (e) {
        if (n > 0 && e instanceof ImportError && /404/.test(e.message)) break; // fin de las partes
        throw e;
      }
      const html = toUtf8Html(f.buffer, f.contentType).toString("utf8");
      bodies.push(/<body[^>]*>([\s\S]*)<\/body>/i.exec(html)?.[1] ?? html);
      await wait(600);
    }
    const joined = Buffer.from(
      `<!doctype html><html><head><meta charset="utf-8"><title>${src.title}</title></head><body>${bodies.join("\n<hr>\n")}</body></html>`,
      "utf8",
    );
    const { text } = await extractText(joined, "html", "text/html; charset=utf-8");
    if (text.length < 1500 || !src.expect.test(text.slice(0, 80000))) {
      return { ...base, outcome: "omitido", detail: "El contenido descargado no corresponde al documento esperado." };
    }
    const res = await createDocument({
      buffer: joined,
      fileName: `${src.base.split("/").pop()}.html`,
      mime: "text/html; charset=utf-8",
      charsetHint: "text/html; charset=utf-8",
      sourceKind: "url",
      meta: {
        title: src.title,
        entity: src.entity,
        docType: src.docType,
        docDate: src.docDate,
        officialUrl: url,
        summary: src.summary,
        categoryIds: categoryIds(src.categories),
        status: "aprobado",
        reviewNote: `Colección inicial: ${bodies.length} páginas oficiales unidas en un documento. Pendiente de revisión jurídica humana.`,
      },
    });
    return { ...base, outcome: res.duplicate ? "ya_existe" : "importado", detail: `${bodies.length} partes, ${res.document.chunkCount} fragmentos` };
  } catch (e) {
    return { ...base, outcome: "error", detail: e instanceof ImportError ? e.message : "No se pudo procesar el documento." };
  }
}
