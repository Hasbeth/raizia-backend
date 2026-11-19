/**
 * Generación de borradores en Word (.docx).
 *
 * Cada herramienta define un esquema (`OUTLINES`): destinatario, referencia,
 * párrafo inicial y bloques. El contenido proviene de lo que escribió la persona;
 * las únicas referencias jurídicas que se agregan son las normas básicas de cada
 * mecanismo, verificadas contra los textos oficiales de la biblioteca.
 */
import { AlignmentType, Document, Packer, Paragraph, TextRun } from "docx";
import { TOOLS, type ToolData } from "./tools-config";

const FONT = "Arial";
const SIZE = 24; // 12 pt
const GREY = "6B6B6B";

type Block = {
  h: string;
  /** Lista numerada (una entrada por línea escrita por la persona). */
  numbered?: string[];
  /** Párrafos corridos (antes de la lista). */
  text?: string[];
  /** Párrafos corridos después de la lista. */
  after?: string[];
  /** Líneas cortas alineadas a la izquierda (datos de contacto, fichas). */
  lines?: string[];
  /** Texto guía entre corchetes cuando la persona no diligenció el bloque. */
  placeholder?: string;
};

type Outline = {
  title: string;
  /** Líneas del destinatario; las que empiezan por "*" van en negrita. */
  addressee: string[];
  reference: string[];
  intro: string;
  blocks: Block[];
};

const str = (v: unknown) => (Array.isArray(v) ? v.join(", ") : String(v ?? "")).trim();
const lines = (v: unknown) =>
  str(v)
    .split(/\r?\n+/)
    .map((l) => l.replace(/^\s*(?:[-•*]|\d+[.)])\s*/, "").trim())
    .filter(Boolean);
const list = (v: unknown) => (Array.isArray(v) ? v.map(String) : lines(v));
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

function p(
  text: string,
  opts: { bold?: boolean; align?: "left" | "justify"; after?: number; italics?: boolean; indent?: number; size?: number; color?: string } = {},
) {
  return new Paragraph({
    alignment: opts.align === "left" ? AlignmentType.LEFT : AlignmentType.JUSTIFIED,
    spacing: { after: opts.after ?? 200, line: 300 },
    indent: opts.indent ? { left: opts.indent } : undefined,
    children: [
      new TextRun({ text, bold: opts.bold, italics: opts.italics, font: FONT, size: opts.size ?? SIZE, color: opts.color }),
    ],
  });
}

function today(): string {
  return new Date().toLocaleDateString("es-CO", { day: "numeric", month: "long", year: "numeric" });
}

function identity(d: ToolData): string {
  const calidad = str(d.calidad);
  const comunidad = str(d.comunidad);
  let actua = "actuando en nombre propio";
  if (calidad.startsWith("Como autoridad")) {
    actua = `actuando como autoridad o representante${comunidad ? ` de ${comunidad}` : " de mi comunidad"}`;
  } else if (calidad.startsWith("En representación")) {
    actua = `actuando en representación${comunidad ? ` de ${comunidad}` : " de otra persona"}`;
  } else if (comunidad) {
    actua = `actuando en nombre propio, integrante de ${comunidad}`;
  }
  return `${str(d.nombre)}, con ${str(d.tipoDocumento).toLowerCase()} número ${str(d.numeroDocumento)}, ${actua}`;
}

function contactLines(d: ToolData): string[] {
  return [
    str(d.direccion) && `Dirección: ${str(d.direccion)}`,
    str(d.correo) && `Correo electrónico: ${str(d.correo)}`,
    str(d.telefono) && `Teléfono: ${str(d.telefono)}`,
  ].filter(Boolean) as string[];
}

const entityAddressee = (d: ToolData) => [
  "Señores",
  `*${str(d.entidad).toUpperCase()}`,
  str(d.funcionario),
  str(d.ciudadEntidad),
];

const judgeAddressee = (d: ToolData, judge: string) => ["Señor(a)", `*${judge}`, str(d.ciudad)];

