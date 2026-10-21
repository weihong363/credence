import { openSync, mkdirSync, closeSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { readConfig } from './config.js';
import { createApp } from './http.js';
import { PayPal } from './paypal.js';
import { Store } from './settlement.js';
const config = readConfig();
mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
// Exclusive lifetime lock: never auto-break a stale lock after a hard crash.
const lockPath = join(config.dataDir, 'process.lock');
const lock = openSync(lockPath, 'wx', 0o600);
process.on('exit', () => { closeSync(lock); unlinkSync(lockPath); });
const gateway = new PayPal(config.clientId, config.clientSecret, fetch, config.paypalBaseUrl);
const server = createApp(config, new Store(config.dataDir), gateway);
let stopping = false;
function stop(): void {
  if (stopping) return;
  stopping = true;
  // Finish in-flight requests before releasing the process lock. Persisted keys cover forced-exit ambiguity.
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 25000).unref();
}
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, stop);
server.on('error', () => { console.error('Server could not listen; check host, port and process ownership.'); process.exit(1); });
server.listen(config.port, config.host, () => console.log('Credence Sandbox server ready'));
