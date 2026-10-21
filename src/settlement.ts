import { randomUUID } from 'node:crypto';
import { openSync, closeSync, writeFileSync, renameSync, fsyncSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import type { Gateway, Order } from './paypal.js';
export const charges = Object.freeze([
  { id: 'service-search-1', cents: 125, verified: true },
  { id: 'service-summary-1', cents: 250, verified: true },
  { id: 'service-validation-1', cents: 375, verified: true }
]);
export function decimal(cents: number): string {
  if (!Number.isSafeInteger(cents) || cents < 0) throw new Error('Invalid minor units');
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
}
export type SettlementAction = 'create' | 'capture' | 'verify' | 'cancel' | 'resume';
export interface RecordState {
  id: string; charges: typeof charges; total: string; currency: 'USD';
  createKey: string; captureKey: string; callback: string; started?: number;
  orderId?: string; approval?: string; state: string; cancelled?: boolean; resumedAt?: string; cancelledAt?: string; captureStarted?: number;
  receipt?: Readonly<{ orderId: string; captureId: string; total: string; currency: string; verifiedAt: string }>;
}
export class Store {
  constructor(private directory: string) { mkdirSync(directory, { recursive: true, mode: 0o700 }); }
  load(): RecordState | undefined {
    const path = `${this.directory}/settlement.json`;
    return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) as RecordState : undefined;
  }
  save(record: RecordState): void {
    const path = `${this.directory}/settlement.json`;
    const fd = openSync(`${path}.tmp`, 'w', 0o600);
    try { writeFileSync(fd, JSON.stringify(record, null, 2)); fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(`${path}.tmp`, path);
    const dir = openSync(this.directory, 'r');
    try { fsyncSync(dir); } finally { closeSync(dir); }
  }
}
export class Settlement {
  private active = false;
  constructor(private store: Store, private api: Gateway, private merchant: string, private base: string) {}
  async run(action: SettlementAction): Promise<RecordState> {
    if (this.active) throw new Error('Operation in progress; retry');
    this.active = true;
    try { return await this.execute(action); } finally { this.active = false; }
  }
  private initial(): RecordState {
    // The fixed bill identity prevents a new client key from rebilling the same charges.
    if (charges.reduce((n, c) => n + c.cents, 0) > 1000) throw new Error('Internal Credit bound exceeded');
    return { id: 'demo-bill-1', charges, total: decimal(charges.reduce((n, c) => n + c.cents, 0)),
      currency: 'USD', createKey: randomUUID(), captureKey: randomUUID(), callback: randomUUID(), state: 'NEW' };
  }
  private body(r: RecordState): unknown {
    return { intent: 'CAPTURE', purchase_units: [{ custom_id: r.id, invoice_id: r.id,
      payee: { merchant_id: this.merchant }, amount: { currency_code: r.currency, value: r.total } }],
      payment_source: { paypal: { experience_context: { user_action: 'PAY_NOW', shipping_preference: 'NO_SHIPPING',
        return_url: `${this.base}/return?state=${r.callback}`, cancel_url: `${this.base}/cancel?state=${r.callback}` } } } };
  }
  private inspect(r: RecordState, order: Order): void {
    if (order.id !== r.orderId) throw new Error('Order mismatch');
    const units = order.purchase_units;
    const unit = units?.[0];
    if (units?.length !== 1 || unit?.custom_id !== r.id || unit.amount?.value !== r.total ||
        unit.amount.currency_code !== r.currency || unit.payee?.merchant_id !== this.merchant) throw new Error('Bill mismatch');
    const captures = unit.payments?.captures ?? [];
    if (order.status === 'COMPLETED' && captures.length === 1 && captures[0].status === 'COMPLETED') {
      const capture = captures[0];
      if (!capture.id || capture.amount.value !== r.total || capture.amount.currency_code !== r.currency) throw new Error('Capture mismatch');
      r.receipt = Object.freeze({ orderId: order.id, captureId: capture.id, total: r.total,
        currency: r.currency, verifiedAt: new Date().toISOString() });
      r.state = 'SETTLED';
    } else if (captures.some(c => ['DECLINED', 'FAILED'].includes(c.status)) || order.status === 'VOIDED') r.state = 'FAILED';
    else r.state = captures.length || order.status === 'COMPLETED' ? 'UNKNOWN' : order.status;
  }
  private async execute(action: SettlementAction): Promise<RecordState> {
    const r = this.store.load() ?? this.initial();
    if (r.receipt) return r;
    if (action === 'cancel') { r.cancelled = true; r.cancelledAt = new Date().toISOString(); r.state = 'CANCELLED'; this.store.save(r); return r; }
    try {
      if (!r.orderId && action === 'create' && !r.cancelled) {
        if (r.started && Date.now() - r.started > 5 * 3600000) throw new Error('Create retry window expired; reconcile manually');
        r.started ??= Date.now(); r.state = 'CREATING'; this.store.save(r);
        const order = await this.api.create(r.createKey, this.body(r));
        if (!order.id) throw new Error('Missing order ID');
        r.orderId = order.id;
        r.approval = order.links?.find(l => l.rel === 'payer-action' || l.rel === 'approve')?.href;
        r.state = order.status; this.store.save(r);
      }
      if (r.orderId && action !== 'create') {
        this.inspect(r, await this.api.get(r.orderId));
        if (action === 'resume' && r.cancelled && !r.receipt) {
          if (r.state !== 'APPROVED') throw new Error('Resume requires authoritative buyer approval');
          r.cancelled = false; r.resumedAt = new Date().toISOString();
        }
        const cancelled = r.cancelled === true;
        if (action === 'capture' && !cancelled && !r.receipt && r.state === 'APPROVED') {
          if (r.captureStarted && Date.now() - r.captureStarted > 5 * 3600000) throw new Error('Capture retry window expired; reconcile manually');
          r.captureStarted ??= Date.now(); r.state = 'CAPTURING'; this.store.save(r);
          await this.api.capture(r.orderId, r.captureKey);
          this.inspect(r, await this.api.get(r.orderId));
        }
        if (cancelled && !r.receipt) r.state = 'CANCELLED';
      }
      this.store.save(r); return r;
    } catch (error) { r.state = 'UNKNOWN'; this.store.save(r); throw error; }
  }
}
