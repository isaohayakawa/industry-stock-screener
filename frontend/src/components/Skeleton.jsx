// Pulsing placeholder bars shown while data loads, so each screen keeps its
// layout instead of collapsing to a "Loading..." line.

const BAR = "h-3 animate-pulse rounded bg-gray-100";

/** A few stacked lines, for blocks of text or key/value lists. */
export function SkeletonLines({ lines = 3 }) {
  return (
    <div className="space-y-2" aria-hidden="true">
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className={`${BAR} ${i % 2 ? "w-4/6" : "w-full"}`} />
      ))}
    </div>
  );
}

// Varied widths so the placeholder rows don't look like a grid of identical bricks.
const WIDTHS = ["w-3/4", "w-1/2", "w-2/3", "w-5/6"];

/**
 * Placeholder <tr>s for a table body. `columns` is a list of
 * { align: "right" | undefined }, matching the real columns so bars sit
 * where the values will.
 */
export function SkeletonRows({ columns, rows = 8, cellClassName = "px-2 py-2" }) {
  return Array.from({ length: rows }, (_, r) => (
    <tr key={r} aria-hidden="true">
      {columns.map((column, c) => (
        <td key={c} className={cellClassName}>
          <div
            className={`${BAR} ${WIDTHS[(r + c) % WIDTHS.length]} ${
              column.align === "right" ? "ml-auto" : ""
            }`}
          />
        </td>
      ))}
    </tr>
  ));
}
