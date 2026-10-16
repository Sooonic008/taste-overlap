// Taste Overlap - tiny server, no dependencies. Serves public/ and POST /api/plan.
import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { plan } from "./src/plan.js";
import { limiter } from "./src/limit.js";
import { qlooTransport } from "./src/transport.js";

// How we talk to Qloo (default `qloo mcp`; exec / rest / demo) - shared with mcp-server.js.
const QLOO = await qlooTransport();
const DEMO = QLOO.name === "demo";
const qlooClient = QLOO.client;

// Each live plan costs 11 calls against the event quota.
const allow = limiter();
const visitorOf = (req) => String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim() || req.socket.remoteAddress;

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "public");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" };
const PORT = Number(process.env.PORT) || 8787;

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
