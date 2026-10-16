import { test } from "node:test";
import assert from "node:assert/strict";
import { recorder, replay } from "../src/demo.js";

test("a recorded run replays the exact Qloo envelopes for the same workflow input", async () => {
  const rec = recorder(async (op, input) => ({ status: "ok", op, n: input.limit }));
  await rec.run("recommend", { signals: ["A"], limit: 3 });
  const run = replay(rec.recording());
  assert.deepEqual(await run("recommend", { limit: 3, signals: ["A"] }), { status: "ok", op: "recommend", n: 3 });
});

test("an input that was never recorded is a clear error, not an invented answer", async () => {
  const run = replay([]);
  await assert.rejects(run("recommend", { signals: ["B"] }), /demo mode/);
});

test("the full plan replays from the recording: 6 shared picks, reasons from Qloo explainability", async () => {
  const { readFile } = await import("node:fs/promises");
  const { plan } = await import("../src/plan.js");
  const { harnessClient } = await import("../src/harness.js");
  const rec = JSON.parse(await readFile(new URL("../demo/vienna.json", import.meta.url), "utf8"));
  const r = await plan({ city: "Vienna", a: ["Radiohead", "Wes Anderson"], b: ["Taylor Swift", "Studio Ghibli"] },
                       harnessClient({ run: replay(rec.calls) }));
  assert.equal(r.picks.length, 6);
  for (const p of r.picks) {
    assert.ok(p.scoreA >= 0.2 && p.scoreB >= 0.2);
    assert.match(p.why, /^driven by .+ \d+%/);
  }
  assert.equal(r.picks.at(-1).name, "Wein Austria");   // the drink comes last
});
