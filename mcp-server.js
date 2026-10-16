#!/usr/bin/env node
// Taste Overlap as an agent tool: a dependency-free MCP stdio server with one tool, `plan_shared_evening`.
// Any MCP client (Claude Desktop, Claude Code, Cursor, an agent framework) can call it; the Qloo work behind it is the
// same plan as the web app (resolve favourites -> three `recommend` workflows -> overlap -> explained evening).
//   claude mcp add taste-overlap -- node /path/to/taste-overlap/mcp-server.js
// The Qloo key stays in this process's environment (QLOO_API_KEY, QLOO_BASE_URL, QLOO_TRUSTED_BASE_URL).
// The same protocol is served remotely at POST /mcp by server.js.
import { qlooTransport } from "./src/transport.js";
import { mcpProtocol } from "./src/mcp-protocol.js";

const qloo = await qlooTransport();
const { respond } = mcpProtocol(qloo.client);
const reply = (obj) => process.stdout.write(JSON.stringify(obj) + "\n");

let buf = "", pending = 0, closed = false;
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buf += chunk;
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { reply({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } }); continue; }
    pending += 1;
    respond(msg).then((a) => { if (a) reply(a); }).catch(() => {})
      .finally(() => { pending -= 1; if (closed && !pending) process.exit(0); });
  }
});
// stdin closed: answer what is still running (a plan takes seconds), then exit - the qloo child goes with the process.
process.stdin.on("end", () => { closed = true; if (!pending) process.exit(0); });
process.on("unhandledRejection", () => {});    // a last net: one bad request must never end the session
