// Thin Qloo client. The key stays on the server (env QLOO_API_KEY); the browser never sees it.
// Base URL and auth header follow the hackathon developer guide; both configurable via env.

export function client({ key = process.env.QLOO_API_KEY, base = process.env.QLOO_BASE || "https://hackathon.api.qloo.com",
                         fetchFn = globalThis.fetch } = {}) {
  if (!key) throw new Error("QLOO_API_KEY is not set");
  const get = async (path, params) => {
    const url = new URL(path, base);
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
    const r = await fetchFn(url, { headers: { "X-Api-Key": key, accept: "application/json" } });
    if (!r.ok) throw new Error(`Qloo ${path} -> HTTP ${r.status}`);
    return r.json();
  };

  /** Resolve a free-text favourite ("Wes Anderson", "Radiohead") to a Qloo entity. */
  async function resolve(name) {
    const d = await get("/search", { query: name, take: 1 });
    const hit = (d.results ?? d.entities ?? [])[0];
    return hit ? { id: hit.entity_id ?? hit.id, name: hit.name, tags: (hit.tags ?? []).map((t) => t.name ?? t) } : null;
  }

  /** Places in a city ranked for a set of interest entities. */
  async function places(entityIds, city, take = 20) {
    return get("/v2/insights", {
      "filter.type": "urn:entity:place",
      "signal.interests.entities": entityIds.join(","),
      "filter.location.query": city,
      take,
    });
  }

  return { resolve, places };
}
