# Taste Overlap - Qloo Agentic Hackathon submission

## Problem

Two people plan an evening in a city. Each has different favourites: one likes Radiohead and Wes Anderson, the other Taylor Swift and Studio Ghibli. Merging both lists into one search gives places that one person loves and the other merely tolerates. What they need is the set of places that fit **both** of them, a reason for each pick, and an order for the evening.

## How Qloo is used (workflow)

All calls go through the official event surface, `qloo exec` from `@qloo/qloo-harness` 0.1.26, against `https://hackathon.api.qloo.com`.

1. `entity_tags` once per favourite. Ambiguous names come back as `status: needs_input` with ranked candidates. The client takes the top candidate, retries once with its entity id, and keeps that choice visible in the response.
2. `recommend` three times with `target_type: place`, `filter_location: <city>`, `explain: true`. The `signals` are A's entity ids, then B's, then both together.
3. A pick survives only when it scores at least 0.2 for each person. Picks are ranked by the harmonic mean of A's and B's affinity, plus 15 % weight from the joint list. The harmonic mean drops picks that only one person would enjoy.
4. Each reason is built from Qloo's per-result `explainability` (`signal.interests.entities`): which favourites drove the place, and by how much.
5. The picks are ordered into an evening: something to do, then food, then a drink.

The result depends entirely on Qloo's per-person affinities. No language model chooses or ranks a place.

## Redacted request and result (live, 16 Oct 2026)

Request (`qloo exec recommend`, stdin; the key is in the environment and never in the payload):

```json
{"target_type":"place","signals":["70CAE5BF-2F4C-445C-A3E5-4EDACFC3591C","C71B6CCE-3F05-4A57-AA84-9D2C2B4D67C5"],
 "filter_location":"Vienna","explain":true,"limit":20}
```

The two ids are Radiohead (`urn:entity:artist`) and Wes Anderson. Both were resolved from plain names via Qloo's top-ranked `needs_input` candidate. For Wes Anderson that candidate is the **author** entity (`urn:entity:author`), not his films. See Limitations.

Result (first 2 of 20; `execution.duration_ms` 5387 in the envelope; trimmed):

```json
[{"entity_id":"E5CBD5F7-B29C-48F7-A488-CE71EF9C4FDE","name":"Sigmund Freud Museum","affinity":0.854,
  "explainability":{"signal.interests.entities":[{"entity_id":"70CAE5BF-...","score":0.553},{"entity_id":"C71B6CCE-...","score":0.447}]},
  "properties":{"address":"Berggasse 19 1090 Wien Austria"}},
 {"entity_id":"344F0B64-441C-4FD1-A819-51809487325C","name":"Wien Museum Mozart apartment","affinity":0.846,
  "explainability":{"signal.interests.entities":[{"entity_id":"70CAE5BF-...","score":0.544},{"entity_id":"C71B6CCE-...","score":0.456}]},
  "properties":{"address":"Mozarthaus Domgasse 5 1010 Wien Austria"}}]
```

The full plan for A = Radiohead + Wes Anderson and B = Taylor Swift + Studio Ghibli in Vienna returns 6 shared picks:
- Wien Museum Mozart apartment
- Wiener Mozart Orchester
- Kunst Haus Wien (Museum Hundertwasser)
- Sigmund Freud Museum
- Naschmarkt
- Wein Austria

Each pick carries a reason, for example *"driven by Radiohead 29% · Taylor Swift 24% · Wes Anderson 24%; taste fit A 85% · B 77%"*.

## Demo without credentials

```bash
QLOO_TRANSPORT=demo npm start   # http://localhost:8787
```

This replays the real recorded run (`demo/vienna.json`, 11 `qloo exec` envelopes) through the same client, overlap and plan code. It contains no key. Only the recorded example works; any other input returns an explicit error instead of made-up places.

## Setup (live)

```bash
npm install --global @qloo/qloo-harness
export QLOO_API_KEY=...
export QLOO_BASE_URL=https://hackathon.api.qloo.com
export QLOO_TRUSTED_BASE_URL=https://hackathon.api.qloo.com
npm start
node --test   # 22 tests
```

## Limitations

- **Ambiguous names:** the client takes Qloo's top-ranked candidate. For example, "Wes Anderson" resolved to the author entity rather than a film. The choice is returned so a UI can let the user correct it, but this version does not offer that correction yet.
- **Places only:** the evening order is a keyword heuristic on Qloo's short description, not opening hours or distance.
- **Speed:** a full plan took 12.8 s and 14.6 s in two live runs (4 name resolutions, 4 tag lookups, 3 recommendations, each through its own `qloo exec` process).
- **Demo coverage:** the credential-free demo covers exactly one recorded example.
