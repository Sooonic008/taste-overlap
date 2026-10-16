const $ = (id) => document.getElementById(id);
const lines = (id) => $(id).value.split("\n").map((s) => s.trim()).filter(Boolean);

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function bar(value, colour) {
  const b = el("div", "bar");
  b.style.width = `${Math.max(4, Math.round(value * 120))}px`;
  b.style.background = colour;
  b.title = `${Math.round(value * 100)}%`;
  return b;
}

$("f").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const payload = { city: $("city").value.trim(), a: lines("a"), b: lines("b") };
  $("go").disabled = true;
  $("status").textContent = "Asking Qloo about both tastes…";
  $("picks").replaceChildren();
  $("match").textContent = "";
  try {
    const r = await fetch("/api/plan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
    $("match").textContent = `Matched A: ${d.matchedA.join(", ")} · B: ${d.matchedB.join(", ")}`;
    $("status").textContent = d.picks.length ? `Your evening in ${d.city}:` : "No place fits both tastes well enough - try other favourites.";
    for (const p of d.picks) {
      const li = el("li");
      li.append(el("h3", "", p.name));
      if (p.address) li.append(el("div", "addr", p.address));
      if (p.description) li.append(el("div", "addr", p.description));
      li.append(el("div", "why", p.why));
      if (p.basis === "combined") {
        li.append(el("span", "tag", "combined taste - not in both personal top 20"));
      } else {
        const bars = el("div", "bars");
        bars.append(bar(p.scoreA, "var(--a)"), bar(p.scoreB, "var(--b)"));
        li.append(bars);
      }
      for (const t of p.tags) li.append(el("span", "tag", t));
      $("picks").append(li);
    }
  } catch (err) {
    $("status").textContent = `Something went wrong: ${err.message}`;
  } finally {
    $("go").disabled = false;
  }
});
