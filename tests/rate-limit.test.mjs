import assert from 'node:assert/strict';
import test from 'node:test';
import * as crypto from 'node:crypto';
import { moduleHarness } from './support/module-harness.mjs';
import { routeHarness } from './support/route-harness.mjs';

function setup(t, config = {}) {
  for (const [name, value] of Object.entries({ RAIZIA_MODO: 'local', CHAT_LIMIT_IP_PER_MINUTE: '12', CHAT_LIMIT_IP_PER_DAY: '80', CHAT_LIMIT_GLOBAL_PER_DAY: '1500', ...config })) {
    const previous = process.env[name];
    process.env[name] = value;
    t.after(() => { if (previous === undefined) delete process.env[name]; else process.env[name] = previous; });
  }
  const counts = new Map(), stored = [];
  const database = { async query(sql, params) {
    assert.match(sql, /ON CONFLICT\(bucket,window_start\)\s+DO UPDATE SET count=rate_limits.count\+1 RETURNING count/);
    stored.push(params);
    const key = JSON.stringify(params);
    const count = (counts.get(key) || 0) + 1;
    counts.set(key, count);
    return [{ count }];
  } };
  return { ...moduleHarness('../../src/lib/rate-limit.ts', { 'node:crypto': crypto, './db': { tx: fn => fn(database) } }), stored, database };
}
const request = (ip = '203.0.113.9', real = '198.51.100.4') => new Request('http://localhost/api/chat', { headers: { 'x-forwarded-for': ip, 'x-real-ip': real } });
const now = new Date('2026-11-21T13:00:15.000Z');

test('12/min por primera IP; otra IP pasa y la siguiente ventana reinicia', async t => {
  const { checkChatLimit } = setup(t);
  for (let i = 0; i < 12; i++) assert.equal((await checkChatLimit(request('203.0.113.9, 10.0.0.1'), now)).allowed, true);
  assert.deepEqual(await checkChatLimit(request(), now), { allowed: false, retryAfter: 45 });
  assert.equal((await checkChatLimit(request('203.0.113.10'), now)).allowed, true);
  assert.equal((await checkChatLimit(request(), new Date('2026-11-21T13:01:00Z'))).allowed, true);
});

test('80/día por IP; cambia el hash y el cupo a medianoche UTC', async t => {
  const { checkChatLimit, stored } = setup(t);
  for (let i = 0; i < 80; i++) assert.equal((await checkChatLimit(request(), new Date(now.getTime() + i * 60_000))).allowed, true);
  assert.equal((await checkChatLimit(request(), new Date('2026-11-21T23:59:50Z'))).retryAfter, 10);
  const first = stored[0][0];
  assert.equal((await checkChatLimit(request(), new Date('2026-11-22T00:00:00Z'))).allowed, true);
  assert.notEqual(stored.at(-3)[0], first);
});

test('Tope global configurable agrega IP diferentes', async t => {
  const { checkChatLimit } = setup(t, { CHAT_LIMIT_GLOBAL_PER_DAY: '2' });
  assert.equal((await checkChatLimit(request('a'), now)).allowed, true);
  assert.equal((await checkChatLimit(request('b'), now)).allowed, true);
  assert.equal((await checkChatLimit(request('c'), now)).allowed, false);
});

test('El tope global por defecto permite 1500 consultas y rechaza la 1501', async t => {
  const { checkChatLimit } = setup(t);
  for (let i = 0; i < 1500; i++) assert.equal((await checkChatLimit(request(`test-${i}`), now)).allowed, true);
  assert.deepEqual(await checkChatLimit(request('test-1500'), now), {allowed:false,retryAfter:39585});
});

test('IP hasheada; x-real-ip de respaldo, sin IP en SQL ni logs de errores', async t => {
  const { checkChatLimit, stored, database } = setup(t, { CHAT_LIMIT_IP_PER_MINUTE: '1' });
  const onlyReal = new Request('http://localhost/api/chat', { headers: { 'x-real-ip': '198.51.100.4' } });
  assert.equal((await checkChatLimit(onlyReal, now)).allowed, true);
  assert.equal((await checkChatLimit(request('', '198.51.100.4'), now)).allowed, false);
  for (const [bucket] of stored) assert.match(bucket, /^chat:(?:(?:minute|day):[a-f0-9]{64}|global)$/);
  assert.ok(!JSON.stringify(stored).includes('198.51.100.4'));
  const logs = [];
  t.mock.method(console, 'error', (...args) => logs.push(args));
  database.query = async () => { throw new Error('IP privada 198.51.100.4'); };
  assert.equal((await checkChatLimit(onlyReal, now)).allowed, true);
  assert.equal(logs.length, 1);
  assert.ok(!JSON.stringify(logs).includes('198.51.100.4'));
});

test('429 normal con Retry-After; saludos no consumen cupos ni buscan', async () => {
  const message = 'Hay muchas consultas en este momento. Espera un momento y vuelve a preguntar.';
  let calls = 0;
  const { POST } = routeHarness({ rag: { isSmallTalk: m => m === 'hola', ollamaStatus: async () => ({ available: false }), STATIC_GREETING: 'Hola' }, rateLimit: {
    CHAT_LIMIT_MESSAGE: message, checkChatLimit: async () => { calls++; return { allowed: false, retryAfter: 30 }; },
  } })('chat');
  const send = text => POST(new Request('http://localhost/api/chat', { method: 'POST', body: JSON.stringify({ message: text }) }));
  const blocked = await send('consulta');
  assert.equal(blocked.status, 429);
  assert.equal(blocked.headers.get('Retry-After'), '30');
  assert.deepEqual(await blocked.json(), { message });
  const greeting = await send('hola');
  assert.equal(greeting.status, 200);
  assert.match(await greeting.text(), /Hola/);
  assert.equal(calls, 1);
});
