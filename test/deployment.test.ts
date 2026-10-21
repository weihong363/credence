import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { request } from 'node:http';
import { once } from 'node:events';
import { readConfig, SANDBOX_URL, type Config } from '../src/config.js';
import { createApp } from '../src/http.js';
import { PayPal, type Gateway, type Order } from '../src/paypal.js';
import { Store } from '../src/settlement.js';
const environment = { PAYPAL_CLIENT_ID: 'test-client', PAYPAL_CLIENT_SECRET: 'test-secret',
  PAYPAL_MERCHANT_ID: 'MERCHANT', OWNER_TOKEN: 'a'.repeat(64) };

test('local configuration keeps defaults and rejects invalid ports', () => {
  const config = readConfig(environment);
  assert.equal(config.host, '127.0.0.1'); assert.equal(config.port, 3000);
  assert.equal(config.publicUrl.origin, 'http://localhost:3000');
  for (const PORT of ['0', '-1', '65536', '123.5', '1e3', '']) assert.throws(() => readConfig({ ...environment, PORT }));
});
test('Render configuration binds assigned port and derives trusted HTTPS origin', () => {
  const config = readConfig({ ...environment, RENDER: 'true', PORT: '10000',
    RENDER_EXTERNAL_URL: 'https://credence-test.onrender.com', DATA_DIR: '/var/data/credence' });
  assert.equal(config.host, '0.0.0.0'); assert.equal(config.port, 10000);
  assert.equal(config.publicUrl.origin, 'https://credence-test.onrender.com');
  assert.equal(config.dataDir, '/var/data/credence');
  assert.equal(readConfig({ ...environment, PUBLIC_URL: 'https://custom.example',
    RENDER_EXTERNAL_URL: 'https://other.onrender.com' }).publicUrl.origin, 'https://custom.example');
});
test('invalid origins and live PayPal configuration fail before listening', () => {
  for (const PUBLIC_URL of ['http://public.example', 'https://user:password@example.com',
    'https://example.com/path', 'https://example.com/?secret=1', 'https://example.com/#x']) {
    assert.throws(() => readConfig({ ...environment, PUBLIC_URL }));
  }
  assert.throws(() => readConfig({ ...environment, PAYPAL_BASE_URL: 'https://api-m.paypal.com' }));
  assert.throws(() => new PayPal('client', 'secret', fetch, 'https://api-m.paypal.com'));
  assert.throws(() => readConfig({ ...environment, OWNER_TOKEN: 'short' }));
  assert.throws(() => readConfig({ ...environment, RENDER: 'true' }));
  assert.throws(() => readConfig({ ...environment, RENDER: 'true', PUBLIC_URL: 'http://localhost:3000' }));
  assert.throws(() => readConfig({ ...environment, PUBLIC_URL: 'not a valid URL' }));
  assert.equal(readConfig(environment).paypalBaseUrl, SANDBOX_URL);
});
async function fixture(t: TestContext) {
  const dir = mkdtempSync(`${tmpdir()}/credence-http-`);
  const config = readConfig({ ...environment, PUBLIC_URL: 'https://credence.example', DATA_DIR: dir });
  const store = new Store(dir); let status = 'APPROVED'; let calls = 0; let body: unknown;
  const order = (): Order => ({ id: 'ORDER', status, purchase_units: [{ custom_id: 'demo-bill-1',
    payee: { merchant_id: 'MERCHANT' }, amount: { currency_code: 'USD', value: '7.50' },
    payments: { captures: status === 'COMPLETED' ? [{ id: 'CAPTURE', status,
      amount: { currency_code: 'USD', value: '7.50' } }] : [] } }] });
  const gateway: Gateway = { create: async (_key, value) => { body = value; return order(); },
    get: async () => order(), capture: async () => { calls++; status = 'COMPLETED'; return order(); } };
  const server = createApp(config, store, gateway); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  t.after(async () => { await new Promise<void>(resolve => server.close(() => resolve())); rmSync(dir, { recursive: true }); });
  return { config, store, port: address.port, calls: () => calls, body: () => body };
}
function send(port: number, config: Config, path: string, method = 'GET', headers: Record<string, string> = {}) {
  return new Promise<{ status: number; body: string; headers: Record<string, unknown> }>((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method,
      headers: { Host: config.publicUrl.host, ...headers } }, res => {
      let body = ''; res.setEncoding('utf8'); res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode!, body, headers: res.headers }));
    });
    req.on('error', reject); req.end();
  });
}
test('health works for internal Render probes and discloses no configuration', async t => {
  const f = await fixture(t);
  const response = await send(f.port, f.config, '/health', 'GET', { Host: 'internal-probe' });
  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse(response.body), { status: 'ok', paymentEnvironment: 'sandbox' });
  assert.equal(response.headers['cache-control'], 'no-store'); assert.equal(f.store.load(), undefined);
});
test('owner API requires authentication, rejects foreign origins and malformed credentials', async t => {
  const f = await fixture(t); const path = '/api/create';
  assert.equal((await send(f.port, f.config, path, 'POST')).status, 401);
  const auth = { Authorization: `Bearer ${environment.OWNER_TOKEN}` };
  assert.equal((await send(f.port, f.config, path, 'POST', { ...auth, Origin: 'https://evil.example' })).status, 403);
  assert.equal((await send(f.port, f.config, path, 'POST', { ...auth, Host: 'evil.example' })).status, 403);
  assert.equal((await send(f.port, f.config, path, 'OPTIONS', { Origin: 'https://evil.example' })).status, 403);
  // Same JavaScript string length, different UTF-8 byte length must not throw in timingSafeEqual.
  const invalid = await send(f.port, f.config, path, 'POST', { Authorization: 'é'.repeat(71) });
  assert.equal(invalid.status, 401); assert.equal(invalid.headers['access-control-allow-origin'], undefined);
  assert.equal(f.store.load(), undefined);
});
test('hosted callback URLs preserve approval/capture/verification and immutable receipt', async t => {
  const f = await fixture(t); const auth = { Authorization: `Bearer ${environment.OWNER_TOKEN}` };
  const created = await send(f.port, f.config, '/api/create', 'POST', auth); assert.equal(created.status, 200);
  const r = f.store.load()!;
  const body = f.body() as { payment_source: { paypal: { experience_context: { return_url: string; cancel_url: string } } } };
  const urls = body.payment_source.paypal.experience_context;
  assert.ok(urls.return_url.startsWith('https://credence.example/return?state='));
  assert.ok(urls.cancel_url.startsWith('https://credence.example/cancel?state='));
  const returned = await send(f.port, f.config, `/return?state=${r.callback}&token=ORDER`);
  assert.equal(returned.status, 200); assert.equal(f.calls(), 0);
  assert.equal((await send(f.port, f.config, '/return?state=wrong&token=ORDER')).status, 403);
  const paid = await send(f.port, f.config, '/api/capture', 'POST', auth);
  assert.equal(JSON.parse(paid.body).state, 'SETTLED');
  const repeat = await send(f.port, f.config, '/api/capture', 'POST', auth);
  assert.equal(repeat.body, paid.body); assert.equal(f.calls(), 1);
});
test('hosted cancellation latches until explicit owner resume', async t => {
  const f = await fixture(t); const auth = { Authorization: `Bearer ${environment.OWNER_TOKEN}` };
  await send(f.port, f.config, '/api/create', 'POST', auth); const r = f.store.load()!;
  assert.equal((await send(f.port, f.config, `/cancel?state=${r.callback}&token=ORDER`)).status, 200);
  await send(f.port, f.config, '/api/capture', 'POST', auth); assert.equal(f.calls(), 0);
  await send(f.port, f.config, '/api/resume', 'POST', auth);
  const paid = await send(f.port, f.config, '/api/capture', 'POST', auth);
  assert.equal(JSON.parse(paid.body).state, 'SETTLED'); assert.equal(f.calls(), 1);
});
