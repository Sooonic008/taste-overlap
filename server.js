// Taste Overlap - tiny server, no dependencies. Serves public/, POST /api/plan and the remote MCP endpoint POST /mcp.
import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { plan } from "./src/plan.js";
import { limiter } from "./src/limit.js";
import { qlooTransport } from "./src/transport.js";
import { mcpProtocol } from "./src/mcp-protocol.js";
import { visitorOf as visitorFrom } from "./src/visitor.js";

// How we talk to Qloo (default `qloo mcp`; exec / rest / demo) - shared with mcp-server.js.
const QLOO = await qlooTransport();
const DEMO = QLOO.name === "demo";
const qlooClient = QLOO.client;
const MCP = mcpProtocol(qlooClient);

// Each live plan costs 11 calls against the event quota. Web and remote MCP have separate limits (review 16.10.): MCP calls
// from claude.ai share a few Anthropic server addresses, so its per-address limit is wider, and each path has its own daily
// ceiling so the connector can never starve the web demo. TO_LIMITS_IN_DEMO=1 turns the limits on in demo mode (tests).
const allowWeb = limiter({ perWindow: 5, windowMs: 10 * 60_000, globalPerDay: 200 });
const allowMcp = limiter({ perWindow: 20, windowMs: 10 * 60_000, globalPerDay: 150 });
const LIMITS = !DEMO || process.env.TO_LIMITS_IN_DEMO === "1";
const visitorOf = (req) => visitorFrom(req.headers, req.socket.remoteAddress);

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "public");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" };
// PORT=0 means "any free port" (tests); `Number(x) || 8787` threw the 0 away and the tests hit a foreign service on 8787.
const PORT = /^\d+$/.test(process.env.PORT ?? "") ? Number(process.env.PORT) : 8787;

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
  const raw = await rawBody(req);
  try { return JSON.parse(raw || "{}"); } catch { throw Object.assign(new Error("request body must be JSON"), { status: 400 }); }
}

// Which proxy headers can be trusted is measured, not assumed: a caller sends the documentation address 203.0.113.77
// in forged headers, /api/health reports only WHERE that marker arrived and how many X-Forwarded-For entries exist -
// never a real address. It also reports the deployed commit, so a post-deploy smoke test can prove the new version runs.
const MARKER = "203.0.113.77";
function health(req) {
  const proxy = ["x-forwarded-for", "cf-connecting-ip", "true-client-ip", "x-real-ip", "x-forwarded"];
  return {
    ok: true, commit: (process.env.RENDER_GIT_COMMIT || "local").slice(0, 7), transport: QLOO.name,
    headers_present: proxy.filter((h) => req.headers[h] !== undefined),
    xff_entries: String(req.headers["x-forwarded-for"] ?? "").split(",").filter((s) => s.trim()).length,
    marker_in: proxy.filter((h) => String(req.headers[h] ?? "").split(",").map((s) => s.trim()).includes(MARKER)),
    marker_last_in_xff: String(req.headers["x-forwarded-for"] ?? "").split(",").map((s) => s.trim()).filter(Boolean).at(-1) === MARKER,
  };
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url.split("?")[0] === "/api/health") {
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      return res.end(JSON.stringify(health(req)));
    }
    if (req.method === "POST" && req.url === "/api/plan") {
      if (LIMITS && !allowWeb(visitorOf(req))) throw Object.assign(new Error("too many plans - please try again in a few minutes"), { status: 429 });
      let result;
      try { result = await plan(await body(req), qlooClient()); } catch (e) {
        if (e.input || e.status) throw e;            // only input errors are shown verbatim
        throw Object.assign(new Error("Qloo did not answer - please try again in a minute"), { status: 502 });
      }
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
      if (msg?.method === "tools/call" && msg.id !== undefined && LIMITS && !allowMcp(visitorOf(req))) {
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

server.listen(PORT, () => console.log(`Taste Overlap on http://localhost:${server.address().port}`));
