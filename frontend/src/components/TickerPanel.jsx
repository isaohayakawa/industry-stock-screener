import { useEffect, useState } from "react";
import { getTickerDetail } from "../api";
import RefreshButton from "./RefreshButton";
import RangeBar from "./RangeBar";
import { SkeletonLines } from "./Skeleton";
import {
  formatCompactCurrency,
  formatCurrency,
  formatMarketCap,
  formatNumber,
  formatPercent,
} from "../format";

const DASH = "—";

// The API sends margins, yields, and growth as fractions (0.175).
const fraction = (digits) => (value) => formatPercent(value != null ? value * 100 : null, digits);

const SCORE_PRESETS = [
  { value: "balanced", label: "Balanced" },
  { value: "valuation", label: "Valuation" },
  { value: "growth", label: "Growth" },
];

// Metrics behind the peer score (see metric_percentiles in backend/app.py).
const SCORE_METRICS = [
  { key: "pe_ratio", label: "P/E", hint: "lower is better", format: formatNumber },
  { key: "price_to_sales", label: "P/S", hint: "lower is better", format: formatNumber },
  {
    key: "revenue_growth",
    label: "Rev Growth",
    hint: "higher is better",
    format: (v) => formatPercent(v != null ? v * 100 : null, 1, { signed: true }),
  },
];

const RATIO_GROUPS = [
  {
    title: "Valuation",
    rows: [
      { key: "pe_ratio", label: "P/E", format: formatNumber },
      { key: "peg_ratio", label: "PEG", format: formatNumber },
      { key: "price_to_sales", label: "P/S", format: formatNumber },
      { key: "price_to_book", label: "P/B", format: formatNumber },
      { key: "price_to_free_cash_flow", label: "P/FCF", format: formatNumber },
      { key: "ev_to_ebitda", label: "EV/EBITDA", format: formatNumber },
      { key: "enterprise_value", label: "Enterprise value", format: formatMarketCap },
    ],
  },
  {
    title: "Profitability",
    rows: [
      { key: "gross_margin", label: "Gross margin", format: fraction(1) },
      { key: "operating_margin", label: "Operating margin", format: fraction(1) },
      { key: "ebitda_margin", label: "EBITDA margin", format: fraction(1) },
      { key: "net_margin", label: "Net margin", format: fraction(1) },
    ],
  },
  {
    title: "Financial health",
    rows: [
      { key: "current_ratio", label: "Current ratio", format: formatNumber },
      { key: "quick_ratio", label: "Quick ratio", format: formatNumber },
      { key: "debt_to_equity", label: "Debt/Equity", format: formatNumber },
      { key: "interest_coverage", label: "Interest coverage", format: formatNumber },
    ],
  },
  {
    title: "Dividends",
    rows: [
      { key: "dividend_yield", label: "Dividend yield", format: fraction(2) },
      { key: "dividend_per_share", label: "Dividend/share", format: formatCurrency },
      { key: "payout_ratio", label: "Payout ratio", format: fraction(1) },
    ],
  },
];

// `growth` rows show year-over-year change of the row above.
const INCOME_ROWS = [
  { key: "revenue", label: "Revenue" },
  { key: "revenue", label: "YoY", growth: true },
  { key: "gross_profit", label: "Gross profit" },
  { key: "operating_income", label: "Operating income" },
  { key: "ebitda", label: "EBITDA" },
  { key: "net_income", label: "Net income" },
  { key: "net_income", label: "YoY", growth: true },
  { key: "eps_diluted", label: "EPS (diluted)", perShare: true },
];

/**
 * Percent change from `previous` to `current`, or null when it can't be
 * computed. Divides by |previous| so a smaller loss reads as an improvement.
 */
