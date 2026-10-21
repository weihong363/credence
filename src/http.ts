import { createServer, type Server } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import type { Config } from './config.js';
import { ApiError, type Gateway } from './paypal.js';
import { Settlement, Store, type SettlementAction } from './settlement.js';
function equal(a: string, b: string): boolean {
  const left = Buffer.from(a); const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
export function createApp(config: Config, store: Store, gateway: Gateway): Server {
  const settlement = new Settlement(store, gateway, config.merchantId, config.publicUrl.origin);
  return createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; form-action 'self'; frame-ancestors 'none'");
    try {
      const url = new URL(req.url ?? '/', config.publicUrl);
      if (req.method === 'GET' && url.pathname === '/health') {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ status: 'ok', paymentEnvironment: 'sandbox' })); return;
      }
      if (req.headers.host !== config.publicUrl.host || url.origin !== config.publicUrl.origin ||
          (req.headers.origin !== undefined && req.headers.origin !== config.publicUrl.origin)) {
        res.writeHead(403).end(); return;
      }
      if (url.pathname === '/return' || url.pathname === '/cancel') {
        if (req.method !== 'GET') { res.writeHead(405).end(); return; }
        const r = store.load();
        if (!r || !equal(url.searchParams.get('state') ?? '', r.callback) || url.searchParams.get('token') !== r.orderId) {
          res.writeHead(403).end(); return;
        }
        if (url.pathname === '/cancel') await settlement.run('cancel');
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.end(url.pathname === '/cancel' ? 'Buyer cancelled. No new capture will be initiated.' :
          'Approval returned. The owner must now POST /api/capture; the server will verify PayPal status.');
        return;
      }
      if (!equal(req.headers.authorization ?? '', `Bearer ${config.ownerToken}`)) { res.writeHead(401).end(); return; }
      res.setHeader('Content-Type', 'application/json');
      if (req.method === 'GET' && url.pathname === '/api/settlement') {
        res.end(JSON.stringify(store.load() ?? null)); return;
      }
      const action = url.pathname.slice('/api/'.length);
      if (req.method !== 'POST' || !url.pathname.startsWith('/api/') || !['create', 'capture', 'verify', 'cancel', 'resume'].includes(action)) {
        res.writeHead(404).end(); return;
      }
      res.end(JSON.stringify(await settlement.run(action as SettlementAction)));
    } catch (error) {
      res.writeHead(409, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Operation incomplete. Read settlement state and retry or reconcile.',
        type: error instanceof Error ? error.constructor.name : 'Error',
        ...(error instanceof ApiError ? { paypalHttp: error.status, issues: error.issues } : {}) }));
    }
  });
}
