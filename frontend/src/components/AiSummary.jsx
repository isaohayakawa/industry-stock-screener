import { useEffect, useRef, useState } from "react";

/**
 * AI-written blurb about what's on screen. Renders independently of the
 * screen's own data: it only starts fetching once `trigger` is non-null
 * (i.e. the screen has loaded), and refetches whenever `trigger` changes
 * (e.g. after a refresh). Hidden entirely when the backend has no API key.
 *
 * `load` receives { signal } and resolves to { enabled, summary }.
 */
export default function AiSummary({ load, trigger }) {
  const [state, setState] = useState({ status: "idle" });

  // `load` is usually an inline arrow, so keep the latest one in a ref
  // rather than refetching every render.
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    if (trigger == null) return undefined;

    const controller = new AbortController();
    setState({ status: "loading" });

    loadRef
      .current({ signal: controller.signal })
      .then(({ enabled, summary }) => {
        if (!enabled) setState({ status: "disabled" });
        else if (!summary) setState({ status: "empty" });
        else setState({ status: "ready", summary });
      })
      .catch((err) => {
        if (err.name === "AbortError") return; // superseded by a newer request
        setState({ status: "error", message: err.message });
      });

    return () => controller.abort();
  }, [trigger]);

  if (state.status === "idle" || state.status === "disabled" || state.status === "empty") {
    return null;
  }

  return (
    <section
      aria-live="polite"
      aria-busy={state.status === "loading"}
      className="mb-4 rounded-md border border-blue-100 bg-blue-50/60 px-4 py-3 text-sm"
    >
      <div className="mb-1 flex items-center gap-1 text-xs font-medium text-blue-800">
        <span aria-hidden="true">{"✨"}</span> AI summary
      </div>

      {state.status === "loading" && (
        <div className="space-y-2 py-1" aria-label="Generating summary">
          <div className="h-3 w-full animate-pulse rounded bg-blue-100" />
          <div className="h-3 w-5/6 animate-pulse rounded bg-blue-100" />
        </div>
      )}

      {state.status === "ready" && <p className="leading-relaxed text-gray-700">{state.summary}</p>}

      {state.status === "error" && <p className="text-gray-500">{state.message}</p>}
    </section>
  );
}
