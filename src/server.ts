import { createServer } from 'node:http';
import { openSync, mkdirSync, closeSync, unlinkSync } from 'node:fs';
import { timingSafeEqual } from 'node:crypto';
import { ApiError, PayPal } from './paypal.js';
import { Settlement, Store, type SettlementAction } from './settlement.js';
function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing server configuration: ${name}`);
  return value;
}
const client = required('PAYPAL_CLIENT_ID');
const secret = required('PAYPAL_CLIENT_SECRET');
const merchant = required('PAYPAL_MERCHANT_ID');
const owner = required('OWNER_TOKEN');
if (owner.length < 32) throw new Error('OWNER_TOKEN must contain at least 32 random characters');
const base = new URL(process.env.PUBLIC_URL ?? 'http://localhost:3000');
if (base.origin !== 'http://localhost:3000' || base.pathname !== '/') throw new Error('This local spike requires PUBLIC_URL=http://localhost:3000');
mkdirSync('.data', { recursive: true, mode: 0o700 });
// Exclusive lifetime lock: never auto-break a stale lock after a crash.
const lock = openSync('.data/process.lock', 'wx', 0o600);
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => process.exit(0));
process.on('exit', () => { closeSync(lock); unlinkSync('.data/process.lock'); });
const store = new Store('.data');
const settlement = new Settlement(store, new PayPal(client, secret), merchant, base.origin);
function equal(a: string, b: string): boolean {
  return a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'none'; form-action 'self'; frame-ancestors 'none'");
  try {
    const url = new URL(req.url ?? '/', base);
    if (req.headers.host !== base.host) { res.writeHead(403).end(); return; }
    if (url.pathname === '/return' || url.pathname === '/cancel') {
      const r = store.load();
      if (!r || !equal(url.searchParams.get('state') ?? '', r.callback) || url.searchParams.get('token') !== r.orderId) {
        res.writeHead(403).end(); return;
      }
      if (url.pathname === '/cancel') await settlement.run('cancel');
      res.end(url.pathname === '/cancel' ? 'Buyer cancelled. No new capture will be initiated.' :
        'Approval returned. The owner must now POST /api/capture; the server will verify PayPal status.');
      return;
    }
    if (!equal(req.headers.authorization ?? '', `Bearer ${owner}`)) { res.writeHead(401).end(); return; }
    res.setHeader('Content-Type', 'application/json');
    if (req.method === 'GET' && url.pathname === '/api/settlement') {
      res.end(JSON.stringify(store.load() ?? null)); return;
    }
    const action = url.pathname.slice('/api/'.length);
    if (req.method !== 'POST' || !url.pathname.startsWith('/api/') || !['create', 'capture', 'verify', 'cancel', 'resume'].includes(action)) {
      res.writeHead(404).end(); return;
    }
    const result = await settlement.run(action as SettlementAction);
    res.end(JSON.stringify(result));
  } catch (error) {
    res.writeHead(409, { 'Content-Type': 'application/json' });
    // Never return transport errors or PayPal payloads that could contain credentials or payer information.
    res.end(JSON.stringify({ error: 'Operation incomplete. Read settlement state and retry or reconcile.',
      type: error instanceof Error ? error.constructor.name : 'Error',
      ...(error instanceof ApiError ? { paypalHttp: error.status, issues: error.issues } : {}) }));
  }
}).listen(3000, '127.0.0.1', () => console.log('Sandbox spike: http://localhost:3000'));
