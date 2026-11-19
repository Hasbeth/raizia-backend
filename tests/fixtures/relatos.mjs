export const relatoArhuaco = `Somos una comunidad Arhuaca en la sierra hace 5 o 6 meses
entraron máquinas arriba de donde vivimos tumbando árboles para una carretera,
dicen que es un proyecto de una empresa pero nadie ha venido a explicarnos.
El agua de la quebrada ahora baja como chocolate, está turbia y contaminada,
los niños se enfermaron del estomago. Un mamo dice que estan dañando lugares sagrados.
Los trabajadores decían que tenían permiso. Después vinieron unos hombres
preguntando quiénes eran los que estaban reclamando. No nos amenazaron directamente
pero dijeron que se podían presentar problemas y las familias tienen miedo.
No tenemos papeles de la tierra, eso quiere decir que no podemos reclamar?
Solo el gobernador del cabildo puede hacerlo? Si ponemos queja van a saber quién fue?
No tenemos plata para viajar ni para pagar un abogado.`;

export const relatoPolicial = "Me pegaron al salir de mi casa. Los policías me gritaron cosas feas y me insultaron llamándome indio.";
export const relatoAmenaza = "nos amenazaron por reclamar tenemos miedo y dijeron que se podian presentar problemas";
export const relatoPuestoSalud = "Desde enero no hay médico en el puesto de salud y la alcaldía no responde la carta que mandamos.";
export const relatoCirugia = "La EPS no me autoriza la cirugía de mi hija y el médico dice que es urgente.";

// Las listas son expectativas explícitas, no resultados calculados con las reglas.
export const relatos = [
  ["obra, agua e intimidación en la comunidad arhuaca", relatoArhuaco, ["consulta-previa", "popular", "proteccion"]],
  ["agresión policial e insultos étnicos", relatoPolicial, ["denuncia"]],
  ["amenaza sin agresión física", relatoAmenaza, ["proteccion"]],
  ["puesto de salud sin médico y carta sin respuesta", relatoPuestoSalud, ["peticion"]],
  ["cirugía urgente negada por la EPS", relatoCirugia, ["tutela"]],
  ["saludo sin asunto jurídico", "hola buenas", []],
  ["pregunta de horario sin contexto", "quiero saber el horario", []],
  ["agresión contada sin tildes", "ayer me pegaron saliendo de la tienda no se que hacer", ["denuncia"]],
  ["hurto en el camino", "me robaron el celular cuando volvia a casa", ["denuncia"]],
  ["discriminación por pertenecer a un pueblo", "en la oficina me insultaron por ser indigena", ["denuncia"]],
  ["agresión y temor juntos", "me golpearon ayer y tenemos miedo de volver", ["denuncia", "proteccion"]],
  ["negación de atención y solicitud sin respuesta", "la EPS no me atiende y no nos responden la carta", ["tutela", "peticion"]],
  ["riesgo de vida y temor", "mi hija se puede morir tenemos miedo", ["tutela", "proteccion"]],
  ["obra que entra sin preguntar", "entro una retroexcavadora para carretera al resguardo sin consultar a nadie", ["consulta-previa"]],
  ["antena en territorio wayuu", "la empresa pone una antena en territorio wayuu no nos preguntaron", ["consulta-previa"]],
  ["obra con permiso que afecta sitio sagrado", "estan haciendo una obra con permiso al lado de un sitio sagrado", ["consulta-previa"]],
  ["tala y agua contaminada", "estan tumbando arboles junto al rio y el agua sale contaminada", ["popular"]],
  ["basura junto a las casas", "dejan basura detras de las casas y nadie la recoge", ["popular"]],
  ["miedo por preguntas de desconocidos", "vinieron hombres desconocidos preguntando quienes eran los que reclamaban tenemos miedo", ["proteccion"]],
  ["presión para guardar silencio", "dijeron que mejor nos callemos y que nos van a buscar problemas", ["proteccion"]],
  ["indemnización colectiva", "somos varias familias y queremos indemnizacion por lo que paso", ["grupo"]],
  ["casas y cultivos perdidos por varias familias", "las familias perdieron las casas y los cultivos por lo mismo", ["grupo"]],
  ["resolución incumplida", "la autoridad no cumple la resolucion que ya salio", ["cumplimiento"]],
  ["norma incumplida y carta ignorada", "no aplican la ley y no nos contestan lo que mandamos", ["cumplimiento", "peticion"]],
  ["lindero en conflicto entre comuneros", "mi vecino tiene una pelea por el lindero conmigo somos comuneros", ["justicia-propia"]],
  ["deuda entre parientes", "un familiar tiene una deuda conmigo y no sabemos como arreglar", ["justicia-propia"]],
  ["falta de profesor", "desde hace meses no hay profesor para los niños", ["peticion"]],
  ["copia de un documento", "queremos pedir copia del documento que entregamos", ["peticion"]],
  ["varios problemas y empate de puntuación", "nos pegaron y no cumple la resolucion y no nos responden", ["denuncia", "cumplimiento", "peticion"]],
  ["daño ambiental y amenaza empatados", "hay basura y nos amenazan", ["popular", "proteccion"]],
  ["obra y urgencia médica empatadas", "la empresa hace carretera en territorio arhuaco sin consultar y la EPS no me atiende", ["tutela", "consulta-previa"]],
  ["matrícula sin referencia a matar", "quiero revisar mi matrícula", []],
  ["robusto sin referencia a robo", "el canasto quedo robusto", []],
  ["violín sin referencia a violación", "mi hijo toca el violín", []],
  ["pegamento sin referencia a golpes", "se termino el pegamento para la artesania", []],
  ["abuso de confianza sin presumir lesiones", "quiero contar un abuso de confianza del vecino", ["denuncia"]],
];
