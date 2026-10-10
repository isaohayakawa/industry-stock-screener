import { useEffect, useMemo, useState } from "react";
import { getIndustryDetail, getIndustryDetailSummary } from "../api";
import RefreshButton from "./RefreshButton";
import AiSummary from "./AiSummary";
import RangeBar, { rangePosition } from "./RangeBar";
import { formatCurrency, formatMarketCap, formatNumber, formatPercent } from "../format";

// `drivers` are the columns each preset's score is computed from (see
// score_ticker in backend/app.py), so the table can highlight them.
const PRESETS = [
  {
    value: "balanced",
    label: "Balanced",
    description: "a 50/50 blend of low P/E + P/S and high revenue growth",
    drivers: ["pe_ratio", "price_to_sales", "revenue_growth"],
  },
  {
    value: "valuation",
    label: "Valuation-weighted",
    description: "lower P/E and P/S rank higher",
    drivers: ["pe_ratio", "price_to_sales"],
  },
  {
    value: "growth",
    label: "Growth-weighted",
    description: "higher revenue growth ranks higher",
    drivers: ["revenue_growth"],
  },
];

// Columns that feed any preset. These always reserve room for the star
// (hidden when not in use) so column widths don't shift between modes.
const STAR_COLUMNS = new Set(PRESETS.flatMap((p) => p.drivers));

// Not a backend preset: the user orders rows by clicking column headers.
const CUSTOM = "custom";

// Custom mode opens on a concrete sort rather than the API's order, so the
// table always says how it's ordered.
const DEFAULT_CUSTOM_SORT = { key: "market_cap", dir: "desc" };

const COLUMNS = [
  { key: "symbol", label: "Symbol", numeric: false },
  { key: "company_name", label: "Company", numeric: false },
  { key: "price", label: "Price", numeric: true, align: "right" },
  { key: "day_change", label: "Day Change", numeric: true, align: "right" },
  // Sorts by where the price sits in the range (near the high first).
  {
    key: "year_range",
    label: "52W Range",
    numeric: true,
    sortValue: (t) => rangePosition(t.year_low, t.year_high, t.price),
  },
  { key: "pe_ratio", label: "P/E", numeric: true, align: "right" },
  { key: "price_to_sales", label: "P/S", numeric: true, align: "right" },
  { key: "revenue_growth", label: "Rev Growth", numeric: true, align: "right" },
  { key: "market_cap", label: "Market Cap", numeric: true, align: "right" },
];

/**
 * Formats an ISO timestamp (with time) for display, or null when missing.
 */
function formatTimestamp(iso) {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/**
 * Formats a date-only ISO string ("2026-09-21") for display, or null when missing.
 * Parsed as UTC noon so the local-timezone conversion can't roll it to the
 * adjacent day.
 */
function formatDateOnly(iso) {
  if (!iso) return null;
  const date = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, { dateStyle: "medium" });
}

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
    case "price":
      return formatCurrency(ticker.price);
    case "day_change":
      return formatPercent(ticker.day_change, 2, { signed: true });
    case "year_range":
      return <RangeBar low={ticker.year_low} high={ticker.year_high} price={ticker.price} />;
    case "pe_ratio":
      return formatNumber(ticker.pe_ratio);
    case "price_to_sales":
      return formatNumber(ticker.price_to_sales);
    case "revenue_growth":
      // API sends a fraction (0.193); display as a percentage.
      return formatPercent(
        ticker.revenue_growth != null ? ticker.revenue_growth * 100 : null,
        1,
        { signed: true }
      );
    case "market_cap":
      return formatMarketCap(ticker.market_cap);
    default:
      return "\u2014";
  }
}

