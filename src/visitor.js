// Who is calling, for the per-visitor limits. Measured on Render (behind Cloudflare) on 16 Oct 2026 by sending the
// documentation address 203.0.113.77 in forged headers to /api/health:
//   X-Forwarded-For  -> the forged value arrives as the FIRST entry (the old limiter used exactly that: bypassable)
//   CF-Connecting-IP -> Cloudflare rejects a forged value with 403; set only by Cloudflare
//   True-Client-IP   -> a forged value never arrives; overwritten upstream
// So only the Cloudflare headers are trusted; without them (local runs) the socket address is used.
export function visitorOf(headers = {}, socketAddress = "") {
  const first = (v) => String(v ?? "").split(",")[0].trim();
  return first(headers["cf-connecting-ip"]) || first(headers["true-client-ip"]) || socketAddress || "unknown";
}
