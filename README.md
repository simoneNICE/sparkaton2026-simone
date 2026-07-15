# Metadata-Based Model Router — POC

A proof-of-concept that decides **which LLM to use _before_ calling it**, choosing
the cheapest model capable of a good answer based on features extracted from the
prompt. Fully deterministic, no AI call, no cost.

> Baseline is the **NICE Default (Sonnet)** — the model NICE would use by default
> for everything. Easy prompts are **downgraded** to a cheaper model to save cost;
> hard prompts stay on the Default or **escalate** to a premium model (Opus).

## How it works

```
prompt ──▶ feature extraction ──▶ complexity score (0..100)
                                        │
                        quality/cost slider bias (±35)
                                        │
                                   adjusted score ──▶ tier ──▶ model
```

- **Tier 1 · Economy** → cheapest model (GPT-mini / Haiku)
- **Tier 2 · Standard** → **NICE Default (Sonnet)** — pinned
- **Tier 3 · Premium** → Opus (only the hardest prompts)

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
lib/
  config.ts           model catalog, weights, thresholds, quality-bias
  scoring.ts          feature extraction + complexity score
  router.ts           tier -> model selection + cost
  orchestrate.ts      end-to-end routing decision (no LLM call)
  types.ts            shared types
```

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
