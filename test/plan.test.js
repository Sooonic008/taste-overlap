import { test } from "node:test";
import assert from "node:assert/strict";
import { plan } from "../src/plan.js";
import { client } from "../src/qloo.js";

const place = (id, name, aff, tags) => ({ entity_id: id, name, query: { affinity: aff }, tags: tags.map((n) => ({ name: n })),
                                        properties: { address: `${name} street 1` } });

function fakeQloo() {
  const calls = [];
  return {
    calls,
    resolve: async (n) => ({ id: `id-${n}`, name: n, tags: n === "Miles Davis" ? ["Jazz"] : ["Cocktails"] }),
    places: async (ids) => {
      calls.push(ids);
      const forA = ids.includes("id-Miles Davis"), forB = ids.includes("id-Mad Men");
      return { results: { entities: [
        place("p1", "Blue Note Bar", forA ? 0.9 : 0.5, ["Jazz", "Cocktail bar"]),
        place("p2", "Steakhouse", forB ? 0.9 : 0.1, ["Restaurant"]),
        place("p3", "Old Cinema", 0.6, ["Cinema"]),
      ] } };
    },
  };
}

test("plan keeps overlaps, explains them and orders the evening", async () => {
  const q = fakeQloo();
  const r = await plan({ city: "Vienna", a: ["Miles Davis"], b: ["Mad Men"] }, q);
  assert.deepEqual(r.picks.map((p) => p.name), ["Old Cinema", "Blue Note Bar"]);   // steakhouse is one-sided
  assert.match(r.picks[1].why, /A's taste for Jazz/);
  assert.equal(q.calls.length, 3);
});

test("plan refuses empty input", async () => {
  await assert.rejects(plan({ city: "Vienna", a: [], b: ["x"] }, fakeQloo()), /required/);
});

test("client sends the key as header and never in the URL", async () => {
  let seen;
  const c = client({ key: "k123", base: "https://q.example", fetchFn: async (url, opt) => {
    seen = { url: String(url), opt }; return { ok: true, json: async () => ({ results: [] }) };
  } });
  await c.resolve("Radiohead");
  assert.equal(seen.opt.headers["X-Api-Key"], "k123");
  assert.ok(!seen.url.includes("k123") && seen.url.includes("query=Radiohead"));
});
