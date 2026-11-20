// Precarga de verificación: los stubs pueden sustituir fetch, nunca se abre una conexión HTTP.
const deny = () => { throw new Error('Verificación offline: acceso HTTP deshabilitado'); };
globalThis.fetch = async () => deny();
for (const protocol of ['node:http','node:https']) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- Precarga CommonJS síncrona mediante NODE_OPTIONS=--require.
  const transport = require(protocol);
  transport.request = deny;
  transport.get = deny;
}
