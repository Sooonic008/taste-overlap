// Qloo through the official event surface: `qloo exec` from @qloo/qloo-harness (docs/API_ACCESS.md).
// The harness resolves human names itself and validates every workflow input before calling Qloo.
// The key never touches this code: the harness reads QLOO_API_KEY or its own private config (`qloo setup --qloo`).
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Prefer the harness pinned in package.json (hosted deploys), fall back to a global `qloo`.
const LOCAL_BIN = fileURLToPath(new URL(`../node_modules/.bin/qloo${process.platform === "win32" ? ".cmd" : ""}`, import.meta.url));
const DEFAULT_BIN = existsSync(LOCAL_BIN) ? LOCAL_BIN : "qloo";

/** Run one workflow: JSON goes in on stdin (no shell quoting of user text), one JSON result comes out. */
const OPERATIONS = new Set(["recommend", "rank", "describe", "where_popular", "compare_audiences", "entity_tags",
  "audience_demographics", "trends", "find_tags"]);

export function runExec(operation, input, { bin = process.env.QLOO_BIN || DEFAULT_BIN, timeoutMs = 30_000 } = {}) {
  // Only fixed workflow names reach the command line (Windows needs shell:true for qloo.cmd); user text goes via stdin.
  if (!OPERATIONS.has(operation)) return Promise.reject(new Error(`unknown Qloo workflow: ${operation}`));
  return new Promise((resolve, reject) => {
    const child = spawn(bin, ["exec", operation], { shell: process.platform === "win32", env: process.env });
    let out = "", err = "";
    const timer = setTimeout(() => { child.kill(); reject(new Error(`qloo exec ${operation} timed out`)); }, timeoutMs);
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { err += d; });
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
    child.on("close", () => {
      clearTimeout(timer);
      try { resolve(JSON.parse(out)); } catch { reject(new Error(`qloo exec ${operation}: no JSON (${err.trim().slice(0, 160)})`)); }
    });
    child.stdin.end(JSON.stringify(input));
  });
}

/** The entity list inside a normalized result, wherever the envelope nests it (first array of named objects). */
export function entitiesOf(node, depth = 0) {
  if (!node || typeof node !== "object" || depth > 4) return [];
  if (Array.isArray(node)) return node.length && node.every((x) => x && typeof x === "object" && "name" in x) ? node : [];
  for (const key of ["entities", "results", "recommendations", "items", "data", "result"]) {
    const found = entitiesOf(node[key], depth + 1);
    if (found.length) return found;
  }
  return [];
}

function tagsOf(env) {
  const raw = env?.tags ?? env?.results?.tags ?? env?.result?.tags ?? entitiesOf(env).flatMap((e) => e.tags ?? []);
  return (Array.isArray(raw) ? raw : []).map((t) => (typeof t === "string" ? t : t?.name)).filter(Boolean);
}

/** Replace each ambiguous name in the input arrays by the id of Qloo's first (highest-ranked) candidate. */
function chooseFirst(input, issues) {
  const choices = [];
  const next = { ...input };
  for (const issue of issues) {
    const pick = issue?.candidates?.[0];
    if (!pick?.id) continue;
    for (const [key, value] of Object.entries(next)) {
      if (Array.isArray(value) && value.includes(issue.input)) next[key] = value.map((v) => (v === issue.input ? pick.id : v));
    }
    choices.push({ input: issue.input, id: pick.id, type: pick.type });
  }
  return { next, choices };
}

function entityIdOf(env, name) {
  const lists = [env?.interpretation?.entities, env?.interpretation?.signals].filter(Array.isArray);
  return lists.flat().find((e) => e?.input === name && e?.entityId)?.entityId;
}

export function harnessClient({ run = runExec } = {}) {
  /** One workflow; `needs_input` (ambiguous names) is answered once with the first candidate, and the choice is returned. */
  const call = async (op, input) => {
    let env = await run(op, input);
    if (env?.error) throw new Error(`Qloo ${op}: ${env.error.code || "error"}`);
    let choices = [];
    if (env?.status === "needs_input") {
      const picked = chooseFirst(input, env?.resolution?.issues ?? []);
      choices = picked.choices;
      env = await run(op, picked.next);
      if (env?.error) throw new Error(`Qloo ${op}: ${env.error.code || "error"}`);
      if (env?.status === "needs_input") throw new Error(`Qloo ${op}: inputs still unresolved`);
    }
    return { env, choices };
  };

  /** Fetch tags to explain the picks; the id is Qloo's entity id when the workflow reports one. */
  async function resolve(name) {
    let tags = [], id = name;
    try {
      const { env, choices } = await call("entity_tags", { entities: [name], limit: 8 });
      tags = tagsOf(env);
      id = choices.find((c) => c.input === name)?.id ?? entityIdOf(env, name) ?? name;
    } catch { /* tags are optional */ }
    return { id, name, tags };
  }

  /** Places in a city for a set of taste signals - the `recommend` workflow, shaped like an insights response. */
  async function places(signals, city, limit = 20) {
    const { env, choices } = await call("recommend", { target_type: "place", signals, filter_location: city, explain: true, limit });
    return { results: { entities: entitiesOf(env) }, choices };
  }

  return { resolve, places };
}
