import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { ApiError, PayPal, type Order } from '../src/paypal.js';
import { decimal, type RecordState } from '../src/settlement.js';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}
const client = required('PAYPAL_CLIENT_ID');
const secret = required('PAYPAL_CLIENT_SECRET');
const merchant = required('PAYPAL_MERCHANT_ID');
const owner = required('OWNER_TOKEN');
const ledger = JSON.parse(readFileSync('.data/settlement.json', 'utf8')) as RecordState;
const api = new PayPal(client, secret);

function checkOrder(order: Order): void {
  assert.equal(order.id, ledger.orderId);
  assert.equal(order.status, 'COMPLETED');
  assert.equal(order.purchase_units?.length, 1);
  const unit = order.purchase_units![0];
  assert.equal(unit.custom_id, ledger.id);
  assert.equal(unit.payee?.merchant_id, merchant);
  assert.deepEqual(unit.amount && { currency_code: unit.amount.currency_code, value: unit.amount.value },
    { currency_code: ledger.currency, value: ledger.total });
  assert.equal(unit.payments?.captures?.length, 1);
  const capture = unit.payments!.captures![0];
  assert.equal(capture.id, ledger.receipt?.captureId);
  assert.equal(capture.status, 'COMPLETED');
  assert.deepEqual(capture.amount, { currency_code: ledger.currency, value: ledger.total });
}
async function repeat(action: string): Promise<{ action: string; http: number; sameReceipt: boolean }> {
  const response = await fetch(`http://localhost:3000/api/${action}`, {
    method: 'POST', signal: AbortSignal.timeout(15000), headers: { Authorization: `Bearer ${owner}` } });
  assert.equal(response.status, 200);
  const result = await response.json() as RecordState;
  assert.equal(result.state, 'SETTLED');
  assert.deepEqual(result.receipt, ledger.receipt);
  assert.deepEqual(result.charges, ledger.charges);
  return { action, http: response.status, sameReceipt: true };
}
async function negativeCapture(): Promise<{ http: number; issues: string[]; kind: string }> {
  // Only a previously completed, independently verified order is eligible for this probe.
  // If Sandbox ignores its mock header, the existing completed order cannot be recaptured.
  const transport: typeof fetch = async (url, options) => {
    const headers = new Headers(options?.headers);
    if (String(url).endsWith('/capture')) {
      headers.set('PayPal-Mock-Response', JSON.stringify({ mock_application_codes: 'INSTRUMENT_DECLINED' }));
    }
    return fetch(url, { ...options, headers });
  };
  try {
    await new PayPal(client, secret, transport).capture(ledger.orderId!, randomUUID());
    throw new Error('Negative probe unexpectedly returned success; inspect order');
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    assert.equal(error.status, 422);
    assert.ok(error.issues.includes('INSTRUMENT_DECLINED'));
    return { http: error.status, issues: error.issues, kind: 'PayPal Sandbox injected response; not a real funding decline' };
  }
}
async function main(): Promise<void> {
  assert.equal(ledger.state, 'SETTLED'); assert.ok(ledger.receipt);
  assert.equal(ledger.charges.length, 3);
  assert.ok(ledger.charges.every(c => c.verified));
  assert.equal(new Set(ledger.charges.map(c => c.id)).size, 3);
  const total = ledger.charges.reduce((sum, c) => sum + c.cents, 0);
  assert.ok(total <= 1000); assert.equal(decimal(total), ledger.total);
  assert.equal(ledger.receipt.orderId, ledger.orderId);
  const before = await api.get(ledger.orderId!); checkOrder(before);
  const repeats = [];
  for (const action of ['create', 'capture', 'capture', 'verify']) repeats.push(await repeat(action));
  const negative = process.argv.includes('--negative') ? await negativeCapture() : undefined;
  const after = await api.get(ledger.orderId!); checkOrder(after);
  const persisted = JSON.parse(readFileSync('.data/settlement.json', 'utf8')) as RecordState;
  assert.deepEqual(persisted, ledger);
  const evidence = { verifiedAt: new Date().toISOString(), billId: ledger.id,
    charges: ledger.charges, total: ledger.total, currency: ledger.currency,
    receipt: ledger.receipt, orderStatus: after.status, merchantMatches: true,
    billMatchesCustomId: true, captureCountBefore: 1, captureCountAfter: 1,
    ledgerUnchanged: true, repeats, negative };
  const path = negative ? 'docs/phase0-negative-evidence.json' : 'docs/phase0-settlement-evidence.json';
  writeFileSync(path, JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify({ evidence: path, orderId: after.id, status: after.status,
    captureId: ledger.receipt.captureId, captureCount: 1, negative }));
}
main().catch(error => {
  // Avoid assertion diagnostics containing raw API responses or configuration.
  console.error(JSON.stringify({ error: 'Phase 0 verification failed; no success evidence written',
    ...(error instanceof ApiError ? { http: error.status, issues: error.issues } : {}) }));
  process.exitCode = 1;
});
