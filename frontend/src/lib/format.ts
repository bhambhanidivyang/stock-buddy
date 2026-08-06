export function formatInr(value: number | null | undefined) {
  const n = Number(value);
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(Number.isFinite(n) ? n : 0);
}

export function formatPrice(value: number | null | undefined) {
  const n = Number(value);
  return new Intl.NumberFormat("en-IN", {
    maximumFractionDigits: 2,
  }).format(Number.isFinite(n) ? n : 0);
}

export function pnlClass(value: number) {
  if (value > 0) return "text-teal-700";
  if (value < 0) return "text-rose-700";
  return "text-stone-600";
}
