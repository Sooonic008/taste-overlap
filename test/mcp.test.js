import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { mcpRunner } from "../src/mcp.js";

/** A fake `qloo mcp` process: answers JSON-RPC lines with `reply(message)`. */
function fakeSpawn(reply, starts) {
  return () => {
    starts.push(1);
    const child = new EventEmitter();
    child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough();
    let buf = "";
    child.stdin.on("data", (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1);
        if (m.id === undefined) continue;
        const out = m.method === "initialize" ? { result: { serverInfo: { name: "qloo-harness" } } } : reply(m);
        if (out) child.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: m.id, ...out }) + "\n");
      }
    });
    child.kill = () => child.emit("exit", 0);
    return child;
  };
}

test("one long-running qloo mcp process serves every workflow as qloo_<op>", async () => {
  const starts = [], seen = [];
  const run = mcpRunner({ spawnFn: fakeSpawn((m) => { seen.push(m.params); return { result: { structuredContent: { status: "ok", op: m.params.name } } }; }, starts) });
  assert.deepEqual(await run("recommend", { limit: 3 }), { status: "ok", op: "qloo_recommend" });
  assert.deepEqual(await run("entity_tags", { entities: ["x"] }), { status: "ok", op: "qloo_entity_tags" });
  assert.equal(starts.length, 1);
  assert.deepEqual(seen[0], { name: "qloo_recommend", arguments: { limit: 3 } });
});

test("falls back to the JSON text content when there is no structuredContent", async () => {
  const run = mcpRunner({ spawnFn: fakeSpawn(() => ({ result: { content: [{ type: "text", text: "{\"status\":\"ok\",\"n\":1}" }] } }), []) });
  assert.deepEqual(await run("describe", {}), { status: "ok", n: 1 });
});

test("an MCP error or a tool error envelope is never an empty success", async () => {
  const run = mcpRunner({ spawnFn: fakeSpawn((m) => m.params.name === "qloo_rank"
    ? { error: { code: -32602, message: "bad input" } }
    : { result: { isError: true, structuredContent: { error: { code: "QLOO_AUTH" } } } }, []) });
  await assert.rejects(run("rank", {}), /bad input/);
  assert.deepEqual(await run("recommend", {}), { error: { code: "QLOO_AUTH" } });   // harnessClient turns this into a throw
});

test("a call that never answers times out instead of hanging the request", async () => {
  const run = mcpRunner({ timeoutMs: 50, spawnFn: fakeSpawn(() => null, []) });
  await assert.rejects(run("recommend", {}), /timed out/);
});

test("unknown workflow names never reach the process", async () => {
  const run = mcpRunner({ spawnFn: fakeSpawn(() => ({ result: {} }), []) });
  await assert.rejects(run("capabilities; rm", {}), /unknown Qloo workflow/);
});

test("a process that dies mid-call fails that call and the next call starts a fresh process", async () => {
  const starts = [];
  let die = true;
  const run = mcpRunner({ spawnFn: fakeSpawn(function () { return null; }, starts) });
  // first call: the process exits before answering
  const spawnDying = fakeSpawn(() => null, starts);
  const run2 = mcpRunner({ spawnFn: () => { const c = spawnDying(); if (die) { die = false; setTimeout(() => c.emit("exit", 1), 20); } else {
    c.stdin.removeAllListeners("data");
    let buf = "";
    c.stdin.on("data", (d) => { buf += d; let i; while ((i = buf.indexOf("\n")) >= 0) { const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1);
      if (m.id !== undefined) c.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: m.id, result: m.method === "initialize" ? {} : { structuredContent: { status: "ok" } } }) + "\n"); } });
  } return c; } });
  await assert.rejects(run2("recommend", {}), /exited/);
  assert.deepEqual(await run2("recommend", {}), { status: "ok" });
  assert.equal(starts.length, 2);
  void run;
});

test("a failed initialize does not poison the runner: the next call restarts", async () => {
  const starts = [];
  let first = true;
  const run = mcpRunner({ spawnFn: () => {
    starts.push(1);
    const c = new EventEmitter();
    c.stdout = new PassThrough(); c.stderr = new PassThrough(); c.stdin = new PassThrough();
    const bad = first; first = false;
    let buf = "";
    c.stdin.on("data", (d) => { buf += d; let i; while ((i = buf.indexOf("\n")) >= 0) { const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1);
      if (m.id === undefined) continue;
      const out = bad ? { error: { code: -32603, message: "init failed" } } : { result: m.method === "initialize" ? {} : { structuredContent: { status: "ok" } } };
      c.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: m.id, ...out }) + "\n"); } });
    c.kill = () => c.emit("exit", 0);
    return c;
  } });
  await assert.rejects(run("recommend", {}), /init failed/);
  assert.deepEqual(await run("recommend", {}), { status: "ok" });
  assert.equal(starts.length, 2);
});

test("concurrent calls each get their own answer", async () => {
  const run = mcpRunner({ spawnFn: fakeSpawn((m) => ({ result: { structuredContent: { n: m.arguments?.limit ?? m.params?.arguments?.limit } } }), []) });
  const r = await Promise.all([1, 2, 3].map((n) => run("recommend", { limit: n })));
  assert.deepEqual(r.map((x) => x.n), [1, 2, 3]);
});

test("a timed-out call kills the stuck process so the next call gets a fresh one", async () => {
  const starts = [];
  const run = mcpRunner({ timeoutMs: 50, spawnFn: fakeSpawn((m) => (starts.length > 1 ? { result: { structuredContent: { status: "ok" } } } : null), starts) });
  await assert.rejects(run("recommend", {}), /timed out/);
  assert.deepEqual(await run("recommend", {}), { status: "ok" });
  assert.equal(starts.length, 2);
});

test("a broken stdin pipe never crashes the server", async () => {
  const run = mcpRunner({ spawnFn: () => {
    const c = new EventEmitter();
    c.stdout = new PassThrough(); c.stderr = new PassThrough(); c.stdin = new PassThrough();
    c.stdin.on("data", () => c.stdin.emit("error", Object.assign(new Error("write EPIPE"), { code: "EPIPE" })));
    c.kill = () => c.emit("exit", 0);
    return c;
  } });
  await assert.rejects(run("recommend", {}), /EPIPE|exited/);
});
