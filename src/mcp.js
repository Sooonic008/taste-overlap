// Qloo through `qloo mcp`, the harness's canonical MCP stdio adapter (an official event surface, like `qloo exec`).
// One long-running process serves every workflow: on a small host a fresh `qloo exec` per call took >30 s,
// the same call over MCP takes about 0.5-1.2 s. Same normalized envelope, `execution.transport: "mcp"`.
//
// Failure handling (review 16.10.): a failed initialize, a dead or stuck process, or a broken pipe drops that process
// and fails its pending calls; the next call starts a fresh one. Events from an old process never touch a newer one.
import { spawn } from "node:child_process";
import { OPERATIONS, DEFAULT_BIN } from "./harness.js";

export function mcpRunner({ bin = process.env.QLOO_BIN || DEFAULT_BIN, timeoutMs = 60_000,
  spawnFn = () => spawn(bin, ["mcp"], { shell: process.platform === "win32", env: process.env }) } = {}) {
  let child = null, ready = null, nextId = 0;
  const waiting = new Map();

  function drop(proc, err) {
    if (child !== proc) return;                    // a late event from an older process
    child = null;
    ready = null;
    for (const { reject } of waiting.values()) reject(err);
    waiting.clear();
    try { proc.kill(); } catch { /* already gone */ }
  }

  function request(proc, method, params) {
    return new Promise((resolve, reject) => {
      if (child !== proc) return reject(new Error("qloo mcp process exited"));
      const id = ++nextId;
      const timer = setTimeout(() => {
        waiting.delete(id);
        reject(new Error(`qloo mcp ${method} timed out`));
        drop(proc, new Error(`qloo mcp ${method} timed out`));   // a stuck process is replaced, not waited on
      }, timeoutMs);
      waiting.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
      try {
        proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
      } catch (e) {
        drop(proc, e);
      }
    });
  }

  function start() {
    const proc = spawnFn();
    child = proc;
    let buf = "";
    proc.stdout.on("data", (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line) continue;
        let msg;
        try { msg = JSON.parse(line); } catch { continue; }       // not a JSON-RPC line
        const w = waiting.get(msg.id);
        if (!w) continue;
        waiting.delete(msg.id);
        if (msg.error) w.reject(new Error(`qloo mcp: ${msg.error.message || msg.error.code}`));
        else w.resolve(msg.result);
      }
    });
    proc.stderr?.on("data", () => {});
    proc.on("exit", () => drop(proc, new Error("qloo mcp process exited")));
    proc.on("error", (e) => drop(proc, e));
    proc.stdin.on("error", (e) => drop(proc, e));                // EPIPE must never crash the server
    const init = request(proc, "initialize", { protocolVersion: "2025-06-18", capabilities: {},
      clientInfo: { name: "taste-overlap", version: "0.1.0" } })
      .then(() => { proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n"); return proc; });
    init.catch((e) => drop(proc, e));                            // a failed initialize must not poison later calls
    ready = init;
    return init;
  }

  return async function run(operation, input) {
    if (!OPERATIONS.has(operation)) throw new Error(`unknown Qloo workflow: ${operation}`);
    const proc = await (ready ?? start());
    const result = await request(proc, "tools/call", { name: `qloo_${operation}`, arguments: input });
    if (result?.structuredContent) return result.structuredContent;
    const text = result?.content?.find((c) => c?.type === "text")?.text;
    try { return JSON.parse(text); } catch { throw new Error(`qloo mcp ${operation}: no JSON result`); }
  };
}
