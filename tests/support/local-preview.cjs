/* eslint-disable @typescript-eslint/no-require-imports -- Precarga de verificación local. */
// Solo para probar los dos servidores locales. Conserva el bloqueo de archivos
// de entorno y TCP externo del modo offline; permite HTTP exclusivamente loopback.
const http = require('node:http');
const request = http.request;
const get = http.get;
require('./offline.cjs');
const allowed = args => {
  const first = args[0];
  const host = typeof first === 'string' || first instanceof URL ? new URL(first).hostname : first?.hostname || first?.host || 'localhost';
  if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(host)) throw new Error('Solo HTTP loopback para verificación local');
};
http.request = function (...args) { allowed(args); return request.apply(this, args); };
http.get = function (...args) { allowed(args); return get.apply(this, args); };
require('node:module').syncBuiltinESMExports();
