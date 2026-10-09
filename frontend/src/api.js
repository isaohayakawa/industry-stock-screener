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
