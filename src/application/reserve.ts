import { createHash, randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { usd } from '../domain/money.js';

export interface ReserveRequest {
  ownerId: string; accountId: string; taskId: string; purchaseId: string;
  key: string; amountMinor: number;
}
export interface Reservation {
  id: string; purchase_id: string; account_id: string; task_id: string;
  amount_minor: number; state: 'HELD'; expires_at: number;
}
interface Account { owner_id: string; status: string; expires_at: number | null }

function validate(request: ReserveRequest): void {
  usd(request.amountMinor);
  if (!request.amountMinor) throw new Error('INVALID_AMOUNT');
  for (const id of [request.ownerId, request.accountId, request.taskId, request.purchaseId]) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new Error('INVALID_ID');
  }
  if (typeof request.key !== 'string' || !request.key.trim() || request.key.length > 200) throw new Error('INVALID_KEY');
}

function fingerprint(request: ReserveRequest): string {
  // Explicit sorted fields exclude caller property order and unrelated properties.
  return createHash('sha256').update(JSON.stringify([
    request.accountId, request.amountMinor, request.ownerId, request.purchaseId, request.taskId,
  ])).digest('hex');
}

function replay(db: Database.Database, request: ReserveRequest, hash: string): Reservation | undefined {
  const event = db.prepare('SELECT reservation_id, payload_hash FROM ledger_events WHERE account_id=? AND dedupe_key=?')
    .get(request.accountId, request.key) as { reservation_id: string; payload_hash: string } | undefined;
  if (!event) return;
  if (event.payload_hash !== hash) throw new Error('IDEMPOTENCY_CONFLICT');
  return db.prepare('SELECT * FROM reservations WHERE id=?').get(event.reservation_id) as Reservation;
}

function hold(db: Database.Database, request: ReserveRequest, now: number): Reservation {
  const task = db.prepare('SELECT deadline_at FROM tasks WHERE id=? AND account_id=? AND deadline_at>?')
    .get(request.taskId, request.accountId, now) as { deadline_at: number } | undefined;
  if (!task) throw new Error('TASK_UNAVAILABLE');
  const account = db.prepare(`UPDATE accounts SET reserved_minor=reserved_minor+?, version=version+1
    WHERE id=? AND ?<=per_purchase_minor AND reserved_minor+outstanding_minor+?<=limit_minor`)
    .run(request.amountMinor, request.accountId, request.amountMinor, request.amountMinor);
  if (!account.changes) throw new Error('CREDIT_LIMIT');
  const spent = db.prepare('UPDATE tasks SET spent_minor=spent_minor+? WHERE id=? AND spent_minor+?<=budget_minor')
    .run(request.amountMinor, request.taskId, request.amountMinor);
  if (!spent.changes) throw new Error('TASK_BUDGET');
  const purchase = db.prepare('SELECT deadline_at FROM purchases WHERE id=?').get(request.purchaseId) as {deadline_at:number}|undefined;
  const reservation: Reservation = { id: randomUUID(), purchase_id: request.purchaseId,
    account_id: request.accountId, task_id: request.taskId, amount_minor: request.amountMinor,
    state: 'HELD', expires_at: Math.min(task.deadline_at,purchase?.deadline_at??task.deadline_at) };
  db.prepare(`INSERT INTO reservations(id,purchase_id,account_id,task_id,amount_minor,state,expires_at)
    VALUES(@id,@purchase_id,@account_id,@task_id,@amount_minor,@state,@expires_at)`).run(reservation);
  return reservation;
}

function append(db: Database.Database, request: ReserveRequest, reservation: Reservation, hash: string, now: number): void {
  db.prepare(`INSERT INTO ledger_events(id,account_id,task_id,purchase_id,reservation_id,type,amount_minor,currency,dedupe_key,payload_hash,created_at)
    VALUES(?,?,?,?,?,'CREDIT_RESERVED',?,'USD',?,?,?)`).run(randomUUID(), request.accountId,
    request.taskId, request.purchaseId, reservation.id, request.amountMinor, request.key, hash, now);
  db.prepare(`INSERT INTO economic_audit(id,account_id,reservation_id,actor_id,action,created_at)
    VALUES(?,?,?,?,'CREDIT_RESERVED',?)`).run(randomUUID(), request.accountId, reservation.id, request.ownerId, now);
}

// Internal foundation command; not an Agent/HTTP API. Quote authorization is a later slice.
export function reserve(db: Database.Database, request: ReserveRequest, clock: () => number = Date.now): Reservation {
  validate(request);
  const hash = fingerprint(request);
  return db.transaction(() => {
    const account = db.prepare('SELECT owner_id,status,expires_at FROM accounts WHERE id=?')
      .get(request.accountId) as Account | undefined;
    if (!account || account.owner_id !== request.ownerId) throw new Error('ACCOUNT_FORBIDDEN');
    const existing = replay(db, request, hash);
    if (existing) return existing;
    const now = clock();
    if (!Number.isSafeInteger(now) || now < 0) throw new Error('INVALID_TIME');
    if (account.status !== 'OPEN' || (account.expires_at !== null && account.expires_at <= now)) throw new Error('ACCOUNT_INACTIVE');
    const reservation = hold(db, request, now);
    append(db, request, reservation, hash, now);
    return reservation;
  }).immediate();
}
