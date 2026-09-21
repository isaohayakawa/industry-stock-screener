import { useEffect, useMemo, useState } from "react";
import { getIndustryDetail } from "../api";

const PRESETS = [
  { value: "balanced", label: "Balanced" },
  { value: "valuation", label: "Valuation-weighted" },
  { value: "growth", label: "Growth-weighted" },
];

const COLUMNS = [
  { key: "symbol", label: "Symbol", numeric: false },
  { key: "company_name", label: "Company", numeric: false },
  { key: "day_change", label: "Day Change", numeric: true },
  { key: "pe_ratio", label: "P/E", numeric: true },
  { key: "price_to_sales", label: "P/S", numeric: true },
  { key: "revenue_growth", label: "Rev Growth", numeric: true },
  { key: "market_cap", label: "Market Cap", numeric: true },
];

/**
 * Coerce a value to a number for sorting. The API is expected to send
 * plain numbers for these fields, but this guards against a string
 * slipping through (e.g. "12.3") without poisoning the sort with NaN.
 * Returns null when there's no usable number, so callers can sink it.
 */
function toNumber(value) {
  if (value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const cleaned = String(value).replace(/[^0-9eE+.-]/g, "");
  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatCell(key, ticker) {
  switch (key) {
    case "symbol":
      return ticker.symbol;
    case "company_name":
      return ticker.company_name || "\u2014";
    case "day_change":
      return ticker.day_change != null ? `${ticker.day_change.toFixed(2)}%` : "\u2014";
    case "pe_ratio":
      return ticker.pe_ratio?.toFixed(2) ?? "\u2014";
    case "price_to_sales":
      return ticker.price_to_sales?.toFixed(2) ?? "\u2014";
    case "revenue_growth":
      return ticker.revenue_growth != null
        ? `${(ticker.revenue_growth * 100).toFixed(1)}%`
        : "\u2014";
    case "market_cap":
      return ticker.market_cap ? `$${(ticker.market_cap / 1e9).toFixed(1)}B` : "\u2014";
    default:
      return "\u2014";
  }
}

export default function IndustryDetail({ industryName, onBack }) {
  const [data, setData] = useState(null);
  const [ranking, setRanking] = useState("balanced");
  const [loading, setLoading] = useState(true);

  // Column sorting is separate from the backend ranking preset: the preset
  // decides the order the API hands back, sorting a column just re-orders
  // whatever's currently on screen.
  const [sortKey, setSortKey] = useState(null);
  const [sortDir, setSortDir] = useState("asc");

  useEffect(() => {
    setLoading(true);
    getIndustryDetail(industryName, ranking)
      .then(setData)
      .finally(() => setLoading(false));
  }, [industryName, ranking]);

  // Switching industry or ranking preset drops any manual column sort, so
  // the freshly-fetched ranking order is what's shown until the user
  // clicks a header again.
  useEffect(() => {
    setSortKey(null);
  }, [industryName, ranking]);

  function handleSort(key) {
    if (key === sortKey) {
      setSortDir((dir) => (dir === "asc" ? "desc" : "asc"));
    } else {
      const column = COLUMNS.find((c) => c.key === key);
      setSortKey(key);
      // Text starts A-Z; numeric columns start highest-first, since that's
      // usually the more useful first look at ranked tickers.
      setSortDir(column?.numeric ? "desc" : "asc");
    }
  }

  const rows = data?.tickers ?? [];

  const sorted = useMemo(() => {
    if (!sortKey) return rows; // no manual sort yet - keep the API's ranking order

    const column = COLUMNS.find((c) => c.key === sortKey);
    const multiplier = sortDir === "asc" ? 1 : -1;

    return [...rows].sort((a, b) => {
      const aVal = column?.numeric ? toNumber(a[sortKey]) : a[sortKey];
      const bVal = column?.numeric ? toNumber(b[sortKey]) : b[sortKey];

      // Nulls always sink to the bottom regardless of direction.
      if (aVal == null && bVal == null) return 0;
      if (aVal == null) return 1;
      if (bVal == null) return -1;

      if (column?.numeric) return (aVal - bVal) * multiplier;
      return String(aVal).localeCompare(String(bVal)) * multiplier;
    });
  }, [rows, sortKey, sortDir]);

  return (
    <div className="max-w-3xl mx-auto p-6">
      <button onClick={onBack} className="text-blue-600 hover:underline mb-4">
        ← Back to industries
      </button>

      <div className="flex justify-between items-center mb-4">
        <h1 className="text-2xl font-semibold">{industryName}</h1>

        <select
          value={ranking}
          onChange={(e) => setRanking(e.target.value)}
          className="border border-gray-300 rounded-md px-3 py-2"
        >
          {PRESETS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </div>

      {loading && <p className="text-gray-500">Loading...</p>}

      {!loading && data && (
        <table className="w-full border border-gray-200 rounded-md overflow-hidden">
          <thead className="bg-gray-100 text-sm">
            <tr>
              {COLUMNS.map((column) => {
                const isActive = sortKey === column.key;
                return (
                  <th
                    key={column.key}
                    onClick={() => handleSort(column.key)}
                    aria-sort={
                      isActive ? (sortDir === "asc" ? "ascending" : "descending") : "none"
                    }
                    className="px-4 py-2 text-left cursor-pointer select-none hover:bg-gray-200"
                  >
                    {column.label}
                    <span className="ml-1 text-gray-400">
                      {isActive ? (sortDir === "asc" ? "\u25B2" : "\u25BC") : "\u21C5"}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {sorted.map((t) => {
              const change = toNumber(t.day_change);
              const colorClass =
                change == null ? "" : change >= 0 ? "text-green-600" : "text-red-600";

              return (
                <tr key={t.symbol} className="hover:bg-gray-50">
                  {COLUMNS.map((column) => (
                    <td
                      key={column.key}
                      className={`px-4 py-2 ${column.key === "symbol" ? "font-medium" : ""} ${
                        column.key === "day_change" ? colorClass : ""
                      }`}
                    >
                      {formatCell(column.key, t)}
                    </td>
                  ))}
                </tr>
              );
            })}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={COLUMNS.length} className="px-4 py-3 text-gray-500">
                  No tickers found for this industry.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}
