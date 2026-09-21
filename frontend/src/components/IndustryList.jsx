import { useEffect, useMemo, useState } from "react";
import { getIndustries } from "../api";

const COLUMNS = [
  { key: "name", label: "Industry", numeric: false },
  { key: "sector", label: "Sector", numeric: false },
  { key: "avg_daily_change", label: "Daily Change", numeric: true, align: "right" },
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
 * Coerce a value to a number for sorting and display.
 * The API may hand back a plain number, or a string like "+1.23%" / "-0.45%".
 * A raw `a - b` on the string form yields NaN, which makes the comparator
 * return NaN and the sort order effectively arbitrary — that's what makes
 * negatives and positives appear shuffled together.
 * Returns null when there's no usable number, so callers can sink it.
 */
function toNumber(value) {
  if (value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;

  // Strip everything except digits, minus sign, decimal point, and exponent.
  const cleaned = String(value).replace(/[^0-9eE+.-]/g, "");
  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

export default function IndustryList({ onSelectIndustry }) {
  const [industries, setIndustries] = useState([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  // Sort state: which column, and which direction.
  const [sortKey, setSortKey] = useState("name");
  const [sortDir, setSortDir] = useState("asc");

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      setLoading(true);
      getIndustries(search)
        .then(setIndustries)
        .finally(() => setLoading(false));
    }, 250); // small debounce so typing doesn't fire a request per keystroke

    return () => clearTimeout(timeoutId);
  }, [search]);

  function handleSort(key) {
    if (key === sortKey) {
      // Same column clicked again - flip direction.
      setSortDir((dir) => (dir === "asc" ? "desc" : "asc"));
    } else {
      // New column. Text defaults to A-Z; numbers default to highest first,
      // since "best performing industry" is the more useful first look.
      const column = COLUMNS.find((c) => c.key === key);
      setSortKey(key);
      setSortDir(column?.numeric ? "desc" : "asc");
    }
  }

  // Prefer the actual market date the change figures are from. Fall back to
  // the fetch timestamp only for rows from before data_date existed, or if
  // FMP couldn't be reached for a real snapshot yet.
  const dataAsOf = useMemo(() => {
    const dataDates = industries.map((i) => i.data_date).filter(Boolean).sort();
    if (dataDates.length > 0) {
      return formatDateOnly(dataDates[dataDates.length - 1]);
    }
    const timestamps = industries.map((i) => i.last_fetched).filter(Boolean).sort();
    return formatTimestamp(timestamps[timestamps.length - 1]);
  }, [industries]);

  const sorted = useMemo(() => {
    const column = COLUMNS.find((c) => c.key === sortKey);
    const multiplier = sortDir === "asc" ? 1 : -1;

    // Copy before sorting - never mutate state in place.
    return [...industries].sort((a, b) => {
      // For numeric columns, coerce first so unparseable values become null
      // and get sunk rather than poisoning the comparison with NaN.
      const aVal = column?.numeric ? toNumber(a[sortKey]) : a[sortKey];
      const bVal = column?.numeric ? toNumber(b[sortKey]) : b[sortKey];

      // Nulls always sink to the bottom regardless of direction, so a
      // missing value never outranks a real one.
      if (aVal == null && bVal == null) return 0;
      if (aVal == null) return 1;
      if (bVal == null) return -1;

      if (column?.numeric) return (aVal - bVal) * multiplier;
      return String(aVal).localeCompare(String(bVal)) * multiplier;
    });
  }, [industries, sortKey, sortDir]);

  return (
    <div className="max-w-2xl mx-auto p-6">
      <h1 className="text-2xl font-semibold mb-1">Industries</h1>
      {dataAsOf && (
        <p className="text-sm text-gray-500 mb-4">Data as of {dataAsOf}</p>
      )}

      <input
        type="text"
        placeholder="Search industries..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full border border-gray-300 rounded-md px-3 py-2 mb-4 focus:outline-none focus:ring-2 focus:ring-blue-500"
      />

      {loading && <p className="text-gray-500">Loading...</p>}

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
                  className={`px-4 py-2 cursor-pointer select-none hover:bg-gray-200 ${
                    column.align === "right" ? "text-right" : "text-left"
                  }`}
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
          {sorted.map((industry) => {
            // Same coercion as the comparator, so coloring and formatting
            // agree with the sort order no matter what type the API sent.
            const change = toNumber(industry.avg_daily_change);
            const colorClass =
              change == null
                ? "text-gray-700"
                : change >= 0
                ? "text-green-600"
                : "text-red-600";

            return (
              <tr
                key={industry.id}
                onClick={() => onSelectIndustry(industry.name)}
                className="cursor-pointer hover:bg-gray-50"
              >
                <td className={`px-4 py-3 font-medium ${colorClass}`}>{industry.name}</td>
                <td className="px-4 py-3 text-gray-600">{industry.sector || "\u2014"}</td>
                <td className={`px-4 py-3 text-right ${colorClass}`}>
                  {change != null ? `${change.toFixed(2)}%` : "\u2014"}
                </td>
              </tr>
            );
          })}

          {!loading && sorted.length === 0 && (
            <tr>
              <td colSpan={COLUMNS.length} className="px-4 py-3 text-gray-500">
                No industries match your search.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
