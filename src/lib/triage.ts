/**
 * Orientador: lee TODO el relato, reconoce los asuntos que contiene, los ordena
 * por peso y responde las dudas que la persona expresa.
 *
 * - Un relato puede traer varios asuntos (una obra sin consulta, daño al agua,
 *   intimidación…): cada uno suma señales y se muestran hasta tres caminos.
 * - Las rutas y las respuestas son un conjunto cerrado, redactado a mano y
 *   verificado contra los textos oficiales de la biblioteca. La IA no las escribe.
 */
import { TOOLS } from "./tools-config";

export type Route = {
  id: string;
  title: string;
  /** Qué entendió RAIZIA del relato (una frase). */
  issue: string;
  why: string;
  /** Pasos concretos, en orden. */
  steps: string[];
  /** Herramienta de RAIZIA que ayuda en este camino. */
  tool?: { slug: string; name: string; label: string };
};

export type Doubt = { q: string; a: string };

const tool = (kind: string, label: string) => ({ slug: TOOLS[kind].slug, name: TOOLS[kind].name, label });

type Step = string | { text: string; when: RegExp };
type RouteDef = Omit<Route, "steps"> & { steps: Step[] };

const DEFS: Record<string, RouteDef> = {
  "consulta-previa": {
    id: "consulta-previa",
    title: "Pedir información y exigir la consulta previa",
    issue: "Una obra o proyecto entró al territorio sin que nadie les explicara ni les preguntara.",
    why: "Cuando una obra o decisión afecta directamente a un pueblo indígena, el Estado debe consultarlo antes (Convenio 169 de la OIT, aprobado por la Ley 21 de 1991). Lo primero es saber qué obra es, quién la hace y con qué permiso.",
    steps: [
      "Hablen en el cabildo. La consulta se hace con las autoridades propias de la comunidad, así que conviene que la solicitud salga con su respaldo.",
      "Pidan por escrito que les informen qué obra es, quién la hace, con qué permiso y si se hizo consulta previa. Pedir información no cuesta nada ni necesita abogado.",
      "Dirijan la solicitud a la Dirección de la Autoridad Nacional de Consulta Previa del Ministerio del Interior. Si saben qué entidad dio el permiso, envíenla también allí.",
      "Pueden enviarla por correo electrónico: no hace falta viajar.",
      "Guarden las pruebas: fotos, videos, fechas y el nombre de la empresa.",
    ],
    tool: tool("consulta-previa", "Preparar la solicitud sobre consulta previa"),
  },
  popular: {
    id: "popular",
    title: "Proteger el agua, el bosque y lo que es de todos",
    issue: "El agua, el bosque u otro bien de toda la comunidad se está dañando.",
    why: "El agua y el ambiente son derechos de toda la comunidad. Cualquier persona puede pedir que se protejan, sin abogado.",
    steps: [
      "Avisen a la Corporación Autónoma Regional de su departamento, que es la autoridad ambiental: puede visitar el lugar y ordenar medidas.",
      "Pidan por escrito a esa autoridad que actúe. Si en quince días no lo hace, se puede acudir a un juez con una acción popular.",
      { text: "Si hay personas enfermas, llévenlas al puesto de salud y pidan que quede registrado: también sirve como prueba.", when: /enferm|estomago|diarrea|vomit|fiebre|brote/ },
      "Guarden fotos y videos del daño, con la fecha.",
    ],
    tool: tool("reclamacion", "Preparar la reclamación a la autoridad"),
  },
  proteccion: {
    id: "proteccion",
    title: "Si hay miedo, presión o intimidación",
    issue: "Hay personas presionando o intimidando a quienes reclaman.",
    why: "Nadie puede presionarlos para que dejen de reclamar. Pedir información y defender el territorio es un derecho.",
    steps: [
      "Cuéntenle lo ocurrido a la personería de su municipio o a la Defensoría del Pueblo. Orientan sin costo y pueden acompañar a la comunidad.",
      "Anoten la fecha, el lugar, lo que dijeron y cómo eran las personas. No enfrenten solos a nadie.",
      "Si hay una amenaza directa, denuncien ante la Fiscalía (en una sede o en la línea 122). Si hay peligro inmediato, llamen al 123.",
      "Si el riesgo continúa, la Unidad Nacional de Protección estudia medidas para líderes y comunidades.",
    ],
    tool: tool("acompanamiento", "Pedir acompañamiento a la Defensoría o a la personería"),
  },
  denuncia: {
    id: "denuncia",
    title: "Denunciar la agresión o el abuso",
    issue: "Hubo una agresión u otro hecho que puede ser un delito.",
    why: "Lo que cuentas puede ser un delito o un abuso de autoridad. Eso no se resuelve con una petición: se denuncia.",
    steps: [
      "Si estás en peligro ahora, llama a la línea de emergencias 123.",
      "Denuncia ante la Fiscalía General de la Nación, en una de sus sedes o en la línea 122. Cualquier persona puede denunciar y no cuesta nada.",
      { text: "Si te lastimaron, busca atención médica y pide que la lesión quede registrada.", when: /peg|golp|herid|lesion|lastim|sangr|agred|agresi|dispar/ },
      {
        text: "Como quien lo hizo es policía u otro funcionario, presenta además una queja ante la Procuraduría General de la Nación o la personería de tu municipio, que vigilan la conducta de los servidores públicos.",
        when: /polic|funcionari|soldado|ejercito|militar|inspector|guardia del inpec|alcalde/,
      },
      {
        text: "Si te insultaron o maltrataron por ser indígena, dilo en la denuncia: la discriminación por razones étnicas está sancionada por la ley (Ley 1482 de 2011).",
        when: /insult|discrimin|por ser indigena|\bindio\b|racis/,
      },
      "La Defensoría del Pueblo puede acompañarte sin costo.",
    ],
    tool: tool("acompanamiento", "Pedir acompañamiento a la Defensoría, la personería o la Procuraduría"),
  },
  tutela: {
    id: "tutela",
    title: "Acción de tutela",
    issue: "Un derecho fundamental, como la salud o la vida, está en riesgo y se necesita una respuesta rápida.",
    why: "La tutela sirve para que un juez proteja pronto un derecho fundamental cuando no hay otro camino eficaz.",
    steps: [
      "Se presenta ante cualquier juez y no necesita abogado.",
      "Si es una urgencia médica, acudan primero a urgencias.",
    ],
    tool: tool("tutela", "Preparar el borrador de tutela"),
  },
  cumplimiento: {
    id: "cumplimiento",
    title: "Exigir que se cumpla una norma o decisión",
    issue: "Una autoridad no está cumpliendo una ley o una decisión que ya existe.",
    why: "Existe una acción para que un juez ordene cumplir, pero antes hay que pedírselo directamente a la autoridad.",
    steps: ["Pidan por escrito a la autoridad que cumpla. Si se niega o no contesta en diez días, se puede acudir al juez."],
    tool: tool("reclamacion", "Preparar la reclamación a la autoridad"),
  },
  grupo: {
    id: "grupo",
    title: "Reclamar la indemnización de varias personas",
    issue: "Varias personas sufrieron perjuicios por la misma causa.",
    why: "Cuando veinte o más personas sufren daños por una misma causa, pueden reclamar juntas la indemnización con una acción de grupo.",
    steps: [
      "La acción de grupo la presenta un abogado. La Defensoría del Pueblo o la personería pueden hacerlo por ustedes.",
      "Hay dos años para presentarla desde que ocurrió el daño: no dejen pasar el tiempo.",
    ],
    tool: tool("grupo", "Preparar la ficha del caso"),
  },
  peticion: {
    id: "peticion",
    title: "Derecho de petición",
    issue: "Una entidad debe responder, informar, entregar un documento o hacer algo que le corresponde.",
    why: "Toda persona puede pedirle algo por escrito a una entidad, y la entidad está obligada a responder.",
    steps: ["Es gratuito, no necesita abogado y se puede enviar por correo electrónico."],
    tool: tool("peticion", "Preparar el derecho de petición"),
  },
  "justicia-propia": {
    id: "justicia-propia",
    title: "Autoridades propias de la comunidad",
    issue: "Parece un asunto entre miembros de la comunidad, dentro del territorio.",
    why: "Las autoridades de los pueblos indígenas pueden ejercer justicia dentro de su territorio, según sus normas y procedimientos (artículo 246 de la Constitución).",
    steps: ["Hablen primero con el cabildo o la autoridad tradicional de la comunidad."],
  },
  acompanamiento: {
    id: "acompanamiento",
    title: "Orientación y acompañamiento",
    issue: "Todavía no es claro qué documento conviene.",
    why: "Lo mejor es que una entidad que orienta sin costo revise el caso con ustedes.",
    steps: ["Pueden acudir a la personería de su municipio, a la Defensoría del Pueblo o a un consultorio jurídico universitario."],
    tool: tool("acompanamiento", "Pedir orientación y acompañamiento"),
  },
};