const ART_23 =
  "Artículo 23 de la Constitución Política, que reconoce a toda persona el derecho a presentar peticiones respetuosas a las autoridades y a obtener pronta resolución.";
const GENERAL_TERM =
  "toda petición debe resolverse dentro de los quince (15) días siguientes a su recepción, salvo norma legal especial";
const PETITION_TERMS: Record<string, string> = {
  "Solicitud de información":
    "las peticiones de documentos y de información deben resolverse dentro de los diez (10) días siguientes a su recepción",
  "Solicitud de documentos o copias":
    "las peticiones de documentos y de información deben resolverse dentro de los diez (10) días siguientes a su recepción",
  "Consulta a la entidad":
    "las peticiones mediante las cuales se eleva una consulta a las autoridades en relación con las materias a su cargo deben resolverse dentro de los treinta (30) días siguientes a su recepción",
};
const law1755 = (term = GENERAL_TERM) =>
  `Ley 1755 de 2015, que regula el derecho fundamental de petición. De acuerdo con su artículo 14, ${term}.`;
const LEGAL_GAP = "Espacio para complementar con apoyo jurídico: este borrador no incluye jurisprudencia ni argumentos adicionales.";

const notifications = (d: ToolData): Block => ({
  h: "NOTIFICACIONES",
  text: ["Recibiré respuesta y notificaciones en:"],
  lines: contactLines(d),
});

const partiesNotifications = (d: ToolData, label: string): Block => ({
  h: "NOTIFICACIONES",
  lines: [
    "*Accionante:",
    ...contactLines(d),
    `*${label}:`,
    str(d.contactoAccionado) || `[Indique la dirección o el correo de ${str(d.accionado) || "la parte accionada"}.]`,
  ],
});

