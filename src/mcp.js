// Qloo through `qloo mcp`, the harness's canonical MCP stdio adapter (an official event surface, like `qloo exec`).
// One long-running process serves every workflow: on a small host a fresh `qloo exec` per call took >30 s,
// the same call over MCP takes about 0.5-1.2 s. Same normalized envelope, `execution.transport: "mcp"`.
import { spawn } from "node:child_process";
import { OPERATIONS, DEFAULT_BIN } from "./harness.js";

export function mcpRunner({ bin = process.env.QLOO_BIN || DEFAULT_BIN, timeoutMs = 60_000,
  spawnFn = () => spawn(bin, ["mcp"], { shell: process.platform === "win32", env: process.env }) } = {}) {
  let child = null, ready = null, nextId = 0;
  const waiting = new Map();

  const failAll = (err) => { for (const { reject } of waiting.values()) reject(err); waiting.clear(); };

  function send(message) { child.stdin.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + "\n"); }

  function request(method, params) {
    return new Promise((resolve, reject) => {
      const id = ++nextId;
      const timer = setTimeout(() => { waiting.delete(id); reject(new Error(`qloo mcp ${method} timed out`)); }, timeoutMs);
      waiting.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
      send({ id, method, params });
    });
  }

  function start() {
    child = spawnFn();
    let buf = "";
    child.stdout.on("data", (d) => {
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
    child.stderr?.on("data", () => {});
    const gone = () => { child = null; ready = null; failAll(new Error("qloo mcp process exited")); };
    child.on("exit", gone);
    child.on("error", gone);
    ready = request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "taste-overlap", version: "0.1.0" } })
      .then(() => send({ method: "notifications/initialized" }));
    ready.catch(() => {});
    return ready;
  }

  return async function run(operation, input) {
    if (!OPERATIONS.has(operation)) throw new Error(`unknown Qloo workflow: ${operation}`);
    await (ready ?? start());
    const result = await request("tools/call", { name: `qloo_${operation}`, arguments: input });
    if (result?.structuredContent) return result.structuredContent;
    const text = result?.content?.find((c) => c?.type === "text")?.text;
    try { return JSON.parse(text); } catch { throw new Error(`qloo mcp ${operation}: no JSON result`); }
  };
}