export const ROUTE_IDS = Object.keys(DEFS);

const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ") // los saltos de línea no deben separar frases que van juntas
    .replace(INNOCENT, " ")
    .replace(NOT_OFFICIAL, " ")
    .replace(NEGATED_NOUN, " ")
    .replace(NEGATED, " ");

/** "No me pegaron", "nunca nos amenazaron": lo negado no cuenta como señal. */
const NEGATED =
  /\b(?:no|nunca|ni|tampoco|sin que)\s+(?:(?:me|nos|le|les|lo|la|los|las|se)\s+)?(?:(?:ha|han|habia|habian|hemos)\s+)?(?:peg|golp|agred|insult|amenaz|maltrat|rob|lastim|herid|dispar|grit)\w*/g;
/** "No hubo insultos", "no recibimos amenazas". */
const NEGATED_NOUN =
  /\b(?:no|nunca|ni|tampoco)\s+(?:hubo|hay|habia|existio|recibi\w*|sufri\w*|tuv\w+)\s+(?:ningun[oa]?\s+|mas\s+)?(?:insult|golp|agresi|amenaz|lesion|herid|maltrat)\w*/g;
const NOT_OFFICIAL =
  /\bno (?:intervino|intervinieron|participo|participaron|estaba|estaban|llego|llegaron|vino|vinieron|fue|fueron|era|eran|es|son) (?:la |el |los |las |un |unos |ningun |ninguna )?(?:polici|funcionari|soldado|militar)\w*/g;
