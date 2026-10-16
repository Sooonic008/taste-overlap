// Taste Overlap - core logic (pure, no network).
// Two people, a few favourites each. Qloo ranks places for A's taste, for B's taste, and for both together.
// A pick is a real overlap only if it ranks well for BOTH people - not just high on the merged list.

/** Normalise a Qloo insights result list into {id, name, affinity, tags, address}. */
export function normalise(results) {
  const entities = results?.results?.entities ?? results?.entities ?? [];
  return entities.map((e, i) => ({
    id: e.entity_id ?? e.id,
    name: e.name,
    affinity: Number(e.query?.affinity ?? e.affinity ?? 1 - i / Math.max(entities.length, 1)),
    tags: (e.tags ?? []).map((t) => t.name ?? t).filter(Boolean),
    address: e.properties?.address ?? "",
    url: e.properties?.website ?? "",
    description: e.properties?.short_description ?? e.properties?.description ?? "",
    // Qloo's per-pick explainability: how much each input favourite contributed to this place.
    drivers: (e.explainability?.["signal.interests.entities"] ?? []).map((d) => ({ id: d.entity_id, score: Number(d.score) })),
  }));
}

/**
 * Combine three rankings into shared picks.
 * score = harmonic mean of A's and B's affinity (punishes one-sided picks), boosted slightly by the joint list.
 */
export function sharedPicks(listA, listB, listBoth, { take = 6, minEach = 0.2 } = {}) {
  const byId = (l) => new Map(l.map((x) => [x.id, x]));
  const a = byId(listA), b = byId(listB), both = byId(listBoth);
  const ids = new Set([...a.keys(), ...b.keys(), ...both.keys()]);
  const picks = [];
  for (const id of ids) {
    const fa = a.get(id)?.affinity ?? 0;
    const fb = b.get(id)?.affinity ?? 0;
    if (fa < minEach || fb < minEach) continue; // one person would not enjoy it
    const harmonic = (2 * fa * fb) / (fa + fb);
    const joint = both.get(id)?.affinity ?? 0;
    const base = both.get(id) ?? a.get(id) ?? b.get(id);
    picks.push({ ...base, scoreA: fa, scoreB: fb, score: harmonic * 0.85 + joint * 0.15 });
  }
  picks.sort((x, y) => y.score - x.score);
  return picks.slice(0, take);
}

/** Why a pick fits both: shared tags between the pick and each person's favourites. */
export function reason(pick, tagsA, tagsB, names = new Map()) {
  const t = new Set(pick.tags.map((x) => x.toLowerCase()));
  const forA = tagsA.filter((x) => t.has(x.toLowerCase())).slice(0, 2);
  const forB = tagsB.filter((x) => t.has(x.toLowerCase())).slice(0, 2);
  const parts = [];
  const drivers = (pick.drivers ?? []).filter((d) => names.has(d.id)).sort((x, y) => y.score - x.score).slice(0, 3);
  if (drivers.length) parts.push(`driven by ${drivers.map((d) => `${names.get(d.id)} ${Math.round(d.score * 100)}%`).join(" · ")}`);
  if (forA.length) parts.push(`matches A's taste for ${forA.join(" and ")}`);
  if (forB.length) parts.push(`B's taste for ${forB.join(" and ")}`);
  const pct = (v) => `${Math.round(v * 100)}%`;
  if (pick.basis === "combined") parts.push(`Qloo's pick for your combined taste (affinity ${pct(pick.affinity)})`);
  else parts.push(`taste fit A ${pct(pick.scoreA)} · B ${pct(pick.scoreB)}`);
  return parts.join("; ");
}

/**
 * Qloo returns at most 20 places per call; two different tastes may share none of them (measured: Berlin,
 * Daft Punk + Nolan vs Adele + Pixar). Real overlaps come first; the rest is topped up from the joint list,
 * labelled `combined` so the UI never presents it as a measured overlap. Places scored in BOTH personal lists were
 * already judged (e.g. one-sided) and never come back through the joint list.
 */
export function fillFromJoint(shared, listBoth, take = 6, judged = new Set()) {
  const out = shared.slice(0, take).map((p) => ({ ...p, basis: "overlap" }));
  const have = new Set(out.map((p) => p.id));
  for (const p of listBoth) {
    if (out.length >= take) break;
    if (have.has(p.id) || judged.has(p.id)) continue;
    have.add(p.id);
    out.push({ ...p, basis: "combined", score: p.affinity });
  }
  return out;
}

/** Order picks into an evening: something to do first, then food, then a drink - by the place's tags. */
export function evening(picks) {
  const slot = (p) => {
    const t = `${p.tags.join(" ")} ${p.description ?? ""}`.toLowerCase();
    if (/(bar|cocktail|wine|pub|club|jazz)/.test(t)) return 3;
    if (/(restaurant|food|cuisine|bistro|cafe|café|bakery)/.test(t)) return 2;
    return 1;
  };
  return [...picks].sort((x, y) => slot(x) - slot(y) || y.score - x.score);
}
