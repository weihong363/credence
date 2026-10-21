import { SANDBOX_URL } from './config.js';
export interface Order {
  id: string; status: string;
  links?: { rel: string; href: string }[];
  purchase_units?: { custom_id?: string; amount?: Money; payee?: { merchant_id?: string };
    payments?: { captures?: { id: string; status: string; amount: Money }[] } }[];
}
export interface Money { currency_code: string; value: string }
export class ApiError extends Error {
  constructor(public status: number, public issues: string[] = []) { super(`PayPal HTTP ${status}`); }
}
export interface Gateway {
  create(key: string, body: unknown): Promise<Order>;
  get(id: string): Promise<Order>;
  capture(id: string, key: string): Promise<Order>;
}
export class PayPal implements Gateway {
  private token = ''; private expires = 0;
  constructor(private client: string, private secret: string, private transport: typeof fetch = fetch,
    private baseUrl: string = SANDBOX_URL) {
    if (baseUrl !== SANDBOX_URL) throw new Error('Only PayPal Sandbox is supported');
  }
  private async access(): Promise<string> {
    if (Date.now() < this.expires) return this.token;
    const response = await this.transport(`${this.baseUrl}/v1/oauth2/token`, {
      method: 'POST', signal: AbortSignal.timeout(15000),
      headers: { Authorization: `Basic ${Buffer.from(`${this.client}:${this.secret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=client_credentials' });
    if (!response.ok) throw new ApiError(response.status);
    const data = await response.json() as { access_token: string; expires_in: number };
    if (!data.access_token || !Number.isFinite(data.expires_in)) throw new Error('Invalid OAuth response');
    this.token = data.access_token; this.expires = Date.now() + Math.max(0, data.expires_in - 60) * 1000;
    return this.token;
  }
  private async request(path: string, method = 'GET', key?: string, body?: unknown): Promise<Order> {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await this.transport(`${this.baseUrl}${path}`, {
          method, signal: AbortSignal.timeout(15000), headers: {
            Authorization: `Bearer ${await this.access()}`, 'Content-Type': 'application/json',
            Prefer: 'return=representation', ...(key ? { 'PayPal-Request-Id': key } : {}) },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
        if (response.status === 401) this.expires = 0;
        if (!response.ok) {
          const data = await response.json().catch(() => ({})) as { details?: { issue?: string }[] };
          const issues = (data.details ?? []).map(d => d.issue ?? '').filter(v => /^[A-Z_]{1,100}$/.test(v));
          throw new ApiError(response.status, issues);
        }
        return await response.json() as Order;
      } catch (error) {
        const retry = !(error instanceof ApiError) || error.status === 401 || error.status === 429 || error.status >= 500;
        if (!retry || attempt === 2) throw error;
        await new Promise(resolve => setTimeout(resolve, 250 * 2 ** attempt));
      }
    }
    throw new Error('Unreachable');
  }
  create(key: string, body: unknown): Promise<Order> { return this.request('/v2/checkout/orders', 'POST', key, body); }
  get(id: string): Promise<Order> { return this.request(`/v2/checkout/orders/${encodeURIComponent(id)}`); }
  capture(id: string, key: string): Promise<Order> {
    return this.request(`/v2/checkout/orders/${encodeURIComponent(id)}/capture`, 'POST', key, {});
  }
}
