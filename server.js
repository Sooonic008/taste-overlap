// Taste Overlap - tiny server, no dependencies. Serves public/, POST /api/plan and the remote MCP endpoint POST /mcp.
import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { plan } from "./src/plan.js";
import { limiter } from "./src/limit.js";
import { qlooTransport } from "./src/transport.js";
import { mcpProtocol } from "./src/mcp-protocol.js";

// How we talk to Qloo (default `qloo mcp`; exec / rest / demo) - shared with mcp-server.js.
const QLOO = await qlooTransport();
const DEMO = QLOO.name === "demo";
const qlooClient = QLOO.client;
const MCP = mcpProtocol(qlooClient);

// Each live plan costs 11 calls against the event quota.
const allow = limiter();
const visitorOf = (req) => String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim() || req.socket.remoteAddress;

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "public");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" };
const PORT = Number(process.env.PORT) || 8787;

async function rawBody(req) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 10_000) {
      req.destroy();
      throw Object.assign(new Error("request too large"), { status: 413 });
    }
  }
  return raw;
}

async function body(req) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 10_000) {
      req.destroy();
      throw Object.assign(new Error("request too large"), { status: 413 });
    }
  }
  return JSON.parse(raw || "{}");
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "POST" && req.url === "/api/plan") {
      if (!DEMO && !allow(visitorOf(req))) throw Object.assign(new Error("too many plans - please try again in a few minutes"), { status: 429 });
      const result = await plan(await body(req), qlooClient());
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify(result));
    }
    // Remote MCP (streamable HTTP, stateless JSON answers): lets claude.ai / the Claude app use Taste Overlap as a
    // connector without installing anything. Tool calls share the per-visitor and daily limits of the web app.
    if (req.url.split("?")[0] === "/mcp") {
      if (req.method !== "POST") { res.writeHead(405, { allow: "POST" }); return res.end(); }
      let msg;
      try { msg = JSON.parse(await rawBody(req)); } catch (e) {
        if (e.status === 413) throw e;
        res.writeHead(400, { "content-type": "application/json" });
        return res.end(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } }));
      }
      if (msg?.method === "tools/call" && !DEMO && !allow(visitorOf(req))) {
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify({ jsonrpc: "2.0", id: msg.id ?? null,
          result: { isError: true, content: [{ type: "text", text: "too many plans - please try again in a few minutes" }] } }));
      }
      const answer = await MCP.respond(msg);
      if (!answer) { res.writeHead(202); return res.end(); }
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify(answer));
    }
    const path = normalize(req.url === "/" ? "/index.html" : req.url.split("?")[0]).replace(/^(\.\.[/\\])+/, "");
    const file = join(ROOT, path);
    if (!file.startsWith(ROOT + sep)) throw Object.assign(new Error("not found"), { status: 404 });
    const data = await readFile(file);
    res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream" });
    res.end(data);
  } catch (err) {
    const status = err.status || (err.code === "ENOENT" ? 404 : 400);
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: status === 404 ? "not found" : err.message }));
  }
});

server.listen(PORT, () => console.log(`Taste Overlap on http://localhost:${PORT}`));
