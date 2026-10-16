import { normalise, sharedPicks, reason, evening, fillFromJoint } from "./overlap.js";

/**
 * Full plan for two people: resolve favourites, rank places for A, B and both, keep the real overlaps,
 * explain each pick and order them into an evening.
 */
export async function plan({ city, a, b }, qloo) {
  const clean = (l) => (l ?? []).map((s) => String(s).trim()).filter(Boolean).slice(0, 5);
  const favA = clean(a), favB = clean(b);
  if (!city || !favA.length || !favB.length) throw new Error("city and at least one favourite per person are required");

  const resolveAll = async (names) => (await Promise.all(names.map((n) => qloo.resolve(n).catch(() => null)))).filter(Boolean);
  const [entA, entB] = await Promise.all([resolveAll(favA), resolveAll(favB)]);
  if (!entA.length || !entB.length) throw new Error("Qloo could not match the favourites - try other names");

  const ids = (l) => l.map((x) => x.id);
  const [rA, rB, rBoth] = await Promise.all([
    qloo.places(ids(entA), city), qloo.places(ids(entB), city), qloo.places([...ids(entA), ...ids(entB)], city),
  ]);
  const tagsA = entA.flatMap((x) => x.tags), tagsB = entB.flatMap((x) => x.tags);
  const names = new Map([...entA, ...entB].map((x) => [x.id, x.name]));
  for (const c of [rA, rB, rBoth].flatMap((r) => r.choices ?? [])) if (!names.has(c.id)) names.set(c.id, c.input);
  const listA = normalise(rA), listB = normalise(rB), joint = normalise(rBoth);
  const judged = new Set(listA.map((x) => x.id).filter((id) => listB.some((y) => y.id === id)));
  const picks = evening(fillFromJoint(sharedPicks(listA, listB, joint), joint, 6, judged))
    .map((p) => ({ name: p.name, address: p.address, url: p.url, description: p.description, tags: p.tags.slice(0, 4),
                   why: reason(p, tagsA, tagsB, names),
                   basis: p.basis, scoreA: p.scoreA, scoreB: p.scoreB }));
  return { city, matchedA: entA.map((x) => x.name), matchedB: entB.map((x) => x.name), picks };
}
