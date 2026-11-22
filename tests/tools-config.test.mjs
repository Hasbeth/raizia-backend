import assert from "node:assert/strict";
import test from "node:test";
import { PETICION, TOOL_LIST, TOOLS, TUTELA, stepApplies, suggestEntities, suggestTool, toolBySlug, validateTool } from "../src/lib/tools-config.ts";

function datosValidos(config) {
  const datos = { telefono: "3001234567" };
  for (const campo of config.steps.flatMap((paso) => paso.fields)) {
    if (!campo.required) continue;
    datos[campo.name] = campo.type === "checkboxes" ? [campo.options[0]] : campo.options?.[0] || "Dato de prueba";
  }
  return { ...datos, nombre: "María Izquierdo", numeroDocumento: "123456789", ciudad: "Valledupar" };
}

test("El catálogo contiene clases y direcciones únicas y etiquetas obligatorias legibles", () => {
  assert.equal(new Set(TOOL_LIST.map((herramienta) => herramienta.kind)).size, TOOL_LIST.length, "Las clases de herramienta no deben repetirse.");
  assert.equal(new Set(TOOL_LIST.map((herramienta) => herramienta.slug)).size, TOOL_LIST.length, "Las direcciones de herramienta no deben repetirse.");
  for (const herramienta of TOOL_LIST) {
    assert.ok(herramienta.kind.trim() && herramienta.slug.trim(), "Cada herramienta debe tener clase y dirección.");
    assert.equal(TOOLS[herramienta.kind], herramienta, "El índice debe apuntar a la configuración del catálogo.");
    assert.equal(toolBySlug(herramienta.slug), herramienta, "La dirección debe recuperar su configuración.");
    for (const campo of herramienta.steps.flatMap((paso) => paso.fields).filter((campo) => campo.required)) {
      assert.ok(campo.label.trim(), `El campo obligatorio ${campo.name} de ${herramienta.kind} necesita una etiqueta.`);
    }
  }
});

test("Una dirección desconocida de herramienta no devuelve una configuración", () => {
  for (const slug of ["", "no-existe", "DERECHO-DE-PETICION", " derecho-de-peticion "]) {
    assert.equal(toolBySlug(slug), undefined, "La búsqueda de dirección es exacta.");
  }
});

for (const config of TOOL_LIST) {
  test(`Validación de ${config.name}: acepta datos completos y rechaza cada obligatorio vacío`, () => {
    const datos = datosValidos(config);
    const copia = structuredClone(datos);
    assert.deepEqual(validateTool(config, datos), {}, "Los datos completos y el teléfono deben bastar.");
    assert.deepEqual(datos, copia, "La validación no debe modificar los datos recibidos.");
    const obligatorios = config.steps.filter(paso => stepApplies(paso, datos)).flatMap((paso) => paso.fields).filter((campo) => campo.required);
    for (const campo of obligatorios) {
      for (const vacio of [undefined, "", " \t\n ", []]) {
        const incompletos = { ...datos, [campo.name]: vacio };
        const mensaje = campo.type === "checkboxes" ? "Marca al menos una opción." : "Este dato es necesario.";
        assert.deepEqual(validateTool(config, incompletos), { [campo.name]: mensaje }, `Debe señalar únicamente el campo obligatorio ${campo.label}.`);
      }
    }
  });
}

test("Los campos opcionales vacíos no producen errores adicionales", () => {
  const datos = datosValidos(PETICION);
  for (const campo of PETICION.steps.flatMap((paso) => paso.fields)) {
    if (!campo.required && campo.name !== "telefono") datos[campo.name] = "   ";
  }
  assert.deepEqual(validateTool(PETICION, datos), {}, "Los campos opcionales pueden quedar vacíos si hay teléfono.");
});

for (const [nombre, datos] of [
  ["ningún contacto", {}],
  ["solo espacios", { direccion: "  ", correo: "\t", telefono: "\n" }],
]) {
  test(`Contacto: rechaza ${nombre}`, () => {
    for (const config of TOOL_LIST) {
      assert.deepEqual(validateTool(config, datos, "contacto"), { [config.kind === "tutela" ? "correo" : "direccion"]: "Indica al menos un medio de contacto." }, "Debe pedir al menos un medio de contacto en cada herramienta.");
    }
  });
}

for (let mascara = 1; mascara < 8; mascara += 1) {
  const datos = Object.fromEntries(Object.entries({ direccion: "Resguardo, casa del cabildo", correo: "ana@ejemplo.co", telefono: "3001234567" }).filter((_, indice) => mascara & (1 << indice)));
  test(`Contacto: acepta ${Object.keys(datos).join(" y ")}`, () => {
    for (const config of TOOL_LIST) assert.deepEqual(validateTool(config, datos, "contacto"), config.kind === "tutela" && !datos.correo && !datos.telefono ? { correo: "Indica al menos un medio de contacto." } : {}, "Tutela pide correo o teléfono; las demás herramientas mantienen sus contactos.");
  });
}

for (const correo of ["ana@ejemplo.co", "cabildo.sierra+respuesta@correo.com.co", "  ana@ejemplo.co  "]) {
  test(`Correo válido: ${correo.trim()}${correo !== correo.trim() ? " con espacios exteriores" : ""}`, () => {
    assert.deepEqual(validateTool(PETICION, { correo }, "contacto"), {}, "El correo válido debe aceptarse después de recortar espacios exteriores.");
  });
}

for (const correo of ["ana", "ana@", "@ejemplo.co", "ana@ejemplo", "ana@@ejemplo.co", "ana perez@ejemplo.co", "ana@ejemplo .co"]) {
  test(`Correo inválido: ${correo}`, () => {
    assert.deepEqual(validateTool(PETICION, { correo, telefono: "3001234567" }, "contacto"), { correo: "Revisa el correo electrónico." }, "Un teléfono no debe ocultar un correo mal escrito.");
  });
}

