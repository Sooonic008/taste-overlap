// The MCP side of Taste Overlap, shared by the stdio server (mcp-server.js) and the remote endpoint (POST /mcp in
// server.js). One tool, `plan_shared_evening`; the work behind it is the same plan as the web app.
import { plan } from "./plan.js";

export const TOOL = {
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

function summary(r) {
  const lines = [`Evening in ${r.city} for A (${r.matchedA.join(", ")}) and B (${r.matchedB.join(", ")}):`];
  r.picks.forEach((p, i) => lines.push(`${i + 1}. ${p.name}${p.address ? ` - ${p.address}` : ""} [${p.basis}] - ${p.why}`));
  if (!r.picks.length) lines.push("No place fits both tastes well enough.");
  return lines.join("\n");
}

const VERSIONS = ["2025-06-18", "2025-03-26"];

/** `respond(message)` -> the JSON-RPC answer object, or null for notifications. Never throws. */
export function mcpProtocol(qlooClient) {
  async function handle(msg) {
    const { id, method, params } = msg;
    if (method === "initialize") {
      // Answer with a version we speak: the client's if supported, otherwise our newest (spec 2025-06-18).
      const asked = params?.protocolVersion;
      return { protocolVersion: VERSIONS.includes(asked) ? asked : VERSIONS[0], capabilities: { tools: {} },
        serverInfo: { name: "taste-overlap", version: "0.1.0" } };
    }
    if (id === undefined) return undefined;          // notifications never trigger work (a tools/call without id spent quota)
    if (method === "ping") return {};
    if (method === "tools/list") return { tools: [TOOL] };
    if (method === "tools/call") {
      if (params?.name !== TOOL.name) throw Object.assign(new Error(`unknown tool: ${params?.name}`), { code: -32602 });
      const a = params.arguments ?? {};
      try {
        const r = await plan({ city: a.city, a: a.person_a, b: a.person_b }, qlooClient());
        return { content: [{ type: "text", text: summary(r) }], structuredContent: r };
      } catch (err) {
        // Only input errors go back verbatim; upstream/internal messages stay inside (review 16.10.).
        return { isError: true, content: [{ type: "text", text: err.input ? err.message : "Qloo did not answer - please try again in a minute" }] };
      }
    }
    throw Object.assign(new Error(`method not found: ${method}`), { code: -32601 });
  }

  async function respond(msg) {
    if (!msg || typeof msg !== "object" || Array.isArray(msg)) {      // null, numbers, batches: not supported, never fatal
      return { jsonrpc: "2.0", id: null, error: { code: -32600, message: "invalid request (expected one JSON-RPC object)" } };
    }
    if (typeof msg.method !== "string") return null;                    // a client's response/result: nothing to answer
    try {
      const result = await handle(msg);
      return msg.id === undefined || result === undefined ? null : { jsonrpc: "2.0", id: msg.id, result };
    } catch (err) {
      return msg.id === undefined ? null : { jsonrpc: "2.0", id: msg.id, error: { code: err.code ?? -32603, message: err.message } };
    }
  }

  return { respond };
}
