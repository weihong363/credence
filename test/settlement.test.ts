import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { Settlement, Store, decimal } from '../src/settlement.js';
import { PayPal, type Gateway, type Order } from '../src/paypal.js';
function fixture() {
  const store = new Store(mkdtempSync(`${tmpdir()}/paypal-test-`));
  let calls = 0; let created = 0; let status = 'APPROVED'; let fail = false;
  const order = (): Order => ({ id: 'ORDER1', status, purchase_units: [{ custom_id: 'demo-bill-1',
    amount: { currency_code: 'USD', value: '7.50' }, payee: { merchant_id: 'MERCHANT' },
    payments: { captures: status === 'COMPLETED' ? [{ id: 'CAPTURE1', status: 'COMPLETED',
      amount: { currency_code: 'USD', value: '7.50' } }] : [] } }] });
  const api: Gateway = {
    create: async () => { created++; if (fail) throw new Error('timeout'); return order(); },
    get: async () => order(),
    capture: async () => { calls++; status = 'COMPLETED'; if (fail) throw new Error('lost response'); return order(); }
  };
  const service = () => new Settlement(store, api, 'MERCHANT', 'http://localhost:3000');
  return { store, api, service, counts: () => ({ calls, created }), fail: () => { fail = true; },
    status: (value: string) => { status = value; } };
}
test('exact decimal conversion and bounded three-charge aggregate', async () => {
  assert.equal(decimal(750), '7.50'); assert.throws(() => decimal(1.1));
  const f = fixture(); const r = await f.service().run('create');
  assert.equal(r.total, '7.50'); assert.equal(r.charges.length, 3);
  assert.ok(r.charges.reduce((n,c) => n+c.cents,0) <= 1000);
});
test('restarts and repeated requests preserve one order and immutable receipt', async () => {
  const f = fixture(); await f.service().run('create'); await f.service().run('create');
  const paid = await f.service().run('capture');
  assert.equal(paid.receipt?.captureId, 'CAPTURE1');
  assert.deepEqual(await f.service().run('capture'), paid);
  assert.deepEqual(f.counts(), { calls: 1, created: 1 });
});
test('capture lost response reconciles without another capture', async () => {
  const f = fixture(); await f.service().run('create'); f.fail();
  await assert.rejects(f.service().run('capture'));
  assert.equal(f.store.load()?.state, 'UNKNOWN');
  assert.equal((await f.service().run('capture')).state, 'SETTLED');
  assert.equal(f.counts().calls, 1);
});
test('cancel remains blocked across verification and restart', async () => {
  const f = fixture(); await f.service().run('create'); await f.service().run('cancel');
  await f.service().run('verify'); await f.service().run('capture');
  assert.equal(f.counts().calls, 0);
});
test('pending, voided and unrecognized states never produce receipts', async () => {
  for (const status of ['PENDING', 'VOIDED', 'UNRECOGNIZED']) {
    const f = fixture(); await f.service().run('create'); f.status(status);
    assert.equal((await f.service().run('capture')).receipt, undefined);
    assert.equal(f.counts().calls, 0);
  }
});
test('mismatched merchant is rejected', async () => {
  const f = fixture(); await f.service().run('create');
  await assert.rejects(new Settlement(f.store, f.api, 'OTHER', 'http://localhost:3000').run('capture'));
});
test('expired ambiguous create is blocked with stable request key', async () => {
  const f = fixture(); f.fail(); await assert.rejects(f.service().run('create'));
  const r = f.store.load()!; const key = r.createKey; r.started = Date.now() - 6 * 3600000; f.store.save(r);
  await assert.rejects(f.service().run('create'));
  assert.equal(f.store.load()?.createKey, key); assert.equal(f.counts().created, 1);
});
test('OAuth is server-side, transient POST retry reuses request ID', async () => {
  const keys: string[] = []; let oauth = 0;
  const transport: typeof fetch = async (url, options) => {
    if (String(url).endsWith('/token')) { oauth++; return Response.json({ access_token: 'token', expires_in: 3600 }); }
    keys.push((options?.headers as Record<string,string>)['PayPal-Request-Id']);
    return keys.length === 1 ? new Response('', { status: 503 }) : Response.json({ id: 'ORDER', status: 'CREATED' });
  };
  await new PayPal('client', 'secret', transport).create('stable-key', {});
  assert.deepEqual(keys, ['stable-key', 'stable-key']); assert.equal(oauth, 1);
});
test('concurrent operations are rejected before another remote request', async () => {
  const f = fixture(); const service = f.service();
  const first = service.run('create');
  await assert.rejects(service.run('create'), /in progress/);
  await first; assert.equal(f.counts().created, 1);
});
test('ambiguous create retry keeps the original key and payload', async () => {
  const f = fixture(); const requests: { key: string; body: unknown }[] = [];
  f.api.create = async (key, body) => {
    requests.push({ key, body });
    if (requests.length === 1) throw new Error('timeout');
    return { id: 'ORDER1', status: 'CREATED' };
  };
  await assert.rejects(f.service().run('create'));
  await f.service().run('create'); assert.deepEqual(requests[0], requests[1]);
});
test('a capture response alone cannot settle when authoritative GET remains pending', async () => {
  const f = fixture(); await f.service().run('create');
  f.api.capture = async () => { f.status('PENDING'); return { id: 'ORDER1', status: 'COMPLETED' }; };
  assert.equal((await f.service().run('capture')).receipt, undefined);
});
test('declined and amount-mismatched captures do not settle', async () => {
  for (const mismatch of [false, true]) {
    const f = fixture(); await f.service().run('create');
    const original = f.api.get;
    f.api.get = async id => {
      const order = await original(id); order.status = 'COMPLETED';
      order.purchase_units![0].payments = { captures: [{ id: 'C', status: mismatch ? 'COMPLETED' : 'DECLINED',
        amount: { currency_code: 'USD', value: '0.01' } }] }; return order;
    };
    if (mismatch) await assert.rejects(f.service().run('verify'));
    else assert.equal((await f.service().run('verify')).state, 'FAILED');
    assert.equal(f.store.load()?.receipt, undefined);
  }
});
test('API errors expose only sanitized issue codes, never response values', async () => {
  const transport: typeof fetch = async url => String(url).endsWith('/token')
    ? Response.json({ access_token: 'private-token', expires_in: 3600 })
    : Response.json({ details: [{ issue: 'INVALID_STRING_LENGTH', value: 'private-value' },
      { issue: 'unsafe response text' }] }, { status: 400 });
  await assert.rejects(new PayPal('client', 'secret', transport).create('key', {}), error => {
    const e = error as { status: number; issues: string[] };
    assert.equal(e.status, 400); assert.deepEqual(e.issues, ['INVALID_STRING_LENGTH']);
    assert.ok(!JSON.stringify(e).includes('private-value')); return true;
  });
});
test('explicit owner resume preserves original payment keys and cancellation history', async () => {
  const f = fixture(); await f.service().run('create'); const cancelled = await f.service().run('cancel');
  const resumed = await f.service().run('resume');
  assert.equal(resumed.cancelled, false); assert.ok(resumed.resumedAt);
  assert.equal(resumed.cancelledAt, cancelled.cancelledAt);
  assert.equal(resumed.orderId, cancelled.orderId); assert.equal(resumed.captureKey, cancelled.captureKey);
  assert.equal(f.counts().calls, 0);
  const paid = await f.service().run('capture'); assert.equal(paid.state, 'SETTLED');
  assert.deepEqual(await f.service().run('capture'), paid); assert.equal(f.counts().calls, 1);
});
test('resume cannot bypass missing PayPal approval', async () => {
  const f = fixture(); await f.service().run('create'); await f.service().run('cancel');
  f.status('PAYER_ACTION_REQUIRED'); await assert.rejects(f.service().run('resume'));
  assert.equal(f.store.load()?.cancelled, true); assert.equal(f.counts().calls, 0);
});
test('capture HTTP 422 never settles, and retries retain the same operation key', async () => {
  const f = fixture(); await f.service().run('create');
  const keys: string[] = [];
  const transport: typeof fetch = async (url, options) => {
    if (String(url).endsWith('/token')) return Response.json({ access_token: 'token', expires_in: 3600 });
    keys.push(new Headers(options?.headers).get('PayPal-Request-Id')!);
    return Response.json({ details: [{ issue: 'INSTRUMENT_DECLINED' }] }, { status: 422 });
  };
  const remote = new PayPal('client', 'secret', transport);
  f.api.capture = (id, key) => remote.capture(id, key);
  for (let attempt = 0; attempt < 2; attempt++) {
    await assert.rejects(f.service().run('capture'), error => {
      assert.deepEqual((error as { issues: string[] }).issues, ['INSTRUMENT_DECLINED']); return true;
    });
    assert.equal(f.store.load()?.state, 'UNKNOWN');
    assert.equal(f.store.load()?.receipt, undefined);
  }
  assert.equal(keys.length, 2); assert.equal(keys[0], keys[1]);
});
test('cancellation before order creation survives restart and never calls PayPal', async () => {
  const f = fixture(); const cancelled = await f.service().run('cancel');
  await f.service().run('create'); await f.service().run('capture');
  assert.equal(f.store.load()?.state, 'CANCELLED'); assert.ok(cancelled.cancelledAt);
  assert.deepEqual(f.counts(), { created: 0, calls: 0 });
});
test('settled receipt cannot be changed by cancel, resume or verify', async () => {
  const f = fixture(); await f.service().run('create'); const paid = await f.service().run('capture');
  for (const action of ['cancel', 'resume', 'verify'] as const) assert.deepEqual(await f.service().run(action), paid);
});
