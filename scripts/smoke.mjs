// Smoke test after a deploy: one real plan against the live URL. A 200 is not enough - the plan must contain places.
// Usage: node scripts/smoke.mjs https://taste-overlap.onrender.com [timeoutSeconds]
// The free host can take ~60 s to wake up, so the page is polled first, then one plan is requested.
const base = (process.argv[2] || process.env.SMOKE_URL || "").replace(/\/$/, "");
const limitS = Number(process.argv[3] || process.env.SMOKE_TIMEOUT_S || 150);
if (!base) { console.error("usage: node scripts/smoke.mjs <url> [timeoutSeconds]"); process.exit(2); }

const deadline = Date.now() + limitS * 1000;
const left = () => Math.max(1000, deadline - Date.now());

async function wake() {
  while (Date.now() < deadline) {
    try {
      const r = await fetch(base + "/", { signal: AbortSignal.timeout(Math.min(30_000, left())) });
      if (r.ok && (await r.text()).includes("Taste Overlap")) return;
    } catch { /* still waking up */ }
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw new Error(`page did not come up within ${limitS} s`);
}

const t0 = Date.now();
try {
  await wake();
  const r = await fetch(base + "/api/plan", { method: "POST", signal: AbortSignal.timeout(left()),
    body: JSON.stringify({ city: "Paris", a: ["Beyoncé"], b: ["Harry Potter"] }) });
  const d = await r.json();
  if (!r.ok) throw new Error(`plan HTTP ${r.status}: ${d.error}`);
  if (!Array.isArray(d.picks) || d.picks.length === 0) throw new Error("plan returned no places");
  if (!d.picks.every((p) => p.name && p.why)) throw new Error("a pick has no name or no reason");
  console.log(`smoke ok: ${d.picks.length} places in ${((Date.now() - t0) / 1000).toFixed(1)} s - ${d.picks.map((p) => p.name).join(" | ")}`);
} catch (err) {
  console.error(`smoke FAILED after ${((Date.now() - t0) / 1000).toFixed(1)} s: ${err.message}`);
  process.exit(1);
}
