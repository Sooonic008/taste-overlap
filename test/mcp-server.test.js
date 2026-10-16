import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const SERVER = fileURLToPath(new URL("../mcp-server.js", import.meta.url));

/** A JSON-RPC session with the real server process (demo transport: no key, recorded Qloo answers). */
function session() {
  const child = spawn(process.execPath, [SERVER], { env: { ...process.env, QLOO_TRANSPORT: "demo", QLOO_API_KEY: "" } });
  let buf = "", id = 0;
  const waiting = new Map();
  child.stdout.on("data", (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      let m;
      try { m = JSON.parse(line); } catch { continue; }
      waiting.get(m.id)?.(m);
      waiting.delete(m.id);
    }
  });
  child.on("exit", () => { for (const r of waiting.values()) r({ error: { message: "server exited" } }); waiting.clear(); });
  const rpc = (method, params) => new Promise((resolve, reject) => {
    const n = ++id;
    const timer = setTimeout(() => { waiting.delete(n); reject(new Error(`${method} timed out`)); }, 20_000);
    waiting.set(n, (m) => { clearTimeout(timer); resolve(m); });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: n, method, params }) + "\n");
  });
  return { rpc, close: () => child.kill() };
}

const INIT = { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } };

test("Taste Overlap is itself an MCP tool any agent can call", async () => {
  const s = session();
  try {
    const init = await s.rpc("initialize", INIT);
    assert.equal(init.result.serverInfo.name, "taste-overlap");
    const tools = (await s.rpc("tools/list", {})).result.tools;
    const tool = tools.find((t) => t.name === "plan_shared_evening");
    assert.ok(tool && tool.inputSchema.required.includes("city"));
    const r = await s.rpc("tools/call", { name: "plan_shared_evening",
      arguments: { city: "Vienna", person_a: ["Radiohead", "Wes Anderson"], person_b: ["Taylor Swift", "Studio Ghibli"] } });
    assert.equal(r.result.isError, undefined);
    assert.equal(r.result.structuredContent.picks.length, 6);
    assert.match(r.result.content[0].text, /Wien Museum Mozart apartment/);
  } finally { s.close(); }
});

test("bad input is a tool error the agent can read, not a crash", async () => {
  const s = session();
  try {
    await s.rpc("initialize", INIT);
    const r = await s.rpc("tools/call", { name: "plan_shared_evening", arguments: { city: "Vienna", person_a: [], person_b: ["x"] } });
    assert.equal(r.result.isError, true);
    assert.match(r.result.content[0].text, /required/);
    const u = await s.rpc("tools/call", { name: "nope", arguments: {} });
    assert.ok(u.error || u.result?.isError);
    assert.equal((await s.rpc("ping", {})).result !== undefined, true);   // still alive
  } finally { s.close(); }
});
