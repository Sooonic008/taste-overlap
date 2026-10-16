// Protects the event-issued Qloo quota on the public demo: a few plans per visitor per window, and a daily ceiling.

export function limiter({ perWindow = 5, windowMs = 10 * 60_000, globalPerDay = 300, clock = Date.now } = {}) {
  const seen = new Map();
  let day = -1, today = 0;
  return (visitor) => {
    const now = clock();
    const d = Math.floor(now / 86_400_000);
    if (d !== day) { day = d; today = 0; }
    if (today >= globalPerDay) return false;
    const recent = (seen.get(visitor) ?? []).filter((t) => now - t < windowMs);
    if (recent.length >= perWindow) { seen.set(visitor, recent); return false; }
    recent.push(now);
    seen.set(visitor, recent);
    if (seen.size > 5000) seen.delete(seen.keys().next().value);
    today += 1;
    return true;
  };
}
