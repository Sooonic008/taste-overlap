import { test } from "node:test";
import assert from "node:assert/strict";
import { normalise, sharedPicks, reason, evening } from "../src/overlap.js";

const e = (id, name, affinity, tags = []) => ({ entity_id: id, name, query: { affinity }, tags: tags.map((n) => ({ name: n })) });

test("normalise reads Qloo insights entities", () => {
  const r = normalise({ results: { entities: [e("p1", "Café Sperl", 0.9, ["Coffee", "Historic"])] } });
  assert.deepEqual(r[0], { id: "p1", name: "Café Sperl", affinity: 0.9, tags: ["Coffee", "Historic"], address: "", url: "",
                         description: "", drivers: [] });
});

test("a pick only one person would enjoy is not an overlap", () => {
  const A = normalise({ results: { entities: [e("x", "Jazz Club", 0.95), e("y", "Bistro", 0.6)] } });
  const B = normalise({ results: { entities: [e("x", "Jazz Club", 0.05), e("y", "Bistro", 0.7)] } });
  const picks = sharedPicks(A, B, []);
  assert.deepEqual(picks.map((p) => p.id), ["y"]);
});

test("balanced picks beat one-sided high scores", () => {
  const A = normalise({ results: { entities: [e("a", "One-sided", 0.99), e("b", "Balanced", 0.7)] } });
  const B = normalise({ results: { entities: [e("a", "One-sided", 0.25), e("b", "Balanced", 0.7)] } });
  assert.equal(sharedPicks(A, B, [])[0].id, "b");
});

test("reason names shared tags and both fit scores", () => {
  const p = { tags: ["Jazz", "Cocktails"], scoreA: 0.8, scoreB: 0.6 };
  const r = reason(p, ["jazz", "film noir"], ["cocktails"]);
  assert.match(r, /A's taste for jazz/);
  assert.match(r, /B's taste for cocktails/);
  assert.match(r, /A 80% · B 60%/);
});

test("evening orders activity, food, drink", () => {
  const picks = [
    { id: 1, tags: ["Cocktail bar"], score: 0.9 },
    { id: 2, tags: ["Italian restaurant"], score: 0.8 },
    { id: 3, tags: ["Cinema"], score: 0.7 },
  ];
  assert.deepEqual(evening(picks).map((p) => p.id), [3, 2, 1]);
});

test("normalise keeps Qloo's per-pick drivers and the short description", () => {
  const [p] = normalise({ results: { entities: [{ entity_id: "P1", name: "Sigmund Freud Museum", affinity: 0.85,
    explainability: { "signal.interests.entities": [{ entity_id: "RH", score: 0.55 }, { entity_id: "WA", score: 0.45 }] },
    properties: { short_description: "House museum", address: "Berggasse 19" } }] } });
  assert.deepEqual(p.drivers, [{ id: "RH", score: 0.55 }, { id: "WA", score: 0.45 }]);
  assert.equal(p.description, "House museum");
});

test("reason names the favourites that drove the pick, strongest first", () => {
  const p = { tags: [], scoreA: 0.85, scoreB: 0.74, drivers: [{ id: "TS", score: 0.2 }, { id: "RH", score: 0.5 }, { id: "ZZ", score: 0.3 }] };
  const r = reason(p, [], [], new Map([["RH", "Radiohead"], ["TS", "Taylor Swift"]]));
  assert.match(r, /driven by Radiohead 50% · Taylor Swift 20%/);
  assert.match(r, /taste fit A 85% · B 74%/);
});

test("evening uses the description when Qloo returns no tags", () => {
  const picks = [{ name: "Bar", tags: [], description: "Cocktail bar", score: 0.9 }, { name: "Museum", tags: [], description: "Art museum", score: 0.5 }];
  assert.deepEqual(evening(picks).map((p) => p.name), ["Museum", "Bar"]);
});

test("too few real overlaps are topped up from Qloo's joint list, clearly labelled, without duplicates", async () => {
  const { fillFromJoint } = await import("../src/overlap.js");
  const shared = [{ id: "s1", name: "Shared", tags: [], scoreA: 0.8, scoreB: 0.7, score: 0.7 }];
  const joint = [{ id: "s1", name: "Shared", affinity: 0.9, tags: [] }, { id: "j1", name: "Joint One", affinity: 0.88, tags: [] },
                 { id: "j2", name: "Joint Two", affinity: 0.87, tags: [] }];
  const r = fillFromJoint(shared, joint, 3);
  assert.deepEqual(r.map((p) => p.id), ["s1", "j1", "j2"]);
  assert.equal(r[0].basis, "overlap");
  assert.equal(r[1].basis, "combined");
  assert.equal(fillFromJoint(shared, joint, 1).length, 1);
});

test("a combined pick explains itself without inventing per-person fit scores", () => {
  const r = reason({ tags: [], basis: "combined", affinity: 0.88, drivers: [] }, [], []);
  assert.match(r, /combined taste/);
  assert.doesNotMatch(r, /taste fit A/);
});

test("a place measured as one-sided never returns through the joint list", async () => {
  const { fillFromJoint } = await import("../src/overlap.js");
  const joint = [{ id: "steak", name: "Steakhouse", affinity: 0.9, tags: [] }, { id: "j1", name: "Unscored", affinity: 0.8, tags: [] }];
  assert.deepEqual(fillFromJoint([], joint, 6, new Set(["steak"])).map((p) => p.id), ["j1"]);
});
