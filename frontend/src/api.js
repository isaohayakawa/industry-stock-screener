const BASE_URL = "http://localhost:5050/api";

export async function getIndustries(search = "") {
  const url = search
    ? `${BASE_URL}/industries?search=${encodeURIComponent(search)}`
    : `${BASE_URL}/industries`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Failed to load industries");
  return res.json();
}

export async function getIndustryDetail(industryName, ranking = "balanced") {
  const url = `${BASE_URL}/industries/${encodeURIComponent(industryName)}?ranking=${ranking}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Failed to load industry detail");
  return res.json();
}
