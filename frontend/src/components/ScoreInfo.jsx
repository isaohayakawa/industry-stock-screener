import { useEffect, useRef, useState } from "react";

const WIDTH = 320; // px; matches w-80 below
const MARGIN = 8; // keep clear of the viewport edge

/**
 * Info icon for the Score column header. Clicking it opens a popover that
 * explains how the peer-relative score is calculated (see peer_scores in
 * backend/app.py). The popover is position: fixed so the table's overflow
 * containers can't clip it, and it re-anchors to the icon on scroll/resize.
 */
function anchoredPosition(button) {
  const rect = button.getBoundingClientRect();
  const maxLeft = window.innerWidth - WIDTH - MARGIN;
  return {
    top: rect.bottom + 6,
    left: Math.max(MARGIN, Math.min(rect.left - 16, maxLeft)),
  };
}

export default function ScoreInfo({ presetLabel }) {
  const [position, setPosition] = useState(null); // null = closed
  const buttonRef = useRef(null);
  const popoverRef = useRef(null);

  function toggle(e) {
    e.stopPropagation(); // the header click would otherwise re-sort the table
    if (position) {
      setPosition(null);
      return;
    }
    setPosition(anchoredPosition(buttonRef.current));
  }

  const isOpen = position != null;

  // Close on outside click or Escape; follow the icon when anything scrolls.
  useEffect(() => {
    if (!isOpen) return;
    const close = () => setPosition(null);
    const follow = () => buttonRef.current && setPosition(anchoredPosition(buttonRef.current));
    const onPointerDown = (e) => {
      if (!popoverRef.current?.contains(e.target) && !buttonRef.current?.contains(e.target)) {
        close();
      }
    };
    const onKeyDown = (e) => e.key === "Escape" && close();

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", follow, true);
    window.addEventListener("resize", follow);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", follow, true);
      window.removeEventListener("resize", follow);
    };
  }, [isOpen]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={toggle}
        aria-label="How the score is calculated"
        aria-expanded={isOpen}
        className="ml-1 inline-flex h-4 w-4 items-center justify-center rounded-full border border-gray-400 align-middle text-[10px] font-semibold italic leading-none text-gray-500 hover:border-blue-600 hover:text-blue-600"
      >
        i
      </button>

      {isOpen && (
        <div
          ref={popoverRef}
          role="dialog"
          aria-label="How the score is calculated"
          onClick={(e) => e.stopPropagation()}
          style={{ top: position.top, left: position.left }}
          className="fixed z-50 w-80 cursor-auto whitespace-normal rounded-md border border-gray-200 bg-white p-3 text-left text-xs font-normal leading-relaxed text-gray-700 shadow-lg"
        >
          <p className="mb-2 font-semibold text-gray-900">How the score works</p>
          <p className="mb-2">
            The score (0–100) compares each stock only to the other stocks in this industry. For
            each metric, a stock gets a percentile among its peers: <strong>100</strong> is best in
            the industry, <strong>0</strong> is worst, and <strong>50</strong> is the middle.
          </p>
          <ul className="mb-2 list-disc space-y-1 pl-4">
            <li>
              <strong>P/E and P/S:</strong> lower is better. A negative P/E (the company is losing
              money) ranks last.
            </li>
            <li>
              <strong>Rev Growth:</strong> higher is better.
            </li>
          </ul>
          <p className="mb-1 font-medium text-gray-900">Each ranking combines them differently:</p>
          <ul className="mb-2 list-disc space-y-1 pl-4">
            <li>
              <strong>Balanced:</strong> 50% valuation (average of P/E and P/S) and 50% growth.
            </li>
            <li>
              <strong>Valuation-weighted:</strong> average of the P/E and P/S percentiles.
            </li>
            <li>
              <strong>Growth-weighted:</strong> the revenue growth percentile.
            </li>
          </ul>
          <p className="text-gray-500">
            Missing metrics are skipped, and a dash means the stock had none of the metrics.
            {presetLabel && (
              <>
                {" "}
                You're seeing the <span className="font-medium">{presetLabel}</span> score.
              </>
            )}
          </p>
        </div>
      )}
    </>
  );
}
