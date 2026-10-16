import { test } from "node:test";
import assert from "node:assert/strict";
import { limiter } from "../src/limit.js";

test("each visitor gets a few plans per window, then a wait, without blocking others", () => {
  let now = 0;
  const allow = limiter({ perWindow: 3, windowMs: 60_000, clock: () => now });
  assert.deepEqual([allow("a"), allow("a"), allow("a")], [true, true, true]);
  assert.equal(allow("a"), false);
  assert.equal(allow("b"), true);
  now = 60_001;
  assert.equal(allow("a"), true);
});

test("a global ceiling protects the event quota even across many visitors", () => {
  const allow = limiter({ perWindow: 100, windowMs: 60_000, globalPerDay: 2, clock: () => 0 });
  assert.deepEqual([allow("a"), allow("b"), allow("c")], [true, true, false]);
});
