import assert from 'node:assert/strict';
import test from 'node:test';
import { moduleHarness } from './support/module-harness.mjs';

test('Encabezados del backend aplican a todas las rutas sin definir otra CSP', async () => {
  const { default: config } = moduleHarness('../../next.config.ts', {});
  const rules = await config.headers();
  assert.equal(rules[0].source, '/:path*');
  const headers = Object.fromEntries(rules[0].headers.map(h => [h.key, h.value]));
  assert.equal(headers['X-Content-Type-Options'], 'nosniff');
  assert.equal(headers['Referrer-Policy'], 'strict-origin-when-cross-origin');
  assert.equal(headers['Content-Security-Policy'], undefined);
});

test('El archivo HTML público mantiene su CSP sandbox', async () => {
  const { GET } = moduleHarness('../../src/rutas/documents/[id]/file/route.ts', {
    '@/lib/auth': { isAdmin: async () => false },
    '@/lib/documents': { getDocument: async () => ({id:1}), getDocumentFile: async () => ({mime:'text/html',path:'doc.html',fileName:'doc.html'}) },
    '@/lib/storage': { storage: () => ({ get: async () => Buffer.from('<p>Documento</p>') }) },
  });
  const response = await GET(new Request('http://localhost/api/documents/1/file'), {params:Promise.resolve({id:'1'})});
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Content-Security-Policy'), "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:");
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
});
