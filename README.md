# Taste Overlap

Two people, a few favourites each (artists, films, shows, books, places). Qloo's taste graph ranks places in your city for person A, for person B and for both together. Taste Overlap keeps only the places that rank well for **both** (harmonic mean of the two affinities, so one-sided picks drop out), explains each pick with the shared taste tags, and orders them into an evening: something to do, food, then a drink.

Without Qloo there is nothing to show: the overlap is computed from Qloo's per-person affinities, not from an LLM guess.

## Run

Needs Node.js 22.19+ and the official Qloo harness (the supported event surface):

```bash
npm install --global @qloo/qloo-harness   # qloo --version >= 0.1.26
export QLOO_API_KEY=...                    # the hackathon key (or: qloo setup --qloo)
export QLOO_BASE_URL=https://hackathon.api.qloo.com
export QLOO_TRUSTED_BASE_URL=https://hackathon.api.qloo.com   # the harness only sends a key to an approved endpoint
npm start                                  # http://localhost:8787
```

**Demo without credentials:** `QLOO_TRANSPORT=demo npm start` replays a real recorded run (`demo/vienna.json`, 11 `qloo exec` calls) through the same code. Only that example works (Vienna; Radiohead + Wes Anderson / Taylor Swift + Studio Ghibli); other inputs return an error instead of invented places.

Optional: `QLOO_TRANSPORT=rest` with `QLOO_API_KEY` uses the direct REST client (`src/qloo.js`) instead; `QLOO_BASE`, `PORT`.

## Use it from an agent (MCP tool)

**Remote, nothing to install:** the live demo also speaks MCP at `https://taste-overlap.onrender.com/mcp` (streamable HTTP, JSON answers). In claude.ai or the Claude app: *Settings → Connectors → Add custom connector* and paste that URL. Tool calls share the demo's per-visitor and daily limits.

**Local (stdio):**

Taste Overlap is also an agent tool: `mcp-server.js` is a dependency-free MCP stdio server with one tool, `plan_shared_evening` (`city`, `person_a[]`, `person_b[]`). It returns the explained evening as text plus structured content, and any MCP client can call it:

```bash
claude mcp add taste-overlap -- node /path/to/taste-overlap/mcp-server.js   # Claude Code
# or in claude_desktop_config.json / Cursor: {"command": "node", "args": ["/path/to/mcp-server.js"],
#   "env": {"QLOO_API_KEY": "...", "QLOO_BASE_URL": "https://hackathon.api.qloo.com", "QLOO_TRUSTED_BASE_URL": "https://hackathon.api.qloo.com"}}
```

Without a key, `QLOO_TRANSPORT=demo` makes the tool answer the recorded Vienna example.

## Test

```bash
node --test
```

## How it works

- `src/mcp.js` (default transport) - one long-running `qloo mcp` process (the harness's canonical MCP adapter) serves every workflow as `qloo_<op>`; on a small host this takes ~0.5-1.2 s per call instead of >30 s for a fresh `qloo exec`. `QLOO_TRANSPORT=exec` switches back to one `qloo exec` per call.
- `src/harness.js` - the Qloo workflows: `recommend` (`target_type: place`, the favourites as `signals`, `filter_location`: the city) for A, B and both; `entity_tags` for the tags that explain each pick. The harness resolves the names and validates input before calling Qloo; when a name is ambiguous (`status: needs_input`) the client takes Qloo's top-ranked non-album candidate, retries once with its entity id and returns that choice. Workflow names are fixed, user text goes in on stdin.
- Each pick's reason comes from Qloo's per-result `explainability` (`signal.interests.entities`): which favourites drove the place and by how much.
- `src/demo.js` - records and replays real harness envelopes for the credential-free demo.
- `src/qloo.js` (fallback) - resolves each favourite with `/search`, ranks places with `/v2/insights` (`filter.type=urn:entity:place`, `signal.interests.entities`, `filter.location.query`). The key is sent as a header from the server and never reaches the browser.
- `src/overlap.js` - pure logic: shared picks, reasons, evening order (unit-tested). Qloo returns at most 20 places per call, and two tastes can share none of them (measured: Berlin, Daft Punk + Christopher Nolan vs Adele + Pixar). Real overlaps come first; the rest is topped up from the joint list and labelled "combined taste". A place scored one-sided in both personal lists never comes back that way.
- `src/plan.js` - three Qloo calls (A, B, both) -> overlap -> explained plan.
- `server.js` - dependency-free Node server, serves `public/` and `POST /api/plan`.
- `mcp-server.js` - the same plan as an MCP tool for agents; `src/transport.js` picks the Qloo transport for both.

## License

MIT
