// Shared number formatting for the tables. Every formatter returns an em
// dash for missing or non-finite values, so cells never show "NaN".

const DASH = "—";

function isUsable(value) {
  return typeof value === "number" && Number.isFinite(value);
}

const formatters = new Map();

// Intl.NumberFormat is slow to construct, so reuse one per option set.
function formatter(options) {
  const key = JSON.stringify(options);
  if (!formatters.has(key)) formatters.set(key, new Intl.NumberFormat("en-US", options));
  return formatters.get(key);
}

/** 1234.5 -> "1,234.50" */
export function formatNumber(value, digits = 2) {
  if (!isUsable(value)) return DASH;
  return formatter({ minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
}

/** 1234.5 -> "$1,234.50" */
export function formatCurrency(value, digits = 2) {
  if (!isUsable(value)) return DASH;
  return formatter({
    style: "currency",
    currency: "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

/**
 * Takes a value already in percent units: 1.44 -> "+1.44%".
 * `signed` adds "+" to gains so they line up with losses' "-".
 */
export function formatPercent(value, digits = 2, { signed = false } = {}) {
  if (!isUsable(value)) return DASH;
  return `${formatter({
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
    signDisplay: signed ? "exceptZero" : "auto",
  }).format(value)}%`;
}

/** 11_300_000_000 -> "$11.3B"; picks T/B/M so large and small caps both read well. */
export function formatMarketCap(value) {
  if (!isUsable(value) || value <= 0) return DASH;
  const units = [
    [1e12, "T"],
    [1e9, "B"],
    [1e6, "M"],
  ];
  for (const [size, suffix] of units) {
    if (value >= size) return `$${formatNumber(value / size, 1)}${suffix}`;
  }
  return formatCurrency(value, 0);
}
