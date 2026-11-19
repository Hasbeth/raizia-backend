/**
 * Categorías iniciales. Solo se usan para poblar una base de datos vacía;
 * después se administran desde el panel (nombre, palabras clave, subcategorías).
 * Las palabras clave ayudan al asistente a reconocer la temática de una consulta.
 */
export const SEED_CATEGORIES: {
  name: string;
  slug: string;
  description: string;
  keywords: string;
  children: { name: string; keywords?: string }[];
}[] = [
  {
    name: "Derechos colectivos y autonomía",
    slug: "derechos-colectivos-autonomia",
    description: "Libre determinación, participación y derechos que pertenecen a la comunidad.",
    keywords:
      "derechos colectivos, derecho colectivo, autonomía, libre determinación, autodeterminación, pueblo indígena, pueblos indígenas, comunidad, diversidad étnica, acción popular, acción de grupo, acción de cumplimiento, participación, participación ciudadana, veeduría, veedurías, cabildo abierto, consulta popular, referendo",
    children: [
      { name: "Libre determinación", keywords: "libre determinación, autodeterminación, autonomía, gobierno propio, plan de vida, planes de vida" },
      { name: "Acciones populares y de grupo", keywords: "acción popular, acciones populares, acción de grupo, derechos colectivos, intereses colectivos, acción de cumplimiento" },
      { name: "Participación", keywords: "participación, mecanismos de participación, veeduría, veedurías, cabildo abierto, concertación, mesa permanente, circunscripción" },
    ],
  },
  {
    name: "Territorio y consulta previa",
    slug: "territorio-consulta-previa",
    description: "Resguardos, tierras ancestrales y el derecho a ser consultados.",
    keywords:
      "territorio, territorios, resguardo, resguardos, tierra, tierras, consulta previa, consultar, consentimiento, convenio 169, titulación, ampliación, saneamiento, desalojo, despojo, línea negra, sitios sagrados, proyecto, obra, megaproyecto, hidroeléctrica, carretera, exploración, explotación",
    children: [
      { name: "Consulta previa", keywords: "consulta previa, consentimiento previo, consentimiento libre, convenio 169, afectación directa" },
      { name: "Resguardos y titulación", keywords: "resguardo, resguardos, titulación, saneamiento, ampliación, constitución de resguardos, propiedad colectiva" },
      { name: "Territorio ancestral y sitios sagrados", keywords: "sitios sagrados, sitio sagrado, línea negra, territorio ancestral, territorios ancestrales, sierra nevada, espiritual" },
    ],
  },
  {
    name: "Derecho ambiental",
    slug: "derecho-ambiental",
    description: "Protección del agua, los bosques y los recursos naturales.",
    keywords:
      "ambiente, ambiental, medio ambiente, agua, río, ríos, bosque, deforestación, contaminación, licencia ambiental, minería, recursos naturales, biodiversidad, páramo, tala, ecosistema, naturaleza",
    children: [
      { name: "Licencias ambientales", keywords: "licencia ambiental, licencias ambientales, anla, estudio de impacto ambiental, plan de manejo ambiental" },
      { name: "Agua y ecosistemas", keywords: "agua, agua potable, río, ríos, páramo, páramos, cuenca, humedal, acueducto, ecosistema, ecosistemas" },
      { name: "Recursos naturales", keywords: "minería, minero, mineros, recursos naturales, hidrocarburos, petróleo, explotación, bosque, forestal" },
    ],
  },
  {
    name: "Derechos culturales",
    slug: "derechos-culturales",
    description: "Lenguas, identidad, patrimonio y conocimientos tradicionales.",
    keywords:
      "cultura, cultural, culturales, lengua, lenguas, idioma, tradición, tradiciones, patrimonio, conocimiento tradicional, identidad cultural, saberes, costumbres",
    children: [
      { name: "Lenguas nativas", keywords: "lengua, lenguas, lenguas nativas, idioma, intérprete, traductor, bilingüe" },
      { name: "Patrimonio cultural", keywords: "patrimonio, patrimonio cultural, bienes de interés cultural, arqueológico, cultura, identidad cultural" },
      { name: "Conocimientos tradicionales", keywords: "conocimiento tradicional, conocimientos tradicionales, saberes, saber ancestral, medicina tradicional, diversidad biológica, cosmovisión" },
    ],
  },
  {
    name: "Gobierno propio y jurisdicción indígena",
    slug: "gobierno-propio-jurisdiccion",
    description: "Autoridades tradicionales, cabildos y justicia propia.",
    keywords:
      "gobierno propio, cabildo, cabildos, autoridad tradicional, autoridades tradicionales, jurisdicción indígena, jurisdicción especial, justicia propia, guardia indígena, usos y costumbres, gobernador, autoridades indígenas",
    children: [
      { name: "Jurisdicción especial indígena", keywords: "jurisdicción especial, jurisdicción especial indígena, justicia propia, jurisdicción indígena, fuero indígena" },
      { name: "Cabildos y autoridades", keywords: "cabildo, cabildos, autoridad tradicional, autoridades tradicionales, gobernador indígena, asociación de cabildos, registro de autoridades" },
      { name: "Coordinación con la justicia ordinaria", keywords: "conflicto de competencia, conflicto de jurisdicciones, jurisdicción ordinaria, coordinación, juez ordinario, fiscalía, fuero indígena" },
    ],
  },
  {
    name: "Educación y salud",
    slug: "educacion-salud",
    description: "Educación propia e intercultural y atención en salud.",
    keywords:
      "educación, etnoeducación, escuela, colegio, universidad, docente, docentes, salud, hospital, eps, ips, médico, medicina tradicional, sispi, seip, medicamento, medicamentos, cita médica, tratamiento",
    children: [
      { name: "Educación propia e intercultural", keywords: "etnoeducación, etnoeducadores, seip, educación, educación propia, educativo, docente, docentes" },
      { name: "Salud propia e intercultural", keywords: "sispi, salud, eps, eps indígena, ips, medicamento, medicamentos, atención en salud" },
    ],
  },
  {
    name: "Derechos fundamentales",
    slug: "derechos-fundamentales",
    description: "Vida, igualdad, debido proceso y los mecanismos para protegerlos.",
    keywords:
      "derecho fundamental, derechos fundamentales, tutela, vida, igualdad, dignidad, discriminación, debido proceso, mínimo vital, integridad, libertad, desplazamiento, víctima, víctimas, amenaza",
    children: [
      { name: "Acción de tutela", keywords: "tutela, acción de tutela, amparo, derechos fundamentales" },
      { name: "Igualdad y no discriminación", keywords: "discriminación, igualdad, racismo, mujer, mujeres, violencia contra la mujer, enfoque diferencial" },
      { name: "Víctimas y desplazamiento", keywords: "víctima, víctimas, desplazamiento, desplazados, conflicto armado, reparación, restitución" },
    ],
  },
  {
    name: "Procedimientos administrativos",
    slug: "procedimientos-administrativos",
    description: "Peticiones, trámites y recursos ante entidades públicas.",
    keywords:
      "derecho de petición, petición, peticiones, solicitud, respuesta, responde, entidad, trámite, recurso, reposición, apelación, silencio administrativo, queja, reclamo, funcionario, alcaldía, gobernación, plazo, término",
    children: [
      { name: "Derecho de petición", keywords: "derecho de petición, petición, peticiones, respuesta de fondo" },
      { name: "Recursos y actuaciones", keywords: "reposición, apelación, recurso, recursos, silencio administrativo, acto administrativo, actos administrativos, revocatoria, procedimiento administrativo" },
    ],
  },
  {
    name: "Jurisprudencia constitucional",
    slug: "jurisprudencia-constitucional",
    description: "Decisiones de la Corte Constitucional sobre pueblos indígenas.",
    keywords: "sentencia, sentencias, corte constitucional, jurisprudencia, precedente, fallo",
    children: [
      { name: "Sentencias de unificación (SU)" },
      { name: "Sentencias de tutela (T)" },
      { name: "Sentencias de constitucionalidad (C)" },
      { name: "Autos de seguimiento" },
    ],
  },
  {
    name: "Otras temáticas",
    slug: "otras-tematicas",
    description: "Códigos y normas generales: familia, bienes, trabajo, delitos, comercio y otros temas.",
    keywords: "",
    children: [
      { name: "Derecho civil y familia", keywords: "código civil, matrimonio, divorcio, sucesión, herencia, alimentos, contrato, contratos, propiedad, bienes, obligaciones, proceso civil" },
      { name: "Derecho laboral y seguridad social", keywords: "trabajo, trabajador, trabajadores, empleador, contrato de trabajo, salario, despido, prestaciones, pensión, pensiones, seguridad social, laboral" },
      { name: "Derecho penal y policía", keywords: "código penal, procedimiento penal, sistema penal acusatorio, convivencia ciudadana, código de policía, medidas correctivas" },
      { name: "Comercio, contratación y municipios", keywords: "código de comercio, comerciante, comerciantes, sociedades comerciales, contratación estatal, contratación pública, contrato estatal, régimen municipal, organización de los municipios, código disciplinario, código electoral" },
    ],
  },
];
