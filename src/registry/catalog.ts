import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { usd } from '../domain/money.js';

export const catalog = [
  { id: 'repo.inventory', price: 125, provider: 'B' },
  { id: 'repo.architecture', price: 250, provider: 'B' },
  { id: 'repo.risk-review', price: 375, provider: 'C' },
] as const;
export const acceptanceVersion = 'repository-evidence-v1';
export interface DemoIdentity { ownerId: string; buyerId: string; accountId: string }

export function seedDemo(db: Database.Database, now = Date.now()): DemoIdentity {
  return db.transaction(() => {
    const existing = db.prepare("SELECT a.id accountId,a.owner_id ownerId,a.buyer_id buyerId FROM accounts a JOIN agents g ON g.id=a.buyer_id WHERE g.name='Coordinator A'").get() as DemoIdentity | undefined;
    if (existing) return existing;
    const identity = { ownerId: randomUUID(), buyerId: randomUUID(), accountId: randomUUID() };
    db.prepare('INSERT INTO owners VALUES(?,?)').run(identity.ownerId, now);
    const providers = { B: randomUUID(), C: randomUUID() };
    for (const [id, role, name] of [[identity.buyerId,'BUYER','Coordinator A'],[providers.B,'PROVIDER','Provider B'],[providers.C,'PROVIDER','Provider C']]) {
      db.prepare('INSERT INTO agents VALUES(?,?,?,?,1)').run(id, identity.ownerId, role, name);
    }
    db.prepare("INSERT INTO accounts(id,owner_id,buyer_id,currency,limit_minor,per_purchase_minor) VALUES(?,?,?,'USD',1000,400)")
      .run(identity.accountId, identity.ownerId, identity.buyerId);
    for (const item of catalog) db.prepare('INSERT INTO capabilities VALUES(?,1,?,?,1)').run(item.id, providers[item.provider], item.price);
    return identity;
  }).immediate();
}

export function createTask(db: Database.Database, identity: DemoIdentity, objective: string, input: unknown, now = Date.now(), budget = 1000): string {
  usd(budget);
  if (!objective.trim() || objective.length > 4000) throw new Error('INVALID_OBJECTIVE');
  const account = db.prepare('SELECT 1 FROM accounts WHERE id=? AND owner_id=? AND buyer_id=?')
    .get(identity.accountId, identity.ownerId, identity.buyerId);
  if (!account) throw new Error('ACCOUNT_FORBIDDEN');
  const id = randomUUID();
  db.prepare('INSERT INTO tasks(id,account_id,budget_minor,deadline_at,objective,input_json) VALUES(?,?,?,?,?,?)')
    .run(id, identity.accountId, budget, now + 300_000, objective, JSON.stringify(input));
  return id;
}
