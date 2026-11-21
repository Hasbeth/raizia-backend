/* eslint-disable @typescript-eslint/no-require-imports -- Precarga CommonJS de verificación. */
// Precarga de verificación: los stubs pueden sustituir fetch, nunca se abre una conexión HTTP.
const deny = () => { throw new Error('Verificación offline: acceso HTTP deshabilitado'); };
globalThis.fetch = async () => deny();
for (const protocol of ['node:http','node:https']) {
  const transport = require(protocol);
  transport.request = deny;
  transport.get = deny;
}
// Impide TCP externo; Turbopack usa loopback para comunicarse con sus workers.
const net = require('node:net');
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const normalized = Array.isArray(args[0]) ? args[0] : args;
  const options = typeof normalized[0] === 'object' ? normalized[0] : { host: typeof normalized[1] === 'string' ? normalized[1] : 'localhost' };
  const host = options.host || 'localhost';
  if (!['localhost', '127.0.0.1', '::1'].includes(host)) return deny();
  return connect.apply(this, args);
};

// Next puede intentar cargar archivos de entorno durante el build. No se leen.
const fs = require('node:fs');
const path = require('node:path');
const { fileURLToPath } = require('node:url');
const { syncBuiltinESMExports } = require('node:module');
const environmentFile = value => {
  if (typeof value !== 'string' && !Buffer.isBuffer(value) && !(value instanceof URL)) return false;
  const name = path.basename(value instanceof URL ? fileURLToPath(value) : String(value));
  return name === '.env' || name.startsWith('.env.');
};
const missing = () => Object.assign(new Error('Archivo de entorno excluido de la verificación'), { code: 'ENOENT' });
for (const method of ['readFileSync', 'statSync', 'openSync']) {
  const original = fs[method];
  fs[method] = function (file, ...args) { if (environmentFile(file)) throw missing(); return original.call(this, file, ...args); };
}
for (const method of ['readFile', 'stat', 'open']) {
  const original = fs[method];
  fs[method] = function (file, ...args) {
    if (environmentFile(file)) { queueMicrotask(() => args.at(-1)(missing())); return; }
    return original.call(this, file, ...args);
  };
  const promiseOriginal = fs.promises[method];
  fs.promises[method] = async function (file, ...args) { if (environmentFile(file)) throw missing(); return promiseOriginal.call(this, file, ...args); };
}
syncBuiltinESMExports();
