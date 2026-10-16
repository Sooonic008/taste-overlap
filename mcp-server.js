#!/usr/bin/env node
// Taste Overlap as an agent tool: a dependency-free MCP stdio server with one tool, `plan_shared_evening`.
// Any MCP client (Claude Desktop, Claude Code, Cursor, an agent framework) can call it; the Qloo work behind it is the
// same plan as the web app (resolve favourites -> three `recommend` workflows -> overlap -> explained evening).
//   claude mcp add taste-overlap -- node /path/to/taste-overlap/mcp-server.js
// The Qloo key stays in this process's environment (QLOO_API_KEY, QLOO_BASE_URL, QLOO_TRUSTED_BASE_URL).
import { plan } from "./src/plan.js";
import { qlooTransport } from "./src/transport.js";

const TOOL = {
  name: "plan_shared_evening",
  title: "Plan a shared evening (Qloo taste overlap)",
  description: "Given a city and a few favourites for each of two people (artists, films, shows, books, brands), "
    + "returns up to six places both would enjoy, ranked by Qloo's taste graph, each with the reason and in evening order "
    + "(something to do, food, a drink). Picks marked basis=combined come from Qloo's list for the combined taste "
    + "because the two personal top-20 lists did not overlap enough.",
  inputSchema: {
    type: "object",
    required: ["city", "person_a", "person_b"],
    properties: {
      city: { type: "string", description: "City, e.g. Vienna" },
      person_a: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 5, description: "Favourites of person A" },
      person_b: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 5, description: "Favourites of person B" },
    },
    additionalProperties: false,
  },
};

const qloo = await qlooTransport();

function summary(r) {
  const lines = [`Evening in ${r.city} for A (${r.matchedA.join(", ")}) and B (${r.matchedB.join(", ")}):`];
  r.picks.forEach((p, i) => lines.push(`${i + 1}. ${p.name}${p.address ? ` - ${p.address}` : ""} [${p.basis}] - ${p.why}`));
  if (!r.picks.length) lines.push("No place fits both tastes well enough.");
  return lines.join("\n");
}

async function handle(msg) {
  const { id, method, params } = msg;
  if (method === "initialize") {
    return { protocolVersion: params?.protocolVersion || "2025-06-18", capabilities: { tools: {} },
      serverInfo: { name: "taste-overlap", version: "0.1.0" } };
  }
  if (method === "ping") return {};
  if (method === "tools/list") return { tools: [TOOL] };
  if (method === "tools/call") {
    if (params?.name !== TOOL.name) throw Object.assign(new Error(`unknown tool: ${params?.name}`), { code: -32602 });
    const a = params.arguments ?? {};
    try {
      const r = await plan({ city: a.city, a: a.person_a, b: a.person_b }, qloo.client());
      return { content: [{ type: "text", text: summary(r) }], structuredContent: r };
    } catch (err) {
      return { isError: true, content: [{ type: "text", text: err.message }] };
    }
  }
  if (id === undefined) return undefined;          // notifications need no answer
  throw Object.assign(new Error(`method not found: ${method}`), { code: -32601 });
}

const reply = (obj) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...obj }) + "\n");

let buf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buf += chunk;
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { reply({ id: null, error: { code: -32700, message: "parse error" } }); continue; }
    handle(msg).then(
      (result) => { if (msg.id !== undefined && result !== undefined) reply({ id: msg.id, result }); },
      (err) => { if (msg.id !== undefined) reply({ id: msg.id, error: { code: err.code ?? -32603, message: err.message } }); },
    );
  }
});
process.stdin.on("end", () => process.exit(0));