export default function IndustryDetail({ industryName, onBack }) {
  const [data, setData] = useState(null);
  const [ranking, setRanking] = useState("balanced");
  const [loading, setLoading] = useState(true);

  // With a preset selected the rows stay in the order the API ranked them.
  // Clicking a column header switches to Custom and sorts client-side.
  const [sortKey, setSortKey] = useState(DEFAULT_CUSTOM_SORT.key);
  const [sortDir, setSortDir] = useState(DEFAULT_CUSTOM_SORT.dir);

  const isCustom = ranking === CUSTOM;
  const preset = PRESETS.find((p) => p.value === ranking);

  // The preset the current data was fetched with. Custom re-sorts
  // client-side, so switching to it keeps this instead of refetching.
  const [fetchRanking, setFetchRanking] = useState(ranking);

  useEffect(() => {
    setLoading(true);
    getIndustryDetail(industryName, fetchRanking)
      .then(setData)
      .finally(() => setLoading(false));
  }, [industryName, fetchRanking]);

  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState(null);

  // Keeps the current table on screen while the backend refetches, rather
  // than flashing back to "Loading...".
  async function handleRefresh() {
    setRefreshing(true);
    setRefreshError(null);
    try {
      setData(await getIndustryDetail(industryName, fetchRanking, { refresh: true }));
    } catch (err) {
      setRefreshError(err.message);
    } finally {
      setRefreshing(false);
    }
  }

  function handleRankingChange(value) {
    if (value === CUSTOM) {
      setSortKey(DEFAULT_CUSTOM_SORT.key);
      setSortDir(DEFAULT_CUSTOM_SORT.dir);
    } else {
      setFetchRanking(value);
    }
    setRanking(value);
  }

  function handleSort(key) {
    setRanking(CUSTOM);
    // Only toggle direction when re-clicking the column already sorted in
    // Custom mode; coming from a preset always starts a fresh sort.
    if (isCustom && key === sortKey) {
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

  // The summary doesn't depend on the ranking, so key it on the tickers'
  // fetch times: it reloads after a refresh but not on a ranking change.
  const summaryTrigger = useMemo(() => {
    if (!data) return null;
    const fetched = rows.map((t) => t.last_fetched).filter(Boolean).sort();
    return `${industryName}|${fetched[fetched.length - 1] ?? ""}`;
  }, [data, rows, industryName]);

  const sorted = useMemo(() => {
    if (!isCustom) return rows; // preset selected - keep the API's ranking order

    const column = COLUMNS.find((c) => c.key === sortKey);
    const multiplier = sortDir === "asc" ? 1 : -1;

    const getValue = column?.sortValue ?? ((t) => t[sortKey]);

    return [...rows].sort((a, b) => {
      const aVal = column?.numeric ? toNumber(getValue(a)) : getValue(a);
      const bVal = column?.numeric ? toNumber(getValue(b)) : getValue(b);

      // Nulls always sink to the bottom regardless of direction.
      if (aVal == null && bVal == null) return 0;
      if (aVal == null) return 1;
      if (bVal == null) return -1;

      if (column?.numeric) return (aVal - bVal) * multiplier;
      return String(aVal).localeCompare(String(bVal)) * multiplier;
    });
  }, [rows, isCustom, sortKey, sortDir]);

  return (
    <div className="max-w-6xl mx-auto p-6">
      <button onClick={onBack} className="text-blue-600 hover:underline mb-4">
        ← Back to industries
      </button>

      <div className="flex justify-between items-center mb-1">
        <h1 className="text-2xl font-semibold">{industryName}</h1>

        <select
          value={ranking}
          onChange={(e) => handleRankingChange(e.target.value)}
          className="border border-gray-300 rounded-md px-3 py-2"
        >
          {PRESETS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
          <option value={CUSTOM}>Custom (sort by column)</option>
        </select>
      </div>

      <div className="flex items-center gap-2 text-sm text-gray-500 mb-4">
        {data?.industry && (data.industry.data_date || data.industry.last_fetched) && (
          <span>
            Data as of{" "}
            {data.industry.data_date
              ? formatDateOnly(data.industry.data_date)
              : formatTimestamp(data.industry.last_fetched)}
          </span>
        )}
        <RefreshButton onClick={handleRefresh} refreshing={refreshing || loading} />
        {refreshError && <span className="text-red-600">{refreshError}</span>}
      </div>

      <AiSummary
        load={(opts) => getIndustryDetailSummary(industryName, opts)}
        trigger={summaryTrigger}
      />

      {loading && <p className="text-gray-500">Loading...</p>}

      {!loading && data && (
        <p className="text-sm text-gray-600 mb-2">
          {isCustom ? (
            <>
              Sorted by{" "}
              <span className="font-medium">
                {COLUMNS.find((c) => c.key === sortKey)?.label}{" "}
                {sortDir === "asc" ? "\u25B2" : "\u25BC"}
              </span>
              .{" "}
              <span className="text-gray-400">Click a column header to change the order.</span>
            </>
          ) : (
            <>
              Ranked by <span className="font-medium">{preset.label}</span>:{" "}
              {preset.description}.{" "}
              <span className="text-gray-400">
                {"\u2605"} marks the columns used for ranking. Click any column header to sort by
                it instead.
              </span>
            </>
          )}
        </p>
      )}

      {!loading && data && (
        <div className="overflow-x-auto">
          <table className="w-full border border-gray-200 rounded-md overflow-hidden">
            <thead className="bg-gray-100 text-sm">
              <tr>
                {/* Always rendered so column widths stay put when switching modes;
                    in Custom mode the content is hidden but still takes up space. */}
                <th
                  title={isCustom ? undefined : `${preset.label} rank`}
                  className="px-3 py-2 text-left"
                >
                  <span className={isCustom ? "invisible" : ""}>#</span>
                </th>
                {COLUMNS.map((column) => {
                  const isActive = isCustom && sortKey === column.key;
                  const isDriver = !isCustom && preset.drivers.includes(column.key);

                  const className = `px-3 py-2 cursor-pointer select-none ${
                    column.align === "right" ? "text-right" : "text-left"
                  } ${
                    isDriver ? "bg-blue-50 text-blue-800 hover:bg-blue-100" : "hover:bg-gray-200"
                  }`;

                  return (
                    <th
                      key={column.key}
                      onClick={() => handleSort(column.key)}
                      aria-sort={
                        isActive ? (sortDir === "asc" ? "ascending" : "descending") : undefined
                      }
                      title={
                        isDriver
                          ? `Used in ${preset.label} ranking. Click to sort by this column instead.`
                          : undefined
                      }
                      className={className}
                    >
                      {STAR_COLUMNS.has(column.key) && (
                        <span className={`mr-1 ${isDriver ? "" : "invisible"}`} aria-hidden="true">
                          {"\u2605"}
                        </span>
                      )}
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
              {sorted.map((t, index) => {
                const change = toNumber(t.day_change);
                const colorClass =
                  change == null ? "" : change >= 0 ? "text-green-600" : "text-red-600";

                return (
                  <tr key={t.symbol} className="hover:bg-gray-50">
                    <td className="px-3 py-2 text-gray-500">
                      <span className={isCustom ? "invisible" : ""}>{index + 1}</span>
                    </td>
                    {COLUMNS.map((column) => (
                      <td
                        key={column.key}
                        className={`px-3 py-2 ${column.key === "symbol" ? "font-medium" : ""} ${
                          column.align === "right" ? "text-right tabular-nums whitespace-nowrap" : ""
                        } ${
                          column.key === "year_range" ? "whitespace-nowrap" : ""
                        } ${
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
                  <td colSpan={COLUMNS.length + 1} className="px-4 py-3 text-gray-500">
                    No tickers found for this industry.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
