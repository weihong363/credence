import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { openDatabase } from '../src/persistence/database.js';
import { reserve, type ReserveRequest } from '../src/application/reserve.js';
import { usd, add, formatUsd } from '../src/domain/money.js';

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'credence-credit-'));
  const path = join(directory, 'runtime.sqlite');
  const db = openDatabase(path);
  const request: ReserveRequest = { ownerId: randomUUID(), accountId: randomUUID(), taskId: randomUUID(),
    purchaseId: randomUUID(), key: randomUUID(), amountMinor: 70 };
  db.prepare('INSERT INTO accounts(id,owner_id,buyer_id,currency,limit_minor,per_purchase_minor) VALUES(?,?,?,\'USD\',100,100)')
    .run(request.accountId, request.ownerId, randomUUID());
  db.prepare('INSERT INTO tasks(id,account_id,budget_minor,deadline_at) VALUES(?,?,100,9999999999999)')
    .run(request.taskId, request.accountId);
  return { db, path, request, close: () => { db.close(); rmSync(directory, { recursive: true, force: true }); } };
}
function counts(db: ReturnType<typeof openDatabase>): number[] {
  return ['reservations', 'ledger_events', 'economic_audit'].map(table =>
    (db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n);
}

test('USD amounts reject unsafe inputs and overflow, format without floating arithmetic', () => {
  for (const amount of [-1, 0.1, NaN, Infinity, 1_000_000_001, Number.MAX_SAFE_INTEGER]) assert.throws(() => usd(amount));
  assert.throws(() => usd(10, 'EUR'));
  assert.throws(() => add(usd(1_000_000_000), usd(1)));
  assert.equal(formatUsd(add(usd(125), usd(250))), '3.75');
  assert.equal(formatUsd(usd(1)), '0.01');
});

test('migration settings, durable replay, conflict and business uniqueness', () => {
  const f = fixture();
  try {
    assert.equal(f.db.pragma('journal_mode', { simple: true }), 'wal');
    assert.equal(f.db.pragma('foreign_keys', { simple: true }), 1);
    assert.equal(f.db.pragma('synchronous', { simple: true }), 2);
    const first = reserve(f.db, f.request, () => 100);
    const second = openDatabase(f.path);
    try { assert.deepEqual(reserve(second, f.request), first); } finally { second.close(); }
    assert.throws(() => reserve(f.db, { ...f.request, amountMinor: 40 }), /IDEMPOTENCY_CONFLICT/);
    assert.throws(() => reserve(f.db, { ...f.request, key: randomUUID(), amountMinor: 1 }), /UNIQUE/);
    assert.deepEqual(counts(f.db), [1, 1, 1]);
    assert.equal((f.db.prepare('SELECT reserved_minor FROM accounts').get() as {reserved_minor:number}).reserved_minor, 70);
    assert.equal((f.db.prepare('SELECT sum(amount_minor) total FROM ledger_events').get() as {total:number}).total, 70);
    for (const table of ['ledger_events', 'economic_audit']) {
      assert.throws(() => f.db.exec(`DELETE FROM ${table}`), /APPEND_ONLY/);
      assert.throws(() => f.db.exec(`UPDATE ${table} SET id='changed'`), /APPEND_ONLY/);
    }
  } finally { f.close(); }
});

test('audit failure rolls back reservation, ledger, account and task in one transaction', () => {
  const f = fixture();
  try {
    f.db.exec("CREATE TRIGGER fail_audit BEFORE INSERT ON economic_audit BEGIN SELECT RAISE(ABORT,'injected'); END");
    assert.throws(() => reserve(f.db, f.request), /injected/);
    assert.deepEqual(counts(f.db), [0, 0, 0]);
    assert.equal((f.db.prepare('SELECT reserved_minor FROM accounts').get() as {reserved_minor:number}).reserved_minor, 0);
    assert.equal((f.db.prepare('SELECT spent_minor FROM tasks').get() as {spent_minor:number}).spent_minor, 0);
    f.db.exec('DROP TRIGGER fail_audit');
    reserve(f.db, f.request);
    assert.deepEqual(counts(f.db), [1, 1, 1]);
  } finally { f.close(); }
});

test('denials leave no financial effects', () => {
  const f = fixture();
  try {
    assert.throws(() => reserve(f.db, {...f.request, ownerId:randomUUID()}), /FORBIDDEN/);
    assert.throws(() => reserve(f.db, {...f.request, amountMinor:101}), /CREDIT_LIMIT/);
    f.db.exec('UPDATE tasks SET budget_minor=50');
    assert.throws(() => reserve(f.db, f.request), /TASK_BUDGET/);
    f.db.exec('UPDATE tasks SET deadline_at=1');
    assert.throws(() => reserve(f.db, f.request), /TASK_UNAVAILABLE/);
    f.db.exec("UPDATE accounts SET status='SUSPENDED'");
    assert.throws(() => reserve(f.db, f.request), /ACCOUNT_INACTIVE/);
    f.db.exec("UPDATE accounts SET status='OPEN', expires_at=1");
    assert.throws(() => reserve(f.db, f.request), /ACCOUNT_INACTIVE/);
    assert.deepEqual(counts(f.db), [0,0,0]);
    assert.equal((f.db.prepare('SELECT reserved_minor FROM accounts').get() as {reserved_minor:number}).reserved_minor, 0);
  } finally { f.close(); }
});

test('two independent processes compete for 100: only one of 70 and 40 commits', { timeout: 15000 }, async () => {
  const f = fixture();
  const children = [70,40].map(amountMinor => fork(new URL('../scripts/reservation-contender.ts', import.meta.url), [], {
    execArgv: ['--import', 'tsx'], stdio: ['ignore','ignore','inherit','ipc'],
    env: {...process.env, CREDIT_TEST_PATH:f.path, CREDIT_TEST_REQUEST:JSON.stringify({...f.request, amountMinor, key:randomUUID(), purchaseId:randomUUID()})},
  }));
  try {
    await Promise.all(children.map(child => once(child,'message')));
    const outcomes = children.map(child => once(child,'message'));
    const exits = children.map(child => once(child,'exit'));
    children.forEach(child => child.send('go'));
    const results = (await Promise.all(outcomes)).map(([result]) => result as string);
    await Promise.all(exits);
    assert.equal(results.filter(result => result === 'OK').length, 1);
    assert.equal(results.filter(result => result === 'CREDIT_LIMIT').length, 1);
    assert.deepEqual(counts(f.db), [1,1,1]);
    const account = f.db.prepare('SELECT reserved_minor FROM accounts').get() as {reserved_minor:number};
    assert.ok([40,70].includes(account.reserved_minor));
    assert.equal((f.db.prepare('SELECT sum(amount_minor) total FROM reservations').get() as {total:number}).total, account.reserved_minor);
  } finally { children.forEach(child => child.kill()); f.close(); }
});
