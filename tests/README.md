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

Resultado de `npm test`: **160 pruebas aprobadas, 0 fallidas, 0 omitidas y 0 TODO**.
Son las 150 pruebas de lógica existentes y 10 nuevas de las rutas HTTP.

La batería adicional de administración permanece junto a sus handlers:

```powershell
node --test src/app/api/admin/admin-routes.test.mjs
```

Resultado: **9 pruebas aprobadas**. También usa adaptadores aislados; no sube,
borra ni modifica documentos reales. Su expectativa de subida incluye el estado
inicial `revision`, que ya establecía el handler original.
