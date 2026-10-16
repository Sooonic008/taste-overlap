// One place that decides how Taste Overlap talks to Qloo - shared by the web server and the MCP tool server.
// Default: the harness's canonical MCP adapter (`qloo mcp`), one long-running process for all requests.
// QLOO_TRANSPORT=exec spawns `qloo exec` per call; =rest uses the direct REST client; =demo replays a recorded live run
// (no key needed, only the recorded example).
import { readFile } from "node:fs/promises";
import { client } from "./qloo.js";
import { harnessClient } from "./harness.js";
import { replay } from "./demo.js";
import { mcpRunner } from "./mcp.js";

export async function qlooTransport(transport = process.env.QLOO_TRANSPORT || "mcp") {
  if (transport === "demo") {
    const rec = JSON.parse(await readFile(new URL("../demo/vienna.json", import.meta.url), "utf8"));
    const run = replay(rec.calls);
    return { name: "demo", client: () => harnessClient({ run }) };
  }
  if (transport === "mcp") {
    const run = mcpRunner();
    return { name: "mcp", client: () => harnessClient({ run }) };
  }
  if (transport === "rest") return { name: "rest", client: () => client() };
  return { name: "exec", client: () => harnessClient() };
}
