export interface Money { readonly currency: 'USD'; readonly minor: number }
export const MAX_MINOR = 1_000_000_000;

export function usd(minor: number, currency: string = 'USD'): Money {
  if (currency !== 'USD' || !Number.isSafeInteger(minor) || minor < 0 || minor > MAX_MINOR) {
    throw new Error('INVALID_MONEY');
  }
  return Object.freeze({ currency: 'USD', minor });
}

export function add(left: Money, right: Money): Money {
  usd(left.minor, left.currency);
  usd(right.minor, right.currency);
  return usd(left.minor + right.minor);
}

export function formatUsd(value: Money): string {
  usd(value.minor, value.currency);
  return `${Math.floor(value.minor / 100)}.${String(value.minor % 100).padStart(2, '0')}`;
}