test("Validar un paso solo revisa los campos de ese paso", () => {
  const datos = { ...datosValidos(PETICION), correo: "mal escrito", hechos: "" };
  assert.deepEqual(validateTool(PETICION, datos, "persona"), {}, "Los errores de otros pasos no deben aparecer en persona.");
  assert.deepEqual(validateTool(PETICION, datos, "hechos"), { hechos: "Este dato es necesario." }, "En hechos solo debe mostrarse su error.");
  assert.deepEqual(validateTool(PETICION, { nombre: "" }, "contacto"), { direccion: "Indica al menos un medio de contacto." }, "El paso contacto no valida el nombre.");
});

test("El texto admite ocho mil caracteres y rechaza el siguiente", () => {
  const datos = datosValidos(PETICION);
  assert.deepEqual(validateTool(PETICION, { ...datos, hechos: "a".repeat(8000) }), {}, "El límite incluido es de ocho mil caracteres.");
  assert.deepEqual(validateTool(PETICION, { ...datos, hechos: "a".repeat(8001) }), { hechos: "El texto es demasiado largo." }, "Superar el límite debe señalar el campo.");
});

test("Sin coincidencias sugiere Personería, Defensoría y Alcaldía del municipio", () => {
  for (const relato of ["", "hola buenas", "quiero saber el horario"]) {
    const sugerencias = suggestEntities(relato, "  Pueblo Bello  ");
    assert.deepEqual(sugerencias.map((entidad) => entidad.name), ["Personería de Pueblo Bello", "Defensoría del Pueblo", "Alcaldía de Pueblo Bello"], "Debe ofrecer las tres entidades de respaldo con el municipio limpio.");
    assert.ok(sugerencias.every((entidad) => entidad.why.trim()), "Las sugerencias deben explicar su utilidad.");
  }
});

test("Un municipio vacío se sustituye por tu municipio", () => {
  assert.deepEqual(suggestEntities("", " \t ").map((entidad) => entidad.name), ["Personería de tu municipio", "Defensoría del Pueblo", "Alcaldía de tu municipio"], "No deben quedar marcadores sin sustituir.");
});

test("Salud, educación y ambiente producen como máximo cuatro sugerencias en orden", () => {
  const sugerencias = suggestEntities("LA EPS no atiende, no hay PROFESOR y el RÍO está contaminado", "Dibulla");
  assert.deepEqual(sugerencias.map((entidad) => entidad.name), ["Secretaría de Salud de Dibulla", "Superintendencia Nacional de Salud", "Secretaría de Educación de Dibulla", "Personería de Dibulla"], "Se conservan las primeras tres coincidencias y una entidad de respaldo.");
});

test("Las entidades nunca se duplican ni conservan el marcador de municipio", () => {
  for (const relato of ["salud eps medicina", "alcaldia", "escuela", "amenazas", "resguardo", "consulta previa", "salud escuela agua empresa tierra gas victima amenaza cedula cabildo via"]) {
    const entidades = suggestEntities(relato, "Valledupar");
    const nombres = entidades.map((entidad) => entidad.name);
    assert.ok(entidades.length > 0 && entidades.length <= 4, "Debe haber entre una y cuatro sugerencias.");
    assert.equal(new Set(nombres).size, nombres.length, "Cada entidad debe aparecer una sola vez.");
    assert.ok(nombres.every((nombre) => !nombre.includes("{m}")), "El municipio debe quedar sustituido.");
  }
});

for (const [mensaje, slug] of [
  ["necesito una TUTELA", "tutela"],
  ["entraron sin preguntar", "solicitud-consulta-previa"],
  ["no nos consultaron", "solicitud-consulta-previa"],
  ["la autoridad incumple la norma", "accion-de-cumplimiento"],
  ["hay contaminación", "accion-popular"],
  ["solicitamos indemnizacion", "accion-de-grupo"],
  ["no me responde la alcaldia", "derecho-de-peticion"],
  ["quiero pedir copia", "derecho-de-peticion"],
]) {
  test(`Sugerencia de herramienta: ${mensaje}`, () => {
    const sugerencia = suggestTool(mensaje);
    assert.equal(sugerencia?.slug, slug, "Debe sugerir la dirección correspondiente a la señal.");
    assert.equal(sugerencia?.name, toolBySlug(slug)?.name, "El nombre sugerido debe coincidir con el catálogo.");
  });
}

test("Cuando varias herramientas coinciden respeta la prioridad declarada", () => {
  assert.equal(suggestTool("tutela por contaminacion sin consultar")?.slug, "tutela", "Tutela tiene la primera prioridad.");
  assert.equal(suggestTool("hay contaminacion y entraron sin preguntar")?.slug, "solicitud-consulta-previa", "Consulta previa precede a la sugerencia ambiental.");
});

test("No sugiere herramientas para saludos o entradas vacías", () => {
  for (const mensaje of ["", " \n ", "hola buenas", "quiero saber el horario"]) assert.equal(suggestTool(mensaje), null, "Sin señal no debe sugerir una herramienta.");
});

test("Una lista de derechos formada solo por espacios debe contar como vacía", () => {
  // tools-config.ts: los arreglos solo se comprueban por longitud, no por contenido.
  const datos = { ...datosValidos(TUTELA), derechos: [" ", ""] };
  assert.equal(validateTool(TUTELA, datos).derechos, "Marca al menos una opción.", "Una lista sin opciones reales no satisface un campo obligatorio.");
});
