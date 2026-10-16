import { test } from "node:test";
import assert from "node:assert/strict";
import { visitorOf } from "../src/visitor.js";

test("a forged X-Forwarded-For never decides who the visitor is", () => {
  const h = { "x-forwarded-for": "203.0.113.77, 10.0.0.1, 10.0.0.2", "cf-connecting-ip": "198.51.100.5" };
  assert.equal(visitorOf(h, "10.1.1.1"), "198.51.100.5");
  assert.equal(visitorOf({ "x-forwarded-for": "203.0.113.77" }, "10.1.1.1"), "10.1.1.1");
});

test("true-client-ip as second source, socket address as last", () => {
  assert.equal(visitorOf({ "true-client-ip": "198.51.100.9" }, "10.1.1.1"), "198.51.100.9");
  assert.equal(visitorOf({}, "127.0.0.1"), "127.0.0.1");
  assert.equal(visitorOf({}, ""), "unknown");
});