/** Expresiones que contienen una palabra clave pero hablan de otra cosa. */
const INNOCENT = /golpes? de (?:calor|suerte)|obras? de (?:teatro|arte|caridad)|obra (?:literaria|social|musical)/g;

const count =(t: string, cues: RegExp[]) => cues.filter((re) => re.test(t)).length;

/** Cada asunto suma una señal por cada pista distinta que aparece en el relato. */
const SCORERS: Record<string, (t: string) => number> = {
  "consulta-previa": (t) => {
    const project = count(t, [
      /maquin|retroexcav|buldoz|volqueta/,
      /empresa|proyecto|carretera|\bmina\b|mineri|represa|hidroelectr|torre|antena|exploracion|petrole|\bobra\b/,
    ]);
    const affected = count(t, [
      /nadie (nos )?(ha |habia )?(pregunt|consult|explic|venido)|sin (consult|pregunt)|no (nos )?(consult|pregunt|explic|avis)aron|consulta previa/,
      /\bmamos?\b|los mayores|sagrad|pagament|lugares? (que|importantes|de los mayores)|sitios? (sagrad|ancestral)/,
      /resguardo|territorio|cabildo|indigena|arhuac|kogui|wiwa|kankuam|wayuu|comunidad/,
      /tenian permiso|con permiso|licencia/,
    ]);
    return project && affected ? project + affected : 0;
  },
  popular: (t) =>
    count(t, [
      /tumb\w* (los |unos |muchos )?arboles|\btala(n|ron|ndo)?\b|deforest|quema/,
      /agua.{0,90}(turbi|suci|chocolate|contamin|barro|envenen)|(turbi|suci|contamin).{0,40}agua|baja (como chocolate|sucia|turbia)|aguas negras/,
      /quebrada|\brio\b|nacimiento|laguna|cienaga|manantial/,
      /contamin|basur|vertimiento|derrame|\bhumo\b|\b(?:mal )?olor(?:es)?\b/,
      /peces|animales muertos|se enferm|estomago|diarrea/,
    ]),
  proteccion: (t) =>
    count(t, [
      /amenaz|intimid|represali/,
      /tien(e|en) miedo|tenemos miedo|\bcon miedo\b|temor|asustad/,
      /nos busquen|buscar problemas|presentar problemas|dej(a|e)r(a|e)?mos trabajar|mejor (nos )?call/,
      /preguntando quienes|quien(es)? (era|eran|son|fue) (el|los) que|hombres (armados|desconocidos|extranos)/,
    ]),
  denuncia: (t) =>
    2 *
    count(t, [
      /\bpeg(o|aron|an|ar)\b|golp|agred|agresi|\bmat(o|aron|ar)\b|asesin|dispar|herid|lesion|lastim/,
      /\brob(o|aron|an)\b|hurt[oa]|secuestr|extors|\bviol(o|aron|acion)\b|acos[oa]/,
      /insult|maltrat|abus[oa]|discrimin|me gritaron|nos gritaron/,
    ]),
  tutela: (t) =>
    /tutela|(eps|hospital|clinica|medic).{0,60}(nieg|no (me |nos |le )?(da|dan|autoriz|atiend|entreg))|no (me |nos |le )?(autoriz|atiend|entreg).{0,60}(medicament|cita|cirugia|tratamiento|operacion)|en riesgo (la|mi|su) vida|se (va a|puede) morir/.test(
      t,
    )
      ? 3
      : 0,
  grupo: (t) =>
    /indemniz|(familias|personas|vecinos).{0,60}(perdi|perdimos|perdieron|destru).{0,60}(cultivo|casa|cosecha|animales|vivienda)/.test(t) ? 2 : 0,
  cumplimiento: (t) =>
    /no (se |le |les )?(cumple|cumplen|cumplio|cumplieron)|incumpl|no (aplica|aplican) (la|el) (ley|decreto|resolucion|acuerdo)/.test(t) ? 2 : 0,
  "justicia-propia": (t) =>
    /(vecino|comunero|familiar|pariente|miembro de la comunidad).{0,60}(pelea|lindero|deuda|discusion)|entre (familias|comuneros|vecinos)/.test(t) ? 2 : 0,
  peticion: (t) =>
    /(?:no|tampoco|nunca|nadie) (me |nos |le )?(respond|contest)|(pedir|pedimos|pedi|solicit).{0,50}(informacion|copia|documento|respuesta|arregl)|no hay (medico|profesor|docente|agua|luz|maestro)|puesto de salud|\bescuela\b|necesit(o|amos) (saber|copia|informacion|que nos)/.test(
      t,
    )
      ? 1
      : 0,
};

