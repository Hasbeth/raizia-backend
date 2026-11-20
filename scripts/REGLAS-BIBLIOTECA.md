# Reglas de la biblioteca intermedia (v1)

La fuente es `../raizia/data/raizia.db`, abierta exclusivamente con
`new DatabaseSync(path, { readOnly: true })`, y sus archivos en `files/`.
No se importa `db()` ni el repositorio de escritura del backend. Se reutilizan
`detectKind`, `extractText`, `normalize` y `chunkText` de `src/lib/ingest.ts`.
La única ampliación de este último es un parámetro opcional `judicial`, para
fragmentar secciones de una sentencia aunque su número aparezca solo al inicio
del documento. Los llamadores existentes mantienen el comportamiento anterior.

## Evidencia que orienta las reglas

Antes de construir se recorre el texto de los fragmentos antiguos y se guarda
`data/staging/frecuencias-encabezados.json`: frecuencias de **todos** los encabezados
asignados y líneas candidatas dentro de los fragmentos masivos. Los chunks viejos
sirven únicamente para este análisis y la comparación, nunca para rellenar el
texto nuevo ni para sustituir una extracción fallida.

En la inspección inicial de los 129.738 fragmentos masivos:

| Encabezado antiguo | Fragmentos | Documentos |
| --- | ---: | ---: |
| Consideraciones | 29.210 | 825 |
| Antecedentes | 24.402 | 1.299 |
| Resuelve | 19.289 | 1.414 |
| Consideraciones y fundamentos | 6.510 | 112 |
| Sin encabezado | 6.211 | 1.432 |
| Aclaración | 1.966 | 68 |
| Salvamento | 1.392 | 36 |
| Pruebas | 622 | 34 |

Las líneas internas revelaron, entre otras, `Intervenciones` (131),
`Intervención` (107), `Actuaciones en sede de revisión` (58),
`Trámite procesal` (27), `Concepto del Procurador General de la Nación` (25),
`Tabla de contenido` (9) y `Nota de Relatoría` (6). Son frecuencias literales
normalizadas, no el número total de variantes ni el número de exclusiones.
Esto explica por qué filtrar solo `chunks.heading` habría dejado muchos
conceptos e intervenciones bajo Antecedentes o Resuelve.

## Clasificación de las masivas (`weight < 1`)

Se examinan líneas de hasta 180 caracteres, admitiendo numeración romana,
arábiga y letras, mayúsculas/minúsculas iniciales, tildes y referencias `[n]`.
Se reconoce el **inicio de un encabezado**, no menciones dentro de la prosa.
Hay restricciones de verbos narrativos y puntuación para reducir falsos
positivos. También se prueban encabezados partidos en renglones.

| Sección | Tratamiento |
| --- | --- |
| `hechos_antecedentes` | Conserva hechos, antecedentes, hechos relevantes/probados y pretensiones. |
| `problema_juridico` | Conserva problema(s) jurídico(s), planteamiento y metodología. |
| `fundamentos` | Conserva consideraciones, fundamentos, competencia y caso concreto. |
| `sintesis` | Conserva síntesis y resumen del caso o de la decisión. |
| `decision` | Conserva decisión, resuelve, decide y resolución. |
| `votos` | Excluye salvamentos, salvamentos parciales y aclaraciones **de voto**. Una vez iniciado el anexo, sus propios Hechos/Consideraciones no reabren la sentencia. |
| `intervenciones` | Excluye intervenciones ciudadanas, oficiales, extemporáneas y de personas/entidades; incluye nombres institucionales con comas. |
| `conceptos` | Excluye concepto del Procurador, Procuraduría, Ministerio Público, entidades, expertos e invitados; conserva conceptos jurídicos temáticos. |
| `pruebas_tramite` | Excluye pruebas aportadas/decretadas/recaudadas, trámite procesal/de tutela y actuaciones judiciales o de revisión. |
| `indice` | Excluye índice y tabla de contenido. Las entradas con números de página no activan votos. |
| `relatoria` | Excluye notas editoriales de relatoría hasta terminar su párrafo o aparecer otra sección. Las repeticiones restantes pasan por dedupe. |
| `contexto` | Conserva el texto sin clasificación segura, incluidas cabeceras y sumarios útiles; nunca descarta un bloque solo por no reconocerlo. |