const OUTLINES: Record<string, (d: ToolData) => Outline> = {
  peticion: (d) => {
    const tipo = str(d.tipoPeticion);
    return {
      title: "Derecho de petición",
      addressee: entityAddressee(d),
      reference: [`*Asunto: Derecho de petición — ${lower(tipo)}`],
      intro: `Yo, ${identity(d)}, en ejercicio del derecho fundamental de petición consagrado en el artículo 23 de la Constitución Política y regulado por la Ley 1755 de 2015, presento respetuosamente la siguiente petición:`,
      blocks: [
        { h: "HECHOS", numbered: lines(d.hechos) },
        { h: "PETICIONES", numbered: lines(d.peticiones) },
        { h: "FUNDAMENTOS DE DERECHO", text: [ART_23, law1755(PETITION_TERMS[tipo])] },
        { h: "ANEXOS", numbered: lines(d.anexos) },
        notifications(d),
      ],
    };
  },

  "consulta-previa": (d) => ({
    title: "Solicitud sobre consulta previa",
    addressee: entityAddressee(d),
    reference: ["*Asunto: Derecho de petición — solicitud relacionada con el derecho a la consulta previa"],
    intro: `Yo, ${identity(d)}, en ejercicio del derecho fundamental de petición (artículo 23 de la Constitución Política y Ley 1755 de 2015) y con fundamento en el Convenio 169 de la OIT, aprobado por la Ley 21 de 1991, presento respetuosamente la siguiente solicitud:`,
    blocks: [
      {
        h: "PROYECTO, OBRA, ACTIVIDAD O MEDIDA",
        text: lines(d.proyecto),
        lines: [
          str(d.responsableProyecto) && `Quien lo adelanta: ${str(d.responsableProyecto)}`,
          `Lugar: ${str(d.ubicacion)}`,
        ].filter(Boolean) as string[],
      },
      { h: "HECHOS Y AFECTACIÓN A LA COMUNIDAD", numbered: lines(d.hechos) },
      { h: "PETICIONES", numbered: lines(d.peticiones) },
      {
        h: "FUNDAMENTOS DE DERECHO",
        text: [
          "Artículo 7 de la Constitución Política, según el cual el Estado reconoce y protege la diversidad étnica y cultural de la Nación.",
          "Artículo 6 del Convenio 169 de la OIT, aprobado por la Ley 21 de 1991, que establece el deber de consultar a los pueblos interesados cada vez que se prevean medidas legislativas o administrativas susceptibles de afectarles directamente.",
          "Parágrafo del artículo 330 de la Constitución Política, sobre la participación de los representantes de las comunidades indígenas en las decisiones relativas a la explotación de recursos naturales en sus territorios.",
          ART_23,
          law1755(),
        ],
      },
      { h: "ANEXOS", numbered: lines(d.anexos) },
      notifications(d),
    ],
  }),

  reclamacion: (d) => {
    const popular = str(d.tipoReclamacion).startsWith("Antes de una acción popular");
    return {
      title: "Reclamación previa a la autoridad",
      addressee: entityAddressee(d),
      reference: [
        popular
          ? "*Asunto: Solicitud de medidas de protección de derechos e intereses colectivos (artículo 144 de la Ley 1437 de 2011)"
          : "*Asunto: Solicitud de cumplimiento de un deber legal o administrativo (artículo 8 de la Ley 393 de 1997)",
      ],
      intro: popular
        ? `Yo, ${identity(d)}, solicito respetuosamente que se adopten las medidas necesarias para proteger los derechos e intereses colectivos amenazados o vulnerados por los hechos que expongo a continuación:`
        : `Yo, ${identity(d)}, reclamo respetuosamente el cumplimiento del deber legal o administrativo que se indica a continuación, con el propósito de constituir la renuencia en caso de que no sea atendido:`,
      blocks: [
        ...(popular || !str(d.norma) ? [] : [{ h: "NORMA O ACTO ADMINISTRATIVO CUYO CUMPLIMIENTO SE RECLAMA", text: lines(d.norma) }]),
        { h: "HECHOS", numbered: lines(d.hechos) },
        { h: "SOLICITUDES", numbered: lines(d.peticiones) },
        {
          h: "FUNDAMENTOS DE DERECHO",
          text: [
            ART_23,
            popular
              ? "Artículo 144 de la Ley 1437 de 2011, según el cual, antes de presentar la demanda para la protección de los derechos e intereses colectivos, debe solicitarse a la autoridad que adopte las medidas necesarias de protección; si la autoridad no atiende la reclamación dentro de los quince (15) días siguientes a la presentación de la solicitud o se niega a ello, podrá acudirse ante el juez."
              : "Artículo 8 de la Ley 393 de 1997, según el cual la acción de cumplimiento requiere que previamente se haya reclamado el cumplimiento del deber legal o administrativo y que la autoridad se haya ratificado en su incumplimiento o no haya contestado dentro de los diez (10) días siguientes a la presentación de la solicitud.",
          ],
        },
        { h: "ANEXOS", numbered: lines(d.anexos) },
        notifications(d),
      ],
    };
  },

  acompanamiento: (d) => {
    const entidad = str(d.entidad);
    return {
      title: "Solicitud de acompañamiento",
      addressee: entityAddressee(d),
      reference: ["*Asunto: Solicitud de orientación y acompañamiento"],
      intro: `Yo, ${identity(d)}, acudo respetuosamente a esa entidad para solicitar su orientación y acompañamiento frente a la situación que expongo a continuación:`,
      blocks: [
        { h: "HECHOS", numbered: lines(d.hechos) },
        { h: "SOLICITUDES", numbered: lines(d.peticiones) },
        {
          h: "FUNDAMENTOS DE DERECHO",
          text: [
            ART_23,
            "Artículo 118 de la Constitución Política, según el cual al Ministerio Público corresponde la guarda y promoción de los derechos humanos, la protección del interés público y la vigilancia de la conducta oficial de quienes desempeñan funciones públicas.",
            ...(entidad.startsWith("Defensoría")
              ? [
                  "Artículo 282 de la Constitución Política, que asigna al Defensor del Pueblo, entre otras funciones, la de orientar e instruir a los habitantes del territorio nacional en el ejercicio y defensa de sus derechos.",
                ]
              : []),
          ],
        },
        { h: "ANEXOS", numbered: lines(d.anexos) },
        notifications(d),
      ],
    };
  },

  tutela: (d) => ({
    title: "Acción de tutela",
    addressee: judgeAddressee(d, "JUEZ CONSTITUCIONAL (REPARTO)"),
    reference: ["*Referencia: Acción de tutela", `Accionante: ${str(d.nombre)}`, `Accionado: ${str(d.accionado)}`],
    intro: `Yo, ${identity(d)}, acudo ante su despacho para interponer acción de tutela contra ${str(d.accionado)}, con fundamento en el artículo 86 de la Constitución Política y el Decreto 2591 de 1991, con el fin de que se protejan los derechos fundamentales que considero vulnerados o amenazados, de acuerdo con lo siguiente:`,
    blocks: [
      { h: "HECHOS", numbered: lines(d.hechos) },
      {
        h: "DERECHOS FUNDAMENTALES QUE SE CONSIDERAN VULNERADOS O AMENAZADOS",
        numbered: [...list(d.derechos), ...lines(d.otroDerecho)],
        after: lines(d.explicacion),
      },
      { h: "ACTUACIONES PREVIAS", numbered: lines(d.actuaciones) },
      { h: "PRETENSIONES", text: ["Con base en los hechos expuestos, solicito respetuosamente:"], numbered: lines(d.pretensiones) },
      {
        h: "FUNDAMENTOS DE DERECHO",
        text: [
          "Artículo 86 de la Constitución Política, que establece la acción de tutela para reclamar ante los jueces la protección inmediata de los derechos constitucionales fundamentales.",
          "Decreto 2591 de 1991, que reglamenta la acción de tutela.",
          "Las normas que reconocen los derechos señalados en este escrito, indicadas junto a cada uno de ellos.",
        ],
        placeholder: LEGAL_GAP,
      },
      { h: "PRUEBAS", numbered: lines(d.pruebas), placeholder: "Relacione aquí los documentos y demás pruebas que adjunta." },
      {
        h: "JURAMENTO",
        text: [
          "Manifiesto bajo la gravedad del juramento que no he presentado otra acción de tutela respecto de los mismos hechos y derechos, conforme al artículo 37 del Decreto 2591 de 1991.",
        ],
      },
      partiesNotifications(d, "Accionado"),
    ],
  }),

  popular: (d) => ({
    title: "Acción popular",
    addressee: judgeAddressee(d, "JUEZ (REPARTO)"),
    reference: ["*Referencia: Acción popular", `Accionante: ${str(d.nombre)}`, `Accionado: ${str(d.accionado)}`],
    intro: `Yo, ${identity(d)}, acudo ante su despacho para interponer acción popular contra ${str(d.accionado)}, con fundamento en el artículo 88 de la Constitución Política y la Ley 472 de 1998, con el fin de que se protejan los derechos e intereses colectivos amenazados o vulnerados, de acuerdo con lo siguiente:`,
    blocks: [
      { h: "HECHOS, ACCIONES U OMISIONES QUE MOTIVAN LA ACCIÓN", numbered: lines(d.hechos) },
      {
        h: "DERECHOS E INTERESES COLECTIVOS AMENAZADOS O VULNERADOS",
        text: ["De los previstos en el artículo 4 de la Ley 472 de 1998:"],
        numbered: [...list(d.derechos), ...lines(d.otroDerecho)],
        after: lines(d.explicacion),
      },
      {
        h: "RECLAMACIÓN PREVIA",
        text: [...lines(d.reclamacion), ...lines(d.urgencia)],
        placeholder:
          "Si la acción se dirige contra una autoridad, indique aquí la fecha y el resultado de la solicitud previa de medidas de protección (artículo 144 de la Ley 1437 de 2011) o sustente por qué se prescinde de ella.",
      },
      { h: "PRETENSIONES", text: ["Con base en los hechos expuestos, solicito respetuosamente:"], numbered: lines(d.pretensiones) },
      {
        h: "FUNDAMENTOS DE DERECHO",
        text: [
          "Artículo 88 de la Constitución Política, que prevé las acciones populares para la protección de los derechos e intereses colectivos.",
          "Ley 472 de 1998, que desarrolla el ejercicio de las acciones populares y, en su artículo 4, enuncia los derechos e intereses colectivos.",
          "Artículo 144 de la Ley 1437 de 2011, sobre la protección de los derechos e intereses colectivos.",
        ],
        placeholder: LEGAL_GAP,
      },
      { h: "PRUEBAS", numbered: lines(d.pruebas), placeholder: "Relacione aquí las pruebas que pretende hacer valer." },
      partiesNotifications(d, "Presunto responsable"),
    ],
  }),

  cumplimiento: (d) => ({
    title: "Acción de cumplimiento",
    addressee: judgeAddressee(d, "JUEZ ADMINISTRATIVO (REPARTO)"),
    reference: ["*Referencia: Acción de cumplimiento", `Accionante: ${str(d.nombre)}`, `Accionado: ${str(d.accionado)}`],
    intro: `Yo, ${identity(d)}, con residencia en ${str(d.ciudad)}, acudo ante su despacho para interponer acción de cumplimiento contra ${str(d.accionado)}, con fundamento en el artículo 87 de la Constitución Política y la Ley 393 de 1997, de acuerdo con lo siguiente:`,
    blocks: [
      { h: "NORMA CON FUERZA DE LEY O ACTO ADMINISTRATIVO INCUMPLIDO", text: lines(d.norma) },
      { h: "HECHOS CONSTITUTIVOS DEL INCUMPLIMIENTO", numbered: lines(d.hechos) },
      { h: "RENUENCIA", text: lines(d.renuencia) },
      { h: "PRETENSIONES", text: ["Con base en lo expuesto, solicito respetuosamente:"], numbered: lines(d.pretensiones) },
      {
        h: "FUNDAMENTOS DE DERECHO",
        text: [
          "Artículo 87 de la Constitución Política, según el cual toda persona podrá acudir ante la autoridad judicial para hacer efectivo el cumplimiento de una ley o un acto administrativo.",
          "Ley 393 de 1997, que desarrolla la acción de cumplimiento.",
        ],
        placeholder: LEGAL_GAP,
      },
      {
        h: "PRUEBAS",
        numbered: lines(d.pruebas),
        placeholder: "Relacione aquí las pruebas, incluida la prueba de la renuencia y, si se trata de un acto administrativo, su copia.",
      },
      {
        h: "JURAMENTO",
        text: [
          "Manifiesto bajo la gravedad del juramento que no he presentado otra solicitud respecto de los mismos hechos o derechos ante ninguna otra autoridad, conforme al artículo 10 de la Ley 393 de 1997.",
        ],
      },
      partiesNotifications(d, "Accionado"),
    ],
  }),

  grupo: (d) => ({
    title: "Ficha de preparación — acción de grupo",
    addressee: ["*FICHA DE PREPARACIÓN DEL CASO", "*ACCIÓN DE GRUPO (Ley 472 de 1998)"],
    reference: [],
    intro:
      "Este documento organiza la información del caso para presentarla a un abogado, a la Defensoría del Pueblo o a la personería. No es una demanda: la acción de grupo debe ejercerse por conducto de abogado.",
    blocks: [
      { h: "PERSONA QUE COORDINA AL GRUPO", text: [`${identity(d)}.`], lines: contactLines(d) },
      {
        h: "GRUPO AFECTADO",
        lines: [`Número aproximado de personas: ${str(d.numeroPersonas)}`],
        text: ["Criterios que identifican al grupo:", ...lines(d.criterios)],
      },
      { h: "PRESUNTO RESPONSABLE", text: [str(d.accionado)] },
      { h: "HECHOS (CAUSA COMÚN DEL DAÑO)", numbered: lines(d.hechos) },
      { h: "FECHA DEL DAÑO O DE SU CESACIÓN", text: [str(d.fechaDano)] },
      {
        h: "PERJUICIOS",
        text: lines(d.perjuicios),
        lines: str(d.estimacion) ? [`Valor estimado: ${str(d.estimacion)}`] : [],
      },
      { h: "PRUEBAS DISPONIBLES", numbered: lines(d.pruebas), placeholder: "Relacione aquí los documentos y pruebas con que cuenta el grupo." },
      {
        h: "MARCO LEGAL BÁSICO (LEY 472 DE 1998)",
        numbered: [
          "Artículo 46: la acción de grupo se ejerce exclusivamente para obtener el reconocimiento y pago de la indemnización de los perjuicios; el grupo debe estar integrado al menos por veinte personas.",
          "Artículo 47: debe promoverse dentro de los dos (2) años siguientes a la fecha en que se causó el daño o cesó la acción vulnerante causante del mismo.",
          "Artículo 48: el Defensor del Pueblo y los personeros municipales y distritales pueden interponerla en nombre de cualquier persona que se lo solicite o que se encuentre en situación de desamparo o indefensión.",
          "Artículo 49: las acciones de grupo deben ejercerse por conducto de abogado.",
        ],
      },
    ],
  }),
};

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];

