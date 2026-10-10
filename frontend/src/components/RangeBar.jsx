import { formatCurrency, formatNumber } from "../format";

/**
 * Where `price` sits between `low` and `high`, as 0-100, or null when it
 * can't be placed. Clamped because a cached price can drift slightly
 * outside a range fetched at a different moment.
 */
export function rangePosition(low, high, price) {
  if (low == null || high == null || price == null) return null;
  if (high === low) return 50;
  const pct = ((price - low) / (high - low)) * 100;
  return Math.min(100, Math.max(0, pct));
}

/**
 * Inline 52-week range: low on the left, high on the right, and a marker on
 * the track at the current price. The track fills up to the marker so the
 * position reads at a glance even without finding the dot.
 */
export default function RangeBar({ low, high, price }) {
  if (low == null || high == null) return "—";

  const position = rangePosition(low, high, price);
  const title =
    position != null
      ? `52W low ${formatCurrency(low)} · price ${formatCurrency(price)} (${position.toFixed(0)}% of range) · 52W high ${formatCurrency(high)}`
      : `52W low ${formatCurrency(low)} · 52W high ${formatCurrency(high)}`;

  return (
    <div className="flex items-center gap-2 text-xs text-gray-500 tabular-nums" title={title}>
      {/* Fixed-width labels keep the tracks lined up from row to row. */}
      <span className="w-16 text-right">{formatNumber(low)}</span>
      <div className="relative shrink-0 w-24 h-1.5 rounded-full bg-blue-100" aria-hidden="true">
        {position != null && (
          <>
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-blue-300"
              style={{ width: `${position}%` }}
            />
            <div
              className="absolute top-1/2 w-2.5 h-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-blue-600 ring-2 ring-white"
              style={{ left: `${position}%` }}
            />
          </>
        )}
      </div>
      <span className="w-16">{formatNumber(high)}</span>
      <span className="sr-only">{title}</span>
    </div>
  );
}
