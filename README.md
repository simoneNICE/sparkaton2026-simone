# Metadata-Based Model Router — POC

A proof-of-concept that decides **which LLM to use _before_ calling it**, choosing
the cheapest model capable of a good answer based on features extracted from the
prompt. Fully deterministic, no AI call, no cost.

> Baseline is the **NICE Default (Claude 4.5 Sonnet)** — the model NICE would use
> by default for everything. Every routed choice is the **cheapest capable model
> within the required tier**, compared for savings against that baseline. Easy
> prompts are downgraded to a cheap open model; hard prompts stay on a top-tier
> model (and can still beat the Default on cost).

## How it works

```
prompt ──▶ feature extraction ──▶ complexity score (0..100)
                                        │
                        quality/cost slider bias (±35)
                                        │
                                   adjusted score ──▶ tier ──▶ model
```

For each tier the router picks the **cheapest model in that tier**, honoring the
provider preference. Catalog: Claude (4.5 Haiku / 4.5 Sonnet / 4.6 Sonnet),
Amazon Nova (Micro / Lite / 2 Lite / Pro / Premier), Google Gemma 3 (4B / 12B /
27B), OpenAI GPT-OSS (20B / 120B), and Alibaba Qwen3 (32B / Next 80B / 235B).

- **Tier 1 · Economy** → cheapest capable model for easy prompts (e.g. Gemma 3 4B, Nova Micro)
- **Tier 2 · Standard** → cheapest mid-capability model (e.g. Gemma 3 27B, Nova Pro, Qwen3)
- **Tier 3 · Premium** → cheapest top-capability model for the hardest prompts (e.g. Nova Premier, Claude 4.6 Sonnet)

The scoring engine is transparent and explainable: every dimension (code,
reasoning, math, multi-step, length, high-stakes domain, creativity) reports its
signal, weight, points, and the evidence that triggered it.

## Features

- Deterministic complexity scoring with per-dimension explainability
- Quality ↔ cost slider that re-routes live
- Cost comparison table across all models for the current prompt
- Savings quantified vs the NICE Default
- Provider preference (Anthropic / OpenAI / cheapest)

## Roadmap

- [ ] **Real answers via the local Claude CLI** (optional toggle — "coming soon"
      in the UI): run the selected model _and_ the NICE Default side by side to
      verify the cheap choice was good enough.
- [ ] Configurable weights/thresholds from the UI
- [ ] Optional small-LLM "judge" scorer as an alternative to the heuristic engine

## Getting started

```bash
npm install
npm run dev
# open http://localhost:3000
```

## Project structure

```
app/
  page.tsx            UI (input, slider, decision, comparison table, breakdown)
  api/route/route.ts  routing endpoint
  api/match/route.ts  standalone fuzzy-matcher endpoint (GET /api/match?query=...)
lib/
  config.ts           model catalog, weights, thresholds, quality-bias
  scoring.ts          feature extraction + complexity score
  router.ts           tier -> model selection + cost
  orchestrate.ts      end-to-end routing decision (no LLM call)
  matcher.ts          deterministic fuzzy prompt matcher (no AI) — the "Learned" engine
  matcher-db.json     stored prompt -> associated model database
  recall.ts           "Learned" recall routing — in-process wrapper over matcher.ts
  types.ts            shared types
```

## "Learned" routing (recall)

The **Learned** routing algorithm ([`lib/matcher.ts`](lib/matcher.ts)) matches a
prompt against a stored database of previously-routed prompts
([`lib/matcher-db.json`](lib/matcher-db.json)) using **classical, deterministic
string-similarity** only — Levenshtein + token-overlap + trigram-cosine +
sequence ratio, weighted `0.35 / 0.30 / 0.25 / 0.10`. No embeddings, no vector
search, no LLM. On a confident match (score ≥ 0.75) it returns the
`associated_model` stored next to that prompt **verbatim** — nothing is
generated. This is a TypeScript port of a former standalone Python/Flask
service, now running **in-process** (no external service, no network hop).

- In routing: enable the "Learned" checkbox; [`lib/recall.ts`](lib/recall.ts)
  checks the matcher before falling back to the metadata scorer.
- Standalone: `GET /api/match?query=...` (add `&debug=1` for the component
  breakdown) returns the same JSON shape the old Flask service did.

## Configuration

All tunable knobs live in [`lib/config.ts`](lib/config.ts): the model catalog and
prices, the scoring `WEIGHTS`, the score→tier `THRESHOLDS`, and which model is the
`NICE_DEFAULT_ID`. Prices are mock but realistic in order of magnitude — swap them
for real numbers when wiring live APIs.

## Status

Mock/routing-only. No LLM calls are made yet. The routing decision, cost estimates,
and savings figures are all real; the actual model answers are the next milestone.

---

Built with Next.js (App Router) + TypeScript.
