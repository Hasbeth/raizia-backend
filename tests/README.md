# Pruebas de RAIZIA · Backend

Ejecutar `npm test` con Node.js 26. En PowerShell con scripts deshabilitados,
usar `npm.cmd test`. El comando ejecuta `tests/*.test.mjs` sin iniciar servidores,
leer archivos de entorno ni acceder a la base original.

- `triage.test.mjs`: rutas ordenadas, pasos condicionales, dudas y compatibilidad.
- `fixtures/relatos.mjs`: relatos con expectativas y regresiones.
- `tools-config.test.mjs`: catálogo, campos obligatorios, correo, contactos y sugerencias.
- `search.test.mjs`: normalización, términos y extractos, sin consultas a datos.
- `ingest.test.mjs`: artículos, sentencias, tamaño y conservación de texto.
- `public-routes.test.mjs`: biblioteca, filtros, paginación, límites, fichas públicas, 404, inicio y sesión.
- `support/register.mjs` y `support/db-stub.mjs`: resolución de TypeScript y bloqueo de SQLite.
- `support/route-harness.mjs`: ejecuta los handlers reales con repositorio y autenticación simulados; rechaza dependencias no declaradas.

Se mantienen las **160 pruebas originales**, incluidas las 10 de rutas HTTP.
La ampliación de biblioteca añade:

- `biblioteca.test.mjs`: encabezados observados, excepciones, conservación de hechos/visor, dedupe y estimación Postgres.
- `embeddings-core.test.mjs`: lotes, cuota móvil por textos, 429 diario/temporal, normalización/BLOB/pgvector y cola con HTTP/reloj simulados.
- `biblioteca-integration.test.mjs`: proceso hijo con SQLite real **exclusivamente de prueba**, generado bajo `raizia-backend/data/.test-biblioteca-*` y eliminado al terminar. Verifica fichas, errores de extracción, visor, reporte y conservación de vectores por hash tras cambiar IDs. Nunca abre la base original.

Las pruebas no leen `.env.local` ni usan red; el bloqueo de SQLite se mantiene
para las pruebas de lógica pura. La integración solo permite SQLite en su
proceso hijo aislado, sin heredar el registro de stubs.

La batería adicional de administración permanece junto a sus handlers:

```powershell
node --test src/rutas/admin/admin-routes.test.mjs
```

Resultado: **9 pruebas aprobadas**. También usa adaptadores aislados; no sube,
borra ni modifica documentos reales. Su expectativa de subida incluye el estado
inicial `revision`, que ya establecía el handler original.

## Orientación y recuperación multiconsulta

`rag.test.mjs` comprueba JSON estricto (2–4 subtemas distintos), reintento único,
plazo total, cancelación, caché contextual, cuota móvil de Gemini, RRF, diversidad,
prioridad por ficha, reserva principal, fallback y prompt. `chat-rag.test.mjs`
comprueba los eventos HTTP: `meta.subtemas` sirve para depurar y no se mezcla con
tokens de respuesta. `gemini-transport.test.mjs` ejecuta el transporte real con
`fetch` simulado: verifica temperatura 0, esquema JSON, reintento y 429. La
integración PGlite también comprueba que una norma citada quede primera y que
los documentos no aprobados no se recuperen.

Decisiones de implementación:

- El contexto final contiene hasta 9 fragmentos, máximo 2 por documento. Reserva
  3 de la colección principal cuando existen suficientes fragmentos relevantes
  de documentos distintos para respetar ese máximo; no rellena con fuentes vacías.
- Las referencias número/año se comparan con la identidad de la ficha, no con
  citas incidentales de otras normas dentro de su resumen. Se recuperan fragmentos
  del documento identificado aunque haya quedado fuera del ranking general.
- La caché dura 5 minutos (15 segundos para fallos), contiene hasta 256 entradas
  e incluye pregunta normalizada, perfil y los dos últimos mensajes del historial.
  El reintento y la primera llamada comparten un plazo total de 3 segundos.
- `GEMINI_RPM` configura el máximo de solicitudes de generación por minuto
  (predeterminado conservador: 10). La ventana es compartida por reformulación,
  respuesta y demás llamadas de generación dentro del proceso; cada intento
  HTTP consume cuota. No espera si se agota; aplica fallback y respeta
  `Retry-After` en 429. La reformulación deja un cupo para generar la respuesta;
  si no queda cuota, el estado de IA permite mostrar directamente la búsqueda.
  En despliegues con varias instancias, esta ventana no es
  un contador distribuido de toda la cuenta: la cuota remota sigue siendo la autoridad.
- Si hay una pregunta aclaratoria y ningún subtema tiene evidencia textual
  suficiente, el chat emite solo esa pregunta, sin consultar al generador de
  respuestas ni presentar fuentes irrelevantes. Una coincidencia vectorial débil
  no basta por sí sola. Con evidencia, el prompt pide orientación con citas,
  tres secciones, hasta unas 220 palabras y una única pregunta final si falta un dato.
