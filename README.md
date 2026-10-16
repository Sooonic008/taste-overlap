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

## Test

```bash
node --test
```

## How it works

- `src/harness.js` (default) - Qloo workflows via `qloo exec`: `recommend` (`target_type: place`, the favourites as `signals`, `filter_location`: the city) for A, B and both; `entity_tags` for the tags that explain each pick. The harness resolves the names and validates input before calling Qloo; when a name is ambiguous (`status: needs_input`) the client takes Qloo's top-ranked candidate, retries once with its entity id and returns that choice. Workflow names are fixed, user text goes in on stdin.
- Each pick's reason comes from Qloo's per-result `explainability` (`signal.interests.entities`): which favourites drove the place and by how much.
- `src/demo.js` - records and replays real harness envelopes for the credential-free demo.
- `src/qloo.js` (fallback) - resolves each favourite with `/search`, ranks places with `/v2/insights` (`filter.type=urn:entity:place`, `signal.interests.entities`, `filter.location.query`). The key is sent as a header from the server and never reaches the browser.
- `src/overlap.js` - pure logic: shared picks, reasons, evening order (unit-tested).
- `src/plan.js` - three Qloo calls (A, B, both) -> overlap -> explained plan.
- `server.js` - dependency-free Node server, serves `public/` and `POST /api/plan`.

## License

MIT