Las secciones ordinarias continúan hasta el siguiente encabezado reconocido.
Los subtítulos desconocidos heredan la sección. `Aclaración / previa` y
`Aclaración / preliminar` se conservan: un título de voto truncado debe tener
continuación explícita «de voto». `Contenido` y `Concepto` aislados no abren
una exclusión, porque también son celdas de tablas con razonamiento jurídico.
Las reglas son heurísticas reproducibles, no una clasificación semántica
perfecta; el JSON completo permite revisar cualquier decisión y reconstruir.

## Limpieza y deduplicación de ambas colecciones

La principal (`weight >= 1`) se fragmenta completa con el `chunkText` habitual,
sin filtros por sección. Se procesan primero documentos principales y luego
masivos por `weight DESC, id`, para elegir de forma estable la copia canónica.

Cada fragmento recibe la primera causa aplicable:

1. Sección excluida (solo masivas).
2. Solo encabezado(s) o numeración, sin cuerpo.
3. Menos de 80 letras o dígitos Unicode. Espacios y puntuación no cuentan.
4. Duplicado del mismo documento o de otro documento ya indexado.

El hash SHA-256 usa `normalize`, Unicode NFKC, minúsculas y espacios colapsados;
mantiene acentos, números y puntuación. No elimina negaciones ni equipara
artículos distintos. Solo una copia **indexable** reserva el hash: un voto
excluido no impide indexar un texto idéntico de la sentencia. Una coincidencia
global se busca por su documento canónico; todos sus otros documentos
conservan el texto y sus referencias en el visor.

Todos los fragmentos, incluidos duplicados, encabezados y breves, permanecen
en SQLite con `indexed=0/1` y en `textos/<id>.json`. `ord` empieza en cero y
coincide entre ambos. Postgres recibirá únicamente `indexed=1`.

## Esquema para la fase Postgres

Se conservan exactamente los IDs y todas las columnas de las fichas,
categorías y asociaciones. No se copian FTS ni triggers del origen.
El DDL ejecutable del staging está en `scripts/lib/biblioteca-io.mjs`.

| SQLite | Postgres previsto |
| --- | --- |
| IDs/referencias `INTEGER` | `bigint` (se importan IDs; una secuencia futura debe ajustarse al máximo) |
| `ord`, `sort`, `dims`, `indexed` | `integer`, con `indexed IN (0,1)` |
| `file_size`, `text_chars` | `bigint` |
| `weight REAL` | `double precision` |
| Textos de fichas, fechas originales y hashes | `text`, sin reinterpretar fechas incompletas ni cambiar metadatos |
| `embeddings.created_at` | `timestamptz` desde ISO UTC |
| `embeddings.vector` | BLOB float32 little-endian normalizado → `blobToFloat32` → `toPgvector` → `halfvec(d)` |

`embeddings.chunk_id` es PK/FK: un vector por fragmento, con `model` y `dims`
explícitos. No se mezcla una búsqueda entre modelos/dimensiones. Al cambiar
`EMBED_DIMS`, los vectores incompatibles quedan pendientes y se reemplazan
solo cuando se confirma el nuevo lote. `content_hash` se refiere al contenido
normalizado, no al ID ni al título; una reconstrucción conserva el vector
preexistente de ese contenido aun cuando cambien ID, posición o título.

La reconstrucción escribe en `staging.next`, reutiliza vectores por hash desde
el staging anterior abierto en solo lectura y publica el directorio completo
al terminar. Conserva el anterior hasta publicar; un error fatal no lo
reemplaza. `staging.previous` permite recuperar una interrupción entre renombres.
Un bloqueo con PID evita construir, medir y calcular embeddings a la vez.
No se ejecutan checkpoints ni PRAGMA de escritura sobre la base original.

El informe usa bytes UTF-8 reales, sobrecostos explícitos y rango GIN 40–60 %.
El escenario principal presupone GIN de expresión sobre
`to_tsvector('spanish', content)` sin duplicar una columna tsvector almacenada,
y sin HNSW. También informa el costo adicional de una columna tsvector si la
fase siguiente la eligiera. Storage cuenta los JSON sin comprimir y los
archivos originales únicos existentes, incluso si falló la extracción.
