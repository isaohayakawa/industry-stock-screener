/**
 * Small inline button that forces a refetch, shown next to "Data as of".
 */
export default function RefreshButton({ onClick, refreshing }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={refreshing}
      title="Refetch the latest data from the market data provider"
      className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-2 py-0.5 text-xs text-gray-600 hover:bg-gray-100 disabled:cursor-wait disabled:opacity-60"
    >
      <span className={refreshing ? "inline-block animate-spin" : ""} aria-hidden="true">
        {"↻"}
      </span>
      {refreshing ? "Refreshing..." : "Refresh"}
    </button>
  );
}
