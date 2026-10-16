import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const SERVER = fileURLToPath(new URL("../server.js", import.meta.url));
const PORT = 8800 + Math.floor(Math.random() * 100);
const URL_MCP = `http://127.0.0.1:${PORT}/mcp`;
let child;

before(async () => {
  child = spawn(process.execPath, [SERVER], { env: { ...process.env, QLOO_TRANSPORT: "demo", QLOO_API_KEY: "", PORT: String(PORT) } });
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`http://127.0.0.1:${PORT}/`)).ok) return; } catch { /* starting */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("server did not start");
});
after(() => child?.kill());

const post = (body, headers = {}) => fetch(URL_MCP, { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body),
  headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers } });

test("remote MCP: initialize, tools/list and a real tool call over POST /mcp", async () => {
  const init = await (await post({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } })).json();
  assert.equal(init.result.serverInfo.name, "taste-overlap");
  const list = await (await post({ jsonrpc: "2.0", id: 2, method: "tools/list" })).json();
  assert.equal(list.result.tools[0].name, "plan_shared_evening");
  const r = await post({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "plan_shared_evening",
    arguments: { city: "Vienna", person_a: ["Radiohead", "Wes Anderson"], person_b: ["Taylor Swift", "Studio Ghibli"] } } });
  assert.equal(r.headers.get("content-type"), "application/json");
  const j = await r.json();
  assert.equal(j.result.structuredContent.picks.length, 6);
});

test("notification -> 202 without body; GET -> 405; broken JSON -> 400 with a JSON-RPC error", async () => {
  const n = await post({ jsonrpc: "2.0", method: "notifications/initialized" });
  assert.equal(n.status, 202);
  assert.equal(await n.text(), "");
  assert.equal((await fetch(URL_MCP)).status, 405);
  const bad = await post("{kaputt");
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).error.code, -32700);
  const nul = await post("null");
  assert.equal((await nul.json()).error.code, -32600);
});

test("the web app still works next to /mcp", async () => {
  const r = await fetch(`http://127.0.0.1:${PORT}/api/plan`, { method: "POST",
    body: JSON.stringify({ city: "Vienna", a: ["Radiohead", "Wes Anderson"], b: ["Taylor Swift", "Studio Ghibli"] }) });
  assert.equal((await r.json()).picks.length, 6);
});
