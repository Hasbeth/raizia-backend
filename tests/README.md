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
