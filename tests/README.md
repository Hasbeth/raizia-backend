# Pruebas de RAIZIA · Backend

Límite compartido de `/api/chat` y `/api/tools/orientar`: `CHAT_LIMIT_IP_PER_MINUTE` (12),
`CHAT_LIMIT_IP_PER_DAY` (300) y `CHAT_LIMIT_GLOBAL_PER_DAY` (1500).
Aceptan enteros positivos. Las ventanas usan UTC; los saludos no consumen cupo.
El orientador devuelve orientación general con aviso visible y `Retry-After` si
se agota el cupo; no ejecuta recuperación ni generación en ese caso.
La sal usa el `CRON_SECRET` existente; solo `RAIZIA_MODO=local` permite la sal fija.
Si no se puede contar, se permite continuar y se registra un mensaje sin datos
personales. La tarea de mantenimiento elimina ventanas de más de dos días.

`vector-index.test.mjs` comprueba un solo recorrido HNSW de 320 candidatos,
los filtros, los cupos 180/60, los solapamientos y el orden por distancia.
`rate-limit.test.mjs` cubre los
límites, el hash de IP, el respaldo de cabeceras, fail-open y la respuesta 429.
La integración PGlite comprueba esquema idempotente, RLS sin políticas,
incrementos concurrentes y limpieza con el límite exacto de dos días.

Para compilar sin que Next lea archivos de entorno, ejecutar
`node tests/support/prepare-offline-build.mjs`. Imprime una copia aislada dentro
de `.verification/`, con el código y un enlace al `node_modules` instalado.
Ejecutar allí `npm.cmd run build` con `NODE_OPTIONS=--require` y la ruta absoluta
a `tests/support/offline.cjs`, además de las variables locales indicadas abajo.
La precarga bloquea archivos de entorno, HTTP y TCP externo; permite el canal
local que usan los workers de Turbopack. `.verification` queda excluida de
TypeScript y ESLint para que no recorran los artefactos de estas copias.

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

## Optimización de recuperación y despliegue del índice auxiliar

Aplicar `supabase/schema.sql` antes de publicar el buscador. Es idempotente y
añade `chunk_search`, GIN, RLS sin políticas y un trigger; no reescribe `chunks`
ni reconstruye su HNSW. El trigger mantiene inserciones y cambios de cabecera
o contenido; un contenido NULL elimina la entrada. El borrado funciona en cascada.

Con `DATABASE_URL` ya definida en el entorno del proceso, ejecutar:

```powershell
node scripts/backfill-chunk-search.mjs
node scripts/backfill-chunk-search.mjs --after-id 12345
```

El segundo comando ejemplifica una reanudación: sustituir `12345` por el último
`lastId` confirmado. Cada lote contiene hasta 2000 entradas, usa upsert y puede
repetirse desde cero. El script no carga archivos de entorno ni imprime la URL.
El buscador conserva la consulta anterior mientras no existan filas indexadas
para la biblioteca visible. Durante un relleno parcial usa las filas ya presentes;
completar el relleno antes de publicar garantiza cobertura léxica completa.

`retrieve` comparte aprobaciones, documentos por tema y disponibilidad del índice
durante una petición. Los embeddings pendientes se calculan juntos en e5 local
o Gemini (`RETRIEVAL_QUERY`), conservando caché y respaldo léxico. La fusión y los
cupos finales no cambian. `RAIZIA_TIEMPOS=1` imprime únicamente cinco duraciones
en milisegundos: reformulación, embeddings, léxica, vectorial e hidratación. Son
sumas de trabajo por etapa; las etapas paralelas no deben sumarse como latencia
total. Por defecto no se imprimen.

`chunk-search.test.mjs` verifica el trigger, RLS, esquema idempotente, equivalencia
léxica, respaldo, lotes y reanudación con PGlite. `query-embeddings.test.mjs` usa
proveedores simulados para comprobar lotes, orden, caché y fallo. La evaluación
completa rellena su copia local y falla si baja de 29/30 originales o 10/10 beneficios
en híbrido con reformulaciones simuladas.

Para educación universitaria, el contexto reformulado incluye el documento
1537 (Decreto 1075, fragmentos 24778 y 24785 del Fondo Álvaro Ulcué Chocué)
y el 1415 (T-612/17, fragmentos 169369 y 169370 sobre cupos especiales).
La inspección del texto confirma matrícula o sostenimiento en el fragmento
24785; esto no garantiza que una persona cumpla los requisitos. El juego no
usa T-179/23 como expectativa de admisión, pues su ficha trata de requisitos de grado.

## Integridad de artículos y arranque de base