/** Ante empates, lo más urgente primero. */
const PRIORITY = ["denuncia", "tutela", "consulta-previa", "popular", "proteccion", "grupo", "cumplimiento", "justicia-propia", "peticion"];

/** Asuntos presentes en el relato, del más fuerte al más débil. */
export function triageByRules(story: string): string[] {
  const t = fold(story);
  return PRIORITY.map((id) => ({ id, score: SCORERS[id](t) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || PRIORITY.indexOf(a.id) - PRIORITY.indexOf(b.id))
    .map((x) => x.id);
}

/** Arma la ruta con los pasos que aplican a este relato (los condicionales solo si hay señal). */
export function buildRoute(id: string, story: string): Route {
  const def = DEFS[id];
  const t = fold(story);
  return {
    ...def,
    steps: def.steps.filter((s) => typeof s === "string" || s.when.test(t)).map((s) => (typeof s === "string" ? s : s.text)),
  };
}

/** Dudas frecuentes que la persona expresa en su relato, con respuestas verificadas. */
const DOUBTS: { when: RegExp; q: string; a: string }[] = [
  {
    when: /papeles? de (la|las) tierras?|sin (los )?papeles|titulo|escritura|demostrar que (esas |las )?tierras|tierras (eran|son) nuestras/,
    q: "¿Sin los papeles de la tierra ya no podemos reclamar?",
    a: "Sí pueden. Pedir información no exige demostrar que la tierra es suya. Además, el Convenio 169 de la OIT (Ley 21 de 1991, artículo 14) reconoce los derechos de los pueblos sobre las tierras que tradicionalmente ocupan, y la Corte Constitucional ha dicho que el territorio indígena incluye los lugares sagrados aunque estén fuera de los resguardos titulados (Sentencia T-849 de 2014).",
  },
  {
    when: /solamente el gobernador|solo el gobernador|tiene que hacer(lo)? (solamente |solo )?el (gobernador|cabildo)|miembro de la comunidad|uno como|cualquiera puede/,
    q: "¿Solo lo puede hacer el gobernador del cabildo?",
    a: "No. Cualquier persona puede pedir información y ayuda a una entidad (artículo 23 de la Constitución), y cualquier persona puede pedir que se protejan el agua y el ambiente (Ley 472 de 1998, artículo 12). Lo que sí se hace con las autoridades de la comunidad es la consulta previa: el Convenio 169 dice que se consulta a los pueblos a través de sus instituciones representativas. Por eso conviene actuar con el respaldo del cabildo.",
  },
  {
    when: /van a saber quien|saber quien fue|que no sepan|anonim|sin dar (mi|el) nombre|nos busquen/,
    q: "Si ponemos una queja, ¿van a saber quién fue?",
    a: "Un escrito firmado lleva el nombre de quien lo presenta, y la entidad o la empresa pueden llegar a conocerlo. Si hay miedo, lo más prudente es que lo presente el cabildo como autoridad, o pedirle a la Defensoría del Pueblo o a la personería que actúen y acompañen a la comunidad. Cuéntenles del temor para que lo tengan en cuenta.",
  },
  {
    when: /no ten(emos|go) (plata|dinero|recursos)|pagar (un )?abogado|sin abogado|viajar|no (podemos|puedo) ir (a|hasta)|cuesta/,
    q: "No tenemos plata para viajar ni para pagar abogado. ¿Qué hacemos?",
    a: "No la necesitan para empezar. El derecho de petición es gratuito y no requiere abogado (Ley 1755 de 2015), y puede enviarse por cualquier medio, incluido el correo electrónico. La tutela y la acción popular tampoco exigen abogado. La personería de su municipio y la Defensoría del Pueblo orientan sin costo.",
  },
];

export function answerDoubts(story: string): Doubt[] {
  const t = fold(story);
  return DOUBTS.filter((d) => d.when.test(t)).map(({ q, a }) => ({ q, a }));
}

/** Texto para que la IA local clasifique cuando no hay señales claras (conjunto cerrado). */
export const CLASSIFY_PROMPT = `Clasificas relatos de personas que buscan ayuda jurídica en Colombia. Responde SOLO con una palabra de esta lista:

denuncia: agresión, golpes, robo, abuso de policías o funcionarios, discriminación, cualquier posible delito.
tutela: un derecho fundamental en riesgo urgente, como salud o vida negadas por una EPS, hospital o entidad.
peticion: una entidad debe responder, informar, entregar un documento o hacer algo que le corresponde.
acompanamiento: no es claro o no encaja en lo anterior.`;

/** ¿La herramienta en la que está la persona sirve para alguno de los caminos sugeridos? */
export function toolFits(currentKind: string, routeIds: string[]): boolean {
  if (!routeIds.length || currentKind === "acompanamiento") return true;
  const covers: Record<string, string[]> = {
    peticion: ["peticion"],
    tutela: ["tutela"],
    "consulta-previa": ["consulta-previa"],
    reclamacion: ["popular", "cumplimiento"],
    popular: ["popular"],
    cumplimiento: ["cumplimiento"],
    grupo: ["grupo"],
  };
  return routeIds.some((id) => (covers[currentKind] || []).includes(id));
}
