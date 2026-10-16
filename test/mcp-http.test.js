import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const SERVER = fileURLToPath(new URL("../server.js", import.meta.url));

/** Start the real server on a free port (PORT=0); the port is read from its own start line, so no foreign process is hit. */
function startServer(extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SERVER], { env: { ...process.env, QLOO_TRANSPORT: "demo", QLOO_API_KEY: "", PORT: "0", ...extraEnv } });
    const timer = setTimeout(() => reject(new Error("server did not start")), 15000);
    child.on("exit", (code) => reject(new Error(`server exited with ${code}`)));
    child.stdout.on("data", (d) => {
      const m = String(d).match(/localhost:(\d+)/);
      if (m) { clearTimeout(timer); resolve({ child, base: `http://127.0.0.1:${m[1]}` }); }
    });
  });
}

let srv;
before(async () => { srv = await startServer(); });
after(() => srv?.child.kill());

const post = (base, body, headers = {}) => fetch(`${base}/mcp`, { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body),
  headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers } });
const CALL = { name: "plan_shared_evening", arguments: { city: "Vienna", person_a: ["Radiohead", "Wes Anderson"], person_b: ["Taylor Swift", "Studio Ghibli"] } };

test("remote MCP: initialize (version negotiated), tools/list and a real tool call over POST /mcp", async () => {
  const init = await (await post(srv.base, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2099-01-01" } })).json();
  assert.equal(init.result.serverInfo.name, "taste-overlap");
  assert.equal(init.result.protocolVersion, "2025-06-18");          // unknown version -> our newest, not echoed
  const list = await (await post(srv.base, { jsonrpc: "2.0", id: 2, method: "tools/list" })).json();
  assert.equal(list.result.tools[0].name, "plan_shared_evening");
  const r = await post(srv.base, { jsonrpc: "2.0", id: 3, method: "tools/call", params: CALL });
  assert.equal(r.headers.get("content-type"), "application/json");
  assert.equal((await r.json()).result.structuredContent.picks.length, 6);
});

test("notifications and client responses -> 202; GET -> 405; broken JSON -> 400; a tools/call without id does no work", async () => {
  for (const m of [{ jsonrpc: "2.0", method: "notifications/initialized" }, { jsonrpc: "2.0", id: 9, result: {} },
                   { jsonrpc: "2.0", method: "tools/call", params: { name: "plan_shared_evening", arguments: { city: "Berlin", person_a: ["X"], person_b: ["Y"] } } }]) {
    const n = await post(srv.base, m);
    assert.equal(n.status, 202);
    assert.equal(await n.text(), "");
  }
  assert.equal((await fetch(`${srv.base}/mcp`)).status, 405);
  const bad = await post(srv.base, "{kaputt");
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).error.code, -32700);
  assert.equal((await (await post(srv.base, "null")).json()).error.code, -32600);
});

test("wrong argument types are an input error the caller can read, not an internal message", async () => {
  const r = await (await post(srv.base, { jsonrpc: "2.0", id: 4, method: "tools/call",
    params: { name: "plan_shared_evening", arguments: { city: "Vienna", person_a: "abc", person_b: ["x"] } } })).json();
  assert.equal(r.result.isError, true);
  assert.match(r.result.content[0].text, /must be a list of names/);
  assert.doesNotMatch(r.result.content[0].text, /is not a function/);
});

test("the web app still works next to /mcp, and bad JSON there is a 400", async () => {
  const r = await fetch(`${srv.base}/api/plan`, { method: "POST",
    body: JSON.stringify({ city: "Vienna", a: ["Radiohead", "Wes Anderson"], b: ["Taylor Swift", "Studio Ghibli"] }) });
  assert.equal((await r.json()).picks.length, 6);
  assert.equal((await fetch(`${srv.base}/api/plan`, { method: "POST", body: "{x" })).status, 400);
});

test("limits: MCP has its own wider per-visitor limit; a forged X-Forwarded-For does not reset it; web is separate", async () => {
  const s = await startServer({ TO_LIMITS_IN_DEMO: "1" });
  try {
    for (let i = 0; i < 20; i++) {
      const j = await (await post(s.base, { jsonrpc: "2.0", id: i, method: "tools/call", params: CALL }, { "x-forwarded-for": `203.0.113.${i}` })).json();
      assert.ok(!j.result.isError, `call ${i} should pass`);
    }
    const blocked = await (await post(s.base, { jsonrpc: "2.0", id: 99, method: "tools/call", params: CALL }, { "x-forwarded-for": "203.0.113.200" })).json();
    assert.match(blocked.result.content[0].text, /too many plans/);
    const web = await fetch(`${s.base}/api/plan`, { method: "POST", body: JSON.stringify({ city: "Vienna", a: ["Radiohead", "Wes Anderson"], b: ["Taylor Swift", "Studio Ghibli"] }) });
    assert.equal(web.status, 200);                                    // the connector did not use up the web limit
  } finally { s.child.kill(); }
});