- Sin Gemini o en `RAIZIA_MODO=local`, sigue disponible la recuperación original
  con el ranking corregido. Las instrucciones de estilo se verifican con stubs;
  no se ha medido cumplimiento de estilo ni latencia de Gemini real.

## Evaluación reproducible sin red

Desde `raizia-backend`, ejecutar:

```powershell
node scripts/evaluar-busqueda.mjs
```

Usa las 30 preguntas originales más 10 de beneficios en
`tests/fixtures/evaluacion.json`. El respaldo externo permanece intacto.
Comprueba todos los IDs esperados contra `data/staging/biblioteca.db`, abierto
con `readOnly:true` y `query_only`. El cargador lee igualmente los vectores en
solo lectura y crea una copia PGlite con almacenamiento local en
`data/evaluacion/`; no lee `.env.local`, no usa archivos originales de otra
carpeta ni accede a red. Reutiliza esa copia mientras no cambie el staging.

Compara seis variantes: antes/después/reformulada en modo léxico y en híbrido
con el modelo e5 instalado localmente. `--solo-lexico` permite ejecutar las tres
variantes léxicas si no está instalado el modelo; el modo híbrido falla de forma
explícita si no puede cargarlo. `--recargar` vuelve a comprobar la carga local.
Las consultas SQL idénticas se memoizan únicamente dentro de cada pregunta,
sin cambiar candidatos ni puntajes. La evaluación no mide latencia productiva.

`tests/fixtures/search-before.ts` es la copia del buscador anterior a esta tarea,
con solo las rutas de importación ajustadas. El informe guarda su SHA-256.
`tests/fixtures/reformulaciones.json` contiene respuestas simuladas **redactadas
manualmente**, no respuestas obtenidas de Gemini ni una evaluación ciega del
modelo. No se deben presentar sus aciertos como calidad medida de Gemini real.

Acierto top-6 significa al menos un documento esperado entre los primeros seis
fragmentos (los documentos repetidos consumen posiciones). El chat usa nueve;
la evaluación recorta esos resultados a seis. El informe desglosa originales,
cotidianas, exactas y beneficios, e incluye IDs de cada resultado. Un acierto de
documento no demuestra por sí solo que el fragmento responda toda la pregunta.
`data/evaluacion/resultados.json` conserva el resultado completo;
`resultados-lexico.json`, la ejecución solo léxica. `progreso.json` permite
inspeccionar una ejecución en curso. Tres regresiones adicionales verifican
Ley 1482/2011, T-129/11 y Decreto 1953 sin sumarlas al denominador.

Para bloquear HTTP durante las comprobaciones y el build:

```powershell
$env:NODE_OPTIONS='--require ./tests/support/offline.cjs'
$env:RAIZIA_MODO='local'
$env:RAIZIA_PGLITE_DIR=':memory:'
$env:LLM_PROVIDER='none'
$env:RAIZIA_EMBED_DISABLED='1'
$env:NEXT_TELEMETRY_DISABLED='1'
npm.cmd test
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run build
```

Medición del 20-11-2026 sobre un corpus de 1.520 documentos (1.519 aprobados)
y 136.393 fragmentos con vectores, sin red. La recuperación pública excluye
el borrador (aciertos top-6):

| Conjunto | Antes léxico | Ranking léxico | + stubs léxico | Antes híbrido | Ranking híbrido | + stubs híbrido |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 30 originales | 16/30 | 20/30 | 28/30 | 22/30 | 22/30 | 29/30 |
| 20 cotidianas (subconjunto) | 11/20 | 11/20 | 19/20 | 12/20 | 12/20 | 19/20 |
| 10 beneficios nuevos | 8/10 | 8/10 | 10/10 | 8/10 | 8/10 | 10/10 |
| Total | 24/40 | 28/40 | 38/40 | 30/40 | 30/40 | 39/40 |

Estos valores comparan la copia del código anterior con el código nuevo sobre
el mismo corpus PGlite; no sustituyen ni reproducen exactamente la medición
histórica 18/30 indicada en la especificación. La mejora con stubs mide la
recuperación ante reformulaciones manuales, no la comprensión de Gemini real.
En híbrido persiste el fallo de la pregunta 6 (intervención del juez externo
frente a una sanción del cabildo); en léxico también falla la 22 (artículo 330).
Las tres regresiones fuera del conjunto puntuado pasan: Ley 1482/2011,
T-129/11 y Decreto 1953 quedan primeros.

Para educación universitaria, el contexto reformulado incluye el documento
1537 (Decreto 1075, fragmentos 24778 y 24785 del Fondo Álvaro Ulcué Chocué)
y el 1415 (T-612/17, fragmentos 169369 y 169370 sobre cupos especiales).
La inspección del texto confirma matrícula o sostenimiento en el fragmento
24785; esto no garantiza que una persona cumpla los requisitos. El juego no
usa T-179/23 como expectativa de admisión, pues su ficha trata de requisitos de grado.