/** Convierte un esquema en párrafos de Word. Los bloques vacíos y sin texto guía se omiten. */
function render(outline: Outline, d: ToolData): Paragraph[] {
  const mark = (line: string, after = 60) =>
    line.startsWith("*") ? p(line.slice(1), { bold: true, align: "left", after }) : p(line, { align: "left", after });

  const out: Paragraph[] = [p(`${str(d.ciudad)}, ${today()}`, { align: "left", after: 400 })];
  outline.addressee.filter(Boolean).forEach((l) => out.push(mark(l)));
  out.push(p("", { after: 120 }));
  outline.reference.forEach((l) => out.push(mark(l)));
  if (outline.reference.length) out.push(p("", { after: 120 }));
  out.push(p(outline.intro));

  let n = 0;
  for (const b of outline.blocks) {
    const text = (b.text || []).filter(Boolean);
    const numbered = (b.numbered || []).filter(Boolean);
    const short = (b.lines || []).filter(Boolean);
    const after = (b.after || []).filter(Boolean);
    const hasContent = text.length + numbered.length + short.length + after.length > 0;
    if (!hasContent && !b.placeholder) continue;
    out.push(p(`${ROMAN[n++]}. ${b.h}`, { bold: true, align: "left", after: 160 }));
    text.forEach((t) => out.push(p(t)));
    numbered.forEach((t, i) => out.push(p(`${i + 1}. ${t}`, { indent: 360, after: 140 })));
    after.forEach((t) => out.push(p(t)));
    short.forEach((t) => out.push(mark(t, 80)));
    const needsGuide = b.placeholder && (b.h === "FUNDAMENTOS DE DERECHO" || !hasContent);
    if (needsGuide) out.push(p(`[${b.placeholder}]`, { italics: true, color: GREY }));
  }

  out.push(
    p("", { after: 120 }),
    p("Atentamente,", { align: "left", after: 700 }),
    p("______________________________", { align: "left", after: 60 }),
    p(str(d.nombre), { bold: true, align: "left", after: 60 }),
    p(`${str(d.tipoDocumento)} n.º ${str(d.numeroDocumento)}`, { align: "left", after: 60 }),
    p("", { after: 120 }),
    p(
      "Nota (elimínala antes de presentar el documento): borrador elaborado con RAIZIA a partir de la información suministrada por la persona interesada. Debe revisarse y ajustarse antes de su presentación. No constituye asesoría jurídica.",
      { italics: true, size: 18, color: GREY, after: 0 },
    ),
  );
  return out;
}

export async function buildDocument(kind: string, d: ToolData): Promise<Buffer> {
  const make = OUTLINES[kind];
  if (!make || !TOOLS[kind]) throw new Error(`Herramienta desconocida: ${kind}`);
  const outline = make(d);
  const doc = new Document({
    creator: "RAIZIA",
    title: outline.title,
    description: "Borrador generado con RAIZIA",
    styles: { default: { document: { run: { font: FONT, size: SIZE } } } },
    sections: [
      {
        properties: { page: { margin: { top: 1418, bottom: 1418, left: 1701, right: 1418 } } },
        children: render(outline, d),
      },
    ],
  });
  return Packer.toBuffer(doc);
}
