# RAIZIA · Backend

**Nuestras raíces, nuestros derechos.**
API de la plataforma de orientación jurídica y protección de derechos colectivos, desarrollada en el marco de ALUNA IA (Universidad del Magdalena).

Esta aplicación independiente usa Next.js 16.4.6 con route handlers, SQLite (`node:sqlite`), búsqueda FTS5 y Gemini u Ollama. Sirve los datos, el chat, las herramientas y la administración en `http://localhost:4000`. Las pantallas viven en `../raizia-frontend`, en el puerto 3000.

## Cómo iniciarlo (Windows)

Usa Node.js 26, la versión con la que se ejecutan también las pruebas.

1. Si faltan las dependencias, ejecuta `npm ci`.
2. Copia `.env.example` a `.env.local` **solo si aún no existe** y completa la configuración.
3. Ejecuta `npm run dev` para desarrollar, o `iniciar-backend.bat` para uso normal.
4. En otra terminal inicia el frontend desde `../raizia-frontend`.

El archivo `.bat` compila si falta `.next/BUILD_ID` y luego ejecuta `npx next start -p 4000`. Después de modificar código, ejecuta `npm run build` antes de volver a abrirlo. También puedes iniciar una compilación existente con `npm start`.

## Configuración (`.env.local`)

| Variable | Para qué |
| --- | --- |
| `ADMIN_PASSWORD` | Contraseña del panel de administración. |
| `GEMINI_API_KEY` | Clave de Google AI Studio; si tiene valor, se usa Gemini. |
| `GEMINI_MODEL` | Modelo preferido, por defecto `gemini-3.5-flash`; se conserva la selección alternativa del proveedor. |
| `LLM_PROVIDER` | Opcional: `ollama` fuerza Ollama aunque haya clave de Gemini. |
| `OLLAMA_URL` | Servidor local, por defecto `http://127.0.0.1:11434`. |
| `OLLAMA_MODEL` | Modelo local preferido, por defecto `qwen3.5:4b`. |
| `RAIZIA_DATA_DIR` | Carpeta con `raizia.db` y `files/`. Por defecto, `data/` dentro de esta aplicación. Las rutas relativas se resuelven desde el directorio de ejecución. |
| `RAIZIA_READ_ONLY` | `1` abre SQLite en solo lectura, sin crear carpetas ni ejecutar migraciones. Por defecto `0`. |

Para consultar la colección original en desarrollo, puedes usar `RAIZIA_DATA_DIR=../raizia/data` y `RAIZIA_READ_ONLY=1`. No importes, subas, borres, reindexes ni edites documentos contra esa colección. Para administrar documentos, usa una carpeta de datos propia con escritura habilitada.

Gemini necesita internet y recibe las preguntas y los fragmentos citados. Ollama funciona en el equipo. Las claves y la contraseña permanecen en el backend.

## Endpoints

Todas las rutas nuevas son dinámicas y responden con `Cache-Control: no-store`. Solo los documentos **aprobados** se exponen en la biblioteca pública y sus fichas.

| Método y ruta | Respuesta o función |
| --- | --- |
| `GET /` | Nombre de la API y lista de endpoints. |
| `GET /api/home` | `stats` y árbol público de `categories`. |
| `GET /api/library?q=&categoria=&tipo=&entidad=&pagina=&tamano=` | `documents`, `total` de coincidencias, `page`, `pages`, `approved`, `facets` y `categories`. Tamaño predeterminado 25, máximo 100; la página se limita al rango disponible. |
| `GET /api/documents/[id]` | `document` y `chunks`; 404 si no existe o no está aprobado. |
| `GET /api/documents/[id]/file` | Archivo original; `?descargar` solicita descarga. |
| `GET /api/status` | Estado del proveedor de IA y estadísticas. |
| `POST /api/chat` | Respuesta en streaming NDJSON. |
| `POST /api/tools/orientar` | Orientación sobre rutas y herramientas. |
| `POST /api/tools/organizar` | Organización del relato. |
| `POST /api/tools/[kind]` | Generación de un borrador Word. |
| `GET /api/admin/session` | `configured` y `admin` según la cookie `raizia_admin`. |
| `POST /api/admin/login`, `POST /api/admin/logout` | Inicio y cierre de sesión. |
| `GET /api/admin/documents`, `POST /api/admin/documents` | Consulta privada y subida multipart de PDF/DOCX, hasta 30 MB por archivo. |
| `GET /api/admin/documents/[id]`, `PATCH /api/admin/documents/[id]`, `DELETE /api/admin/documents/[id]` | Consulta, edición y eliminación. |
| `POST /api/admin/documents/[id]/file` | Sustitución del archivo. |
| `POST /api/admin/documents/[id]/reindex` | Reindexación. |
| `POST /api/admin/import-url` | Importación desde una dirección oficial. |
| `GET /api/admin/categories`, `POST /api/admin/categories` | Consulta y creación de categorías. |
| `PATCH /api/admin/categories/[id]`, `DELETE /api/admin/categories/[id]` | Edición y eliminación de categorías. |
| `POST /api/seed` | Importación de la colección inicial. |