function yoyChange(current, previous) {
  if (current == null || previous == null || previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

function formatTimestamp(iso) {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function signColor(value) {
  if (value == null) return "";
  return value < 0 ? "text-red-600" : "";
}

function Section({ title, children, aside }) {
  return (
    <section className="border-t border-gray-200 px-5 py-4">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">{title}</h3>
        {aside && <span className="text-xs text-gray-400">{aside}</span>}
      </div>
      {children}
    </section>
  );
}

function PercentileBar({ value }) {
  if (value == null) return <span className="text-gray-400">{DASH}</span>;
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-28 shrink-0 rounded-full bg-gray-100" aria-hidden="true">
        <div className="h-full rounded-full bg-blue-500" style={{ width: `${value}%` }} />
      </div>
      <span className="w-8 text-right tabular-nums text-gray-700">{formatNumber(value, 0)}</span>
    </div>
  );
}

function ScoreSection({ row, ranking, industryName, peerCount }) {
  return (
    <Section title="Peer score" aside={`vs. ${peerCount} stocks in ${industryName}`}>
      <div className="mb-4 grid grid-cols-3 gap-2">
        {SCORE_PRESETS.map((p) => {
          const active = p.value === ranking;
          return (
            <div
              key={p.value}
              className={`rounded-md border px-3 py-2 ${
                active ? "border-blue-300 bg-blue-50" : "border-gray-200"
              }`}
            >
              <div className={`text-xs ${active ? "text-blue-800" : "text-gray-500"}`}>
                {p.label}
              </div>
              <div className="text-xl font-semibold tabular-nums text-gray-900">
                {formatNumber(row.scores?.[p.value], 0)}
              </div>
            </div>
          );
        })}
      </div>

      <table className="w-full text-sm">
        <thead className="text-xs text-gray-500">
          <tr>
            <th className="pb-1 text-left font-normal">Metric</th>
            <th className="pb-1 text-right font-normal">Value</th>
            <th className="pb-1 pl-4 text-left font-normal">Percentile</th>
          </tr>
        </thead>
        <tbody>
          {SCORE_METRICS.map((m) => (
            <tr key={m.key}>
              <td className="py-1">
                {m.label} <span className="text-xs text-gray-400">({m.hint})</span>
              </td>
              <td className="py-1 text-right tabular-nums">{m.format(row[m.key])}</td>
              <td className="py-1 pl-4">
                <PercentileBar value={row.percentiles?.[m.key]} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  );
}

function Fact({ label, children }) {
  return (
    <div>
      <dt className="text-xs text-gray-500">{label}</dt>
      <dd className="text-gray-900">{children ?? DASH}</dd>
    </div>
  );
}

function AboutSection({ profile }) {
  const [expanded, setExpanded] = useState(false);
  const headquarters = [profile.city, profile.state, profile.country].filter(Boolean).join(", ");

  return (
    <Section title="About">
      {profile.description && (
        <div className="mb-3">
          <p className={`leading-relaxed text-gray-700 ${expanded ? "" : "line-clamp-4"}`}>
            {profile.description}
          </p>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="mt-1 text-xs text-blue-600 hover:underline"
          >
            {expanded ? "Show less" : "Show more"}
          </button>
        </div>
      )}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
        <Fact label="CEO">{profile.ceo}</Fact>
        <Fact label="Employees">
          {profile.employees != null ? formatNumber(profile.employees, 0) : null}
        </Fact>
        <Fact label="Headquarters">{headquarters || null}</Fact>
        <Fact label="IPO date">{profile.ipo_date}</Fact>
        <Fact label="Beta">{profile.beta != null ? formatNumber(profile.beta) : null}</Fact>
        <Fact label="Avg volume">
          {profile.average_volume != null ? formatNumber(profile.average_volume, 0) : null}
        </Fact>
        {profile.website && (
          <div className="col-span-2">
            <dt className="text-xs text-gray-500">Website</dt>
            <dd>
              <a
                href={profile.website}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 hover:underline"
              >
                {profile.website.replace(/^https?:\/\/(www\.)?/, "")}
              </a>
            </dd>
          </div>
        )}
      </dl>
    </Section>
  );
}

function RatiosSection({ ratios }) {
  return (
    <Section title="Key ratios" aside="Trailing twelve months">
      <div className="grid grid-cols-2 gap-x-6 gap-y-4">
        {RATIO_GROUPS.map((group) => (
          <div key={group.title}>
            <h4 className="mb-1 text-xs font-medium text-gray-700">{group.title}</h4>
            <dl className="space-y-0.5">
              {group.rows.map((r) => (
                <div key={r.key} className="flex justify-between gap-2">
                  <dt className="text-gray-500">{r.label}</dt>
                  <dd className={`tabular-nums ${signColor(ratios[r.key])}`}>
                    {r.format(ratios[r.key])}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>
    </Section>
  );
}

function IncomeSection({ statements }) {
  if (!statements.length) {
    return (
      <Section title="Income statement">
        <p className="text-gray-500">No income statements available.</p>
      </Section>
    );
  }

  const currency = statements[0].currency;
  const prefix = !currency || currency === "USD" ? "$" : "";

  return (
    <Section
      title="Income statement"
      aside={`Annual${prefix ? "" : `, figures in ${currency}`}`}
    >
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-gray-500">
            <tr>
              <th className="pb-1 text-left font-normal" />
              {statements.map((s) => (
                <th key={s.fiscal_year} className="pb-1 pl-2 text-right font-medium">
                  FY{s.fiscal_year}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {INCOME_ROWS.map((r, i) => (
              <tr
                key={`${r.key}-${i}`}
                className={r.growth ? "text-gray-500" : "border-t border-gray-100"}
              >
                <td className={`py-1 pr-2 whitespace-nowrap ${r.growth ? "pl-3" : ""}`}>
                  {r.label}
                </td>
                {statements.map((s, j) => {
                  // Statements are newest first, so the prior year is j + 1.
                  if (r.growth) {
                    const change = yoyChange(s[r.key], statements[j + 1]?.[r.key]);
                    // Don't color a change that displays as "0.0%".
                    const shown = change != null && Math.abs(change) < 0.05 ? 0 : change;
                    return (
                      <td
                        key={s.fiscal_year}
                        className={`py-0.5 pl-2 text-right tabular-nums ${signColor(shown)}`}
                      >
                        {formatPercent(change, 1, { signed: true })}
                      </td>
                    );
                  }
                  const value = s[r.key];
                  return (
                    <td
                      key={s.fiscal_year}
                      className={`py-1 pl-2 text-right tabular-nums whitespace-nowrap ${signColor(value)}`}
                    >
                      {r.perShare
                        ? formatNumber(value)
                        : formatCompactCurrency(value, prefix)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

/**
 * Slide-over panel for one ticker: peer score breakdown (from the industry
 * table's row), plus company profile, TTM ratios, and annual income
 * statements fetched from /api/tickers/<symbol>.
 */
export default function TickerPanel({ row, ranking, industryName, peerCount, onClose }) {
  const symbol = row.symbol;
  const [state, setState] = useState({ status: "loading" });
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading" });
    getTickerDetail(symbol, { signal: controller.signal })
      .then((data) => setState({ status: "ready", data }))
      .catch((err) => {
        if (err.name === "AbortError") return; // another ticker was opened
        setState({ status: "error", message: err.message });
      });
    return () => controller.abort();
  }, [symbol]);

  useEffect(() => {
    const onKeyDown = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  async function handleRefresh() {
    setRefreshing(true);
    try {
      setState({ status: "ready", data: await getTickerDetail(symbol, { refresh: true }) });
    } catch (err) {
      setState((s) => ({ ...s, refreshError: err.message }));
    } finally {
      setRefreshing(false);
    }
  }

  const data = state.status === "ready" ? state.data : null;
  // Prefer the panel's own fetch, which may be newer than the table's row.
  const quote = data?.ticker ?? row;
  const profile = data?.profile;
  const change = quote.day_change;

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-gray-900/20" onClick={onClose} aria-hidden="true" />

      <aside
        role="dialog"
        aria-modal="true"
        aria-label={`${symbol} details`}
        className="relative flex h-full w-full max-w-xl flex-col bg-white text-sm shadow-xl"
      >
        <header className="px-5 pb-4 pt-5">
          <div className="flex items-start gap-3">
            {profile?.image && (
              <img
                src={profile.image}
                alt=""
                className="h-10 w-10 shrink-0 rounded-md border border-gray-100 object-contain"
                onError={(e) => (e.currentTarget.style.display = "none")}
              />
            )}
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-semibold leading-tight">
                {symbol}{" "}
                <span className="font-normal text-gray-600">{quote.company_name}</span>
              </h2>
              <p className="text-xs text-gray-500">
                {[profile?.exchange, profile?.sector, profile?.industry ?? industryName]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="-mr-1 -mt-1 rounded-md px-2 py-1 text-lg leading-none text-gray-400 hover:bg-gray-100 hover:text-gray-700"
            >
              {"×"}
            </button>
          </div>

          <div className="mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <span className="text-2xl font-semibold tabular-nums">
              {formatCurrency(quote.price)}
            </span>
            <span
              className={`tabular-nums ${
                change == null ? "" : change >= 0 ? "text-green-600" : "text-red-600"
              }`}
            >
              {formatPercent(change, 2, { signed: true })}
            </span>
            <span className="text-gray-500">
              Market cap{" "}
              <span className="text-gray-900">{formatMarketCap(quote.market_cap)}</span>
            </span>
          </div>

          <div className="mt-2 flex items-center gap-3">
            <span className="text-xs text-gray-500">52W</span>
            <RangeBar low={quote.year_low} high={quote.year_high} price={quote.price} />
          </div>

          <div className="mt-3 flex items-center gap-2 text-xs text-gray-500">
            {data?.last_fetched && <span>Data as of {formatTimestamp(data.last_fetched)}</span>}
            <RefreshButton
              onClick={handleRefresh}
              refreshing={refreshing || state.status === "loading"}
            />
            {state.refreshError && <span className="text-red-600">{state.refreshError}</span>}
          </div>
        </header>

        <div className="flex-1 overflow-y-auto">
          <ScoreSection
            row={row}
            ranking={ranking}
            industryName={industryName}
            peerCount={peerCount}
          />

          {state.status === "error" && (
            <Section title="Details">
              <p className="text-red-600">{state.message}</p>
            </Section>
          )}

          {state.status === "loading" && (
            <>
              <Section title="About">
                <SkeletonLines lines={4} />
              </Section>
              <Section title="Key ratios">
                <SkeletonLines lines={6} />
              </Section>
              <Section title="Income statement">
                <SkeletonLines lines={5} />
              </Section>
            </>
          )}

          {data && (
            <>
              <AboutSection key={symbol} profile={data.profile ?? {}} />
              <RatiosSection ratios={data.ratios ?? {}} />
              <IncomeSection statements={data.income_statements ?? []} />
            </>
          )}
        </div>
      </aside>
    </div>
  );
}
