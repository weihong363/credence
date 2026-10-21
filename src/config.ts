import { resolve } from 'node:path';
export const SANDBOX_URL = 'https://api-m.sandbox.paypal.com';
export interface Config {
  clientId: string; clientSecret: string; merchantId: string; ownerToken: string;
  publicUrl: URL; paypalBaseUrl: string; host: string; port: number; dataDir: string;
}
function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value) throw new Error(`Missing server configuration: ${name}`);
  return value;
}
function publicOrigin(value: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('PUBLIC_URL must be a valid origin'); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:')) ||
      url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('PUBLIC_URL must be an HTTPS origin (HTTP allowed only on loopback)');
  }
  return url;
}
export function readConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const port = Number(env.PORT ?? '3000');
  if (!/^\d+$/.test(env.PORT ?? '3000') || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }
  const ownerToken = required(env, 'OWNER_TOKEN');
  if (ownerToken.length < 32) throw new Error('OWNER_TOKEN must contain at least 32 random characters');
  const paypalBaseUrl = env.PAYPAL_BASE_URL ?? SANDBOX_URL;
  if (paypalBaseUrl !== SANDBOX_URL) throw new Error('PAYPAL_BASE_URL must remain PayPal Sandbox');
  const origin = env.PUBLIC_URL || env.RENDER_EXTERNAL_URL;
  if (env.RENDER === 'true' && !origin) throw new Error('Render public origin is missing');
  const publicUrl = publicOrigin(origin || `http://localhost:${port}`);
  if (env.RENDER === 'true' && (publicUrl.protocol !== 'https:' ||
      ['localhost', '127.0.0.1', '[::1]'].includes(publicUrl.hostname))) {
    throw new Error('Render requires a public HTTPS origin');
  }
  return { clientId: required(env, 'PAYPAL_CLIENT_ID'), clientSecret: required(env, 'PAYPAL_CLIENT_SECRET'),
    merchantId: required(env, 'PAYPAL_MERCHANT_ID'), ownerToken,
    publicUrl, paypalBaseUrl,
    host: env.HOST ?? (env.RENDER === 'true' ? '0.0.0.0' : '127.0.0.1'), port,
    dataDir: resolve(env.DATA_DIR ?? '.data') };
}
