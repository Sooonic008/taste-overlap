import { test } from "node:test";
import assert from "node:assert/strict";
import { harnessClient, entitiesOf } from "../src/harness.js";

test("places calls the official recommend workflow with names, place type and city", async () => {
  const calls = [];
  const q = harnessClient({ run: async (op, input) => { calls.push([op, input]); return {
    schema_version: "1.0-preview.1", operation: "recommend",
    results: [{ name: "Café Kafka", entity_id: "E1", tags: [{ name: "cafe" }], properties: { address: "Wien" } }] }; } });
  const r = await q.places(["Wes Anderson", "Radiohead"], "Vienna");
  assert.equal(calls[0][0], "recommend");
  assert.deepEqual(calls[0][1], { target_type: "place", signals: ["Wes Anderson", "Radiohead"], filter_location: "Vienna",
                                  explain: true, limit: 20 });
  assert.equal(r.results.entities[0].name, "Café Kafka");
});

test("resolve keeps the name and collects tags from entity_tags", async () => {
  const q = harnessClient({ run: async (op, input) => {
    assert.equal(op, "entity_tags"); assert.deepEqual(input.entities, ["Radiohead"]);
    return { schema_version: "1.0-preview.1", operation: "entity_tags", tags: [{ name: "alternative rock" }, { name: "indie" }] };
  } });
  const e = await q.resolve("Radiohead");
  assert.equal(e.id, "Radiohead");
  assert.deepEqual(e.tags, ["alternative rock", "indie"]);
});

test("resolve still works when tags cannot be read", async () => {
  const q = harnessClient({ run: async () => { throw new Error("QLOO_RATE_LIMIT"); } });
  assert.deepEqual(await q.resolve("Radiohead"), { id: "Radiohead", name: "Radiohead", tags: [] });
});

test("an error envelope from qloo exec becomes a thrown error, never an empty result", async () => {
  const q = harnessClient({ run: async () => ({ error: { code: "QLOO_AUTH" }, operation: "recommend" }) });
  await assert.rejects(q.places(["x"], "Vienna"), /QLOO_AUTH/);
});

test("entitiesOf finds the entity list wherever the envelope nests it", () => {
  assert.equal(entitiesOf({ results: { entities: [{ name: "A" }] } })[0].name, "A");
  assert.equal(entitiesOf({ data: { recommendations: [{ name: "B" }] } })[0].name, "B");
  assert.deepEqual(entitiesOf({ results: [] }), []);
});

const NEEDS = (input, id) => ({ schema_version: "1.0-preview.1", status: "needs_input", results: [],
  resolution: { issues: [{ input, kind: "ambiguous", field: "signals",
    candidates: [{ id, name: input, type: "urn:entity:artist", popularity: 0.99 }, { id: "OTHER", name: input, type: "urn:entity:album" }] }] } });

test("needs_input is answered with the first candidate's id and retried once, choice kept visible", async () => {
  const calls = [];
  const q = harnessClient({ run: async (op, input) => {
    calls.push(input);
    if (calls.length === 1) return NEEDS("Radiohead", "ID-RH");
    return { status: "ok", results: [{ name: "Sigmund Freud Museum", entity_id: "P1" }] };
  } });
  const r = await q.places(["Radiohead", "ID-WES"], "Vienna");
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1].signals, ["ID-RH", "ID-WES"]);
  assert.equal(r.results.entities[0].name, "Sigmund Freud Museum");
  assert.deepEqual(r.choices, [{ input: "Radiohead", id: "ID-RH", type: "urn:entity:artist" }]);
});

test("still unresolved after the retry is an error, not an empty list", async () => {
  const q = harnessClient({ run: async () => NEEDS("Radiohead", "ID-RH") });
  await assert.rejects(q.places(["Radiohead"], "Vienna"), /unresolved/);
});

test("resolve returns the Qloo entity id when the workflow reports one", async () => {
  const q = harnessClient({ run: async () => ({ status: "ok", tags: [{ name: "indie" }],
    interpretation: { entities: [{ input: "Radiohead", entityId: "ID-RH", name: "Radiohead" }] } }) });
  const e = await q.resolve("Radiohead");
  assert.equal(e.id, "ID-RH");
  assert.deepEqual(e.tags, ["indie"]);
});

test("an album is not chosen as a taste signal when Qloo offers a non-album candidate", async () => {
  const calls = [];
  const q = harnessClient({ run: async (op, input) => {
    calls.push(input);
    if (calls.length === 1) return { status: "needs_input", resolution: { issues: [{ input: "Harry Potter", candidates: [
      { id: "ALBUM", name: "Harry Potter", type: "urn:entity:album" }, { id: "SHOW", name: "Harry Potter", type: "urn:entity:tv_show" }] }] } };
    return { status: "ok", results: [] };
  } });
  await q.places(["Harry Potter"], "Paris");
  assert.deepEqual(calls[1].signals, ["SHOW"]);
});
