import {openDatabase} from '../src/persistence/database.js';
import {seedDemo} from '../src/registry/catalog.js';
import assert from 'node:assert/strict';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
async function freePort(): Promise<number> {
  const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
  const address = probe.address(); assert.ok(address && typeof address !== 'string');
  await new Promise<void>(done => probe.close(() => done())); return address.port;
}
async function boot(env: NodeJS.ProcessEnv): Promise<ChildProcessWithoutNullStreams> {
  const child = spawn(process.execPath, [resolve('dist/server.js')], { env, stdio: 'pipe' });
  await new Promise<void>((done, reject) => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Startup timed out')); }, 10000);
    child.stdout.on('data', data => { if (String(data).includes('server ready')) { clearTimeout(timer); done(); } });
    child.once('error', () => { clearTimeout(timer); reject(new Error('Startup failed')); });
    child.once('exit', code => { clearTimeout(timer); if (code !== 0) reject(new Error('Server exited')); });
  });
  return child;
}
async function stop(child: ChildProcessWithoutNullStreams): Promise<void> {
  const exited = once(child, 'exit'); child.kill('SIGTERM');
  const [code] = await exited; assert.equal(code, 0);
}
async function main(): Promise<void> {
  const dir = mkdtempSync(`${tmpdir()}/credence-production-`); const port = await freePort();
  const owner = 'production-smoke-owner-'.repeat(3);
  const env = { PATH: process.env.PATH, NODE_ENV: 'production', RENDER: 'true', HOST: '0.0.0.0',
    PORT: String(port), RENDER_EXTERNAL_URL: 'https://credence-smoke.example', DATA_DIR: dir,
    PAYPAL_CLIENT_ID: 'fake-client', PAYPAL_CLIENT_SECRET: 'fake-secret',
    PAYPAL_MERCHANT_ID: 'FAKE', OWNER_TOKEN: owner };
  const db=openDatabase(resolve(dir,'credence.sqlite'));const identity=seedDemo(db);db.close();
  let child: ChildProcessWithoutNullStreams | undefined;
  const call = (path: string, method = 'GET', expectedStatus=200) => new Promise<{ state?: string; status?: string; accounts?: {id:string}[]; error?:string } | null>((done, reject) => {
    // Native HTTP preserves the virtual Host when testing Render's TLS-proxy arrangement locally.
    const req = request({ host: '127.0.0.1', port, path, method, timeout: 5000,
      headers: { Host: 'credence-smoke.example', Authorization: `Bearer ${owner}` } }, response => {
      let body = ''; response.setEncoding('utf8'); response.on('data', chunk => { body += chunk; });
      response.on('end', () => {
        try { assert.equal(response.statusCode, expectedStatus); done(JSON.parse(body)); } catch (error) { reject(error); }
      });
    });
    req.on('error', reject); req.on('timeout', () => req.destroy(new Error('Request timed out'))); req.end();
  });
  try {
    child = await boot(env);
    assert.equal((await call('/health'))?.status,'ok');
    assert.equal((await call('/api/economy'))?.accounts?.[0].id,identity.accountId);
    assert.equal((await call('/api/create','POST',410))?.error,'P0_ARCHIVED_USE_BATCH_API');
    await stop(child);child=undefined;
    child=await boot(env);
    assert.equal((await call('/api/economy'))?.accounts?.[0].id,identity.accountId);
    await stop(child);child=undefined;
    console.log('Production smoke passed: compiled server, assigned port, health, archived P0 route, persistent SQLite account, graceful restart; no PayPal calls.');
  } finally {
    if (child && child.exitCode === null) { const exited = once(child, 'exit'); child.kill('SIGKILL'); await exited; }
    rmSync(dir, { recursive: true, force: true });
  }
}
main().catch(error => { console.error('Production smoke failed:', error instanceof Error ? error.message : 'unknown'); process.exitCode = 1; });