La hidratación del chat consulta en un solo lote los artículos con `weight>=1`.
Une únicamente vecinos consecutivos del mismo documento con el mismo `heading`
exacto, elimina traslapes y conserva una fuente numerada por artículo. La selección
final mantiene nueve fuentes y dos por documento, rellenando el cupo que liberan
las partes unidas. Los artículos llegan al prompt sin el antiguo recorte de 1.400
caracteres: el límite es 3.500, con una ventana de literales/numerales completos
puntuada por la pregunta y sus subtemas. Si ni un apartado completo cabe, se indica
la omisión en lugar de presentar una cita cortada. Las masivas no se expanden.

`article-context.test.mjs` usa PGlite y un fixture del artículo 12 con el literal j
para comprobar el texto final del prompt, límites, contigüidad, traslapes y cupos.
El fixture no modifica el corpus de evaluación ni agrega expectativas a su métrica.

El timeout del transporte Gemini provenía de omitir el stub de
`prepareSearchContext`: pese a simular la búsqueda, se abría PGlite real y se
ejecutaba el esquema. La prueba ahora simula preparación/embeddings e intercepta
la base para exigir cero accesos; conserva el transporte real, las aserciones de
JSON/reintento/caché/429/fallback y el timeout de 15 segundos.

`createDatabase` aplica `schema.sql` automáticamente solo para PGlite local.
La rama PostgreSQL retorna antes: los índices GIN/HNSW y el `DROP INDEX IF EXISTS
idx_chunks_lexical` se ejecutan únicamente al aplicar el esquema explícitamente
en instalación/mantenimiento (también desde el cargador). El arranque productivo
sin `DATABASE_URL` falla antes de abrir PGlite, incluso fuera de Vercel.
`database-startup.test.mjs` verifica con stubs que ese arranque no lee el esquema
ni ejecuta SQL; `chunk-search.test.mjs` comprueba el borrado idempotente del índice
antiguo sin reescribir `chunks` ni reconstruir HNSW. El DROP normal puede tomar un
bloqueo durante la migración explícita; no se ejecuta en un arranque frío productivo.

## Orientación, identidad, contexto y citas (22-11-2026)

`orientation-identity.test.mjs` cubre resolución determinista del grupo por turno,
terceros, perfil complementario e inmutable, elección de ambos grupos y búsqueda
sin sesgo del perfil contradictorio. Comprueba CEDAW/Belém excluidas, prioridad
racial, comparación con fuentes de ambos grupos, reservas de contexto y una
integración adicional sobre PGlite en memoria. «Línea Negra» no se interpreta
como identidad NARP.

El orientador activo usa `retrieve` y JSON de Gemini con esquema estricto, un
reintento y plazo total de 12 segundos (incluye recuperación y verificación).
Las únicas reglas de respuesta son alerta explícita de peligro y respaldo
neutral. `triage.ts` aporta el catálogo cerrado de títulos y herramientas; sus
textos/reglas antiguos no se ejecutan en la ruta. El resumen usa extractos del
relato y respuestas, sin convertir preguntas previas en hechos. Las rutas se
posponen mientras haya preguntas sobre los hechos. El relato se precarga por
sessionStorage; el servidor no modifica perfiles.

`source-policy.ts` separa norma, jurisprudencia y contexto por tipo documental,
independientemente del peso. Los trámites, casos, cifras y experiencias reservan
hasta dos fuentes de contexto de nueve, preservando la colección principal.
Los nuevos tipos Boletín, Cartilla, Guía y Caso también se aceptan en el editor.
Los filtros por población se aplican antes del cupo y después de hidratar. Una
referencia normativa explícita activa su documento como tema, sin atribuir esa
población a la persona. Las vías de violencia de pareja permanecen condicionadas.

El chat retiene los tokens jurídicos hasta verificar las afirmaciones. La
verificación usa JSON de Gemini con extractos literales comprobados en las
fuentes, corrige referencias o retira afirmaciones. Tiene un plazo de 2,8 segundos;
si falla conserva únicamente citas con coincidencia textual suficiente, números
y población compatibles. El contexto no acredita obligaciones. Sus descripciones
llevan atribución y fecha cuando existe, con sección propia. Esta comprobación
reduce errores, pero no equivale a una auditoría jurídica humana ni garantiza
la comprensión de Gemini en producción.

`integration/orientation-gemini.mjs` ejecuta el transporte real de generación
con fetch simulado: esquema del orientador, reintento, verificación posterior,
respuesta NARP frente al perfil indígena y cero accesos a base. Las pruebas
usan casos sintéticos y no contienen credenciales reales ni datos personales.
La evaluación añade dos regresiones fuera del denominador: consulta racial
sin perfil y con perfil indígena; exige fuente racial en top 3 y ninguna
CEDAW/Belém en top 9. Los resultados de stubs no miden Gemini real.
