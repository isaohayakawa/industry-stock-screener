const BASE_URL = "http://localhost:5050/api";

// `refresh: true` asks the backend to skip its cache and refetch from FMP.
export async function getIndustries(search = "", { refresh = false } = {}) {
  const params = new URLSearchParams();
  if (search) params.set("search", search);
  if (refresh) params.set("refresh", "1");
  const query = params.toString();
  const res = await fetch(`${BASE_URL}/industries${query ? `?${query}` : ""}`);
  if (!res.ok) throw new Error("Failed to load industries");
  return res.json();
}

export async function getIndustryDetail(industryName, ranking = "balanced", { refresh = false } = {}) {
  const params = new URLSearchParams({ ranking });
  if (refresh) params.set("refresh", "1");
  const url = `${BASE_URL}/industries/${encodeURIComponent(industryName)}?${params}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Failed to load industry detail");
  return res.json();
}

// AI summaries come from separate routes so screens never wait on them.
// Resolves to { enabled, summary } - enabled is false when no
// ANTHROPIC_API_KEY is configured on the backend.
async function getSummary(path, signal) {
  const res = await fetch(`${BASE_URL}/summary/${path}`, { signal });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || "AI summary unavailable");
  return body;
}

export function getIndustriesSummary({ signal } = {}) {
  return getSummary("industries", signal);
}

export function getIndustryDetailSummary(industryName, { signal } = {}) {
  return getSummary(`industries/${encodeURIComponent(industryName)}`, signal);
}
