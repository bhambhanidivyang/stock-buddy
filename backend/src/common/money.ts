export function toNumber(value: string | number): number {
  return typeof value === 'number' ? value : Number(value);
}

export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function roundPrice(value: number): number {
  return Math.round((value + Number.EPSILON) * 10000) / 10000;
}

export function moneyString(value: number): string {
  return roundMoney(value).toFixed(2);
}

export function priceString(value: number): string {
  return roundPrice(value).toFixed(4);
}