Las operaciones de administración y la importación requieren la sesión firmada existente. El frontend reenvía `/api/*` al backend y conserva esa cookie en el mismo origen.

## Importar fuentes

Con el backend abierto, `ADMIN_PASSWORD` configurada y una **base propia habilitada para escritura**, ejecuta `npm run importar`. El script inicia sesión y descarga la colección inicial desde fuentes oficiales. Su dirección predeterminada es `http://localhost:4000`; puede cambiarse con `RAIZIA_URL`.

Se conservan los demás scripts en `scripts/`. Revisa sus requisitos y rutas antes de ejecutarlos. La importación modifica la colección: no forma parte de la verificación contra la base original.

## Estructura y comprobaciones

## Biblioteca nueva y embeddings

La fase 1 construye una biblioteca intermedia en `data/staging/`. Requiere Node
26 y las dependencias locales; no necesita un servidor Next.js ni Supabase.
Los dos primeros comandos funcionan sin red y no leen `.env.local`.

```powershell
npm run construir
npm run medir
npm run embeddings -- --limite 30
```

En PowerShell con scripts deshabilitados usa `npm.cmd`. Para procesar todos los
pendientes, ejecuta `npm run embeddings` sin `--limite`.

- **`construir`** lee `../raizia/data/raizia.db` con `{ readOnly: true }` y los
  archivos originales de `../raizia/data/files/`. Copia las 19 columnas de cada
  ficha y las categorías, reextrae y fragmenta con `src/lib/ingest.ts`, y crea
  `biblioteca.db`, `textos/<id>.json`, `construccion.json` y
  `frecuencias-encabezados.json`. Los errores de extracción se registran sin
  detener el resto; una ficha fallida tiene JSON con `chunks: []`. Comprueba el
  SHA-256 de la base original antes/después sin escribir en ella ni en su WAL.
  Se puede repetir: conserva vectores existentes por `content_hash`, aunque
  cambien los IDs; el staging anterior sigue disponible hasta publicar el nuevo.
- **`medir`** imprime y guarda `data/staging/informe.md` y `medicion.json`, con
  fragmentos viejos/reextraídos/indexados por colección, exclusiones, fallos,
  bytes reales de texto y Storage, y estimaciones Postgres para 384 y 256
  dimensiones frente a 500 MB. Se supone GIN de expresión español, sin HNSW;
  también se muestra el costo opcional de una columna tsvector almacenada.
- **`embeddings`** es el único comando que utiliza red. Lee `GEMINI_API_KEY` de
  `.env.local` o del entorno sin imprimirla, usa
  `models/gemini-embedding-2`, `RETRIEVAL_DOCUMENT`, el título y 384 dimensiones.
  `EMBED_DIMS` permite elegir otra dimensionalidad (por ejemplo 256);
  `EMBED_BATCH` permite lotes de 20–50 textos (predeterminado 30).
  Cambiar dimensiones vuelve a poner los vectores incompatibles en la cola.
  Procesa primero la colección principal y después las masivas por peso.
  Limita a 90 **textos**, no lotes, por minuto, persiste el historial de cuota
  entre ejecuciones y respeta `RetryInfo.retryDelay` en un 429. Una cuota diaria
  agotada deja el avance guardado, indica «cuota diaria agotada, reintentar
  mañana» y termina con código 0. Otros errores persistentes terminan con 1.

Cada lote de vectores normalizados L2 se confirma en una transacción SQLite.
Ctrl-C conserva todos los lotes confirmados; al repetir se seleccionan solo
los `chunks.indexed=1` que aún no tienen un vector del modelo y dimensiones
elegidos. `data/staging/progreso.json` contiene hechos/total, porcentaje, ritmo,
ETA de toda la biblioteca y de la ejecución limitada, fase y último error.
Con `--limite 0` no se envían solicitudes. No ejecutes los tres comandos a la
vez: comparten un bloqueo de escritura.

Las [reglas, evidencia y mapeo de esquema](scripts/REGLAS-BIBLIOTECA.md) explican
qué se indexa. El visor conserva **todas** las secciones y los duplicados. En
la fase 2 se importarán a Postgres solo los fragmentos `indexed=1`, junto con
sus vectores; los JSON y originales irán a Storage. Esta fase no migra la API
ni sube archivos. `data/` ya está ignorada y requiere respaldo por separado.

## Estructura y comprobaciones

```text
src/app/api/   rutas públicas, chat, herramientas y administración
src/app/route.ts   información de la API
src/lib/       repositorio, SQLite, extracción, búsqueda, IA y autenticación
scripts/       importación y mantenimiento de fuentes
tests/         pruebas aisladas, sin acceso a la base real
data/          base SQLite y archivos originales
```

Ejecuta `npm test`, `npx tsc --noEmit`, `npx eslint` y `npm run build`. Se mantienen las 160 pruebas originales y se añaden pruebas de reglas, deduplicación, estimación, embeddings y reconstrucción con SQLite aislado. Las pruebas de embeddings simulan HTTP y el reloj; no llaman a Gemini ni leen claves.

`data/` **no se versiona**; necesita un respaldo aparte, junto con los archivos de `data/files/`. Tampoco se versionan `node_modules/`, `.next/` ni `.env*`, salvo `.env.example`.
