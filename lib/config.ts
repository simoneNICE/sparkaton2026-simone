import type { ModelSpec, Tier } from "./types";

// ---------------------------------------------------------------------------
// Model catalog — mock prices, realistic order of magnitude (USD / 1M tokens).
// Swap these for real numbers when wiring live APIs.
// ---------------------------------------------------------------------------
// capabilities: 0..1 skill estimates per model, so the router can pick a
// specialist within a tier (see lib/router.ts selectModel). Best-effort,
// demo-grade values reflecting each model family's real-world reputation
// (public benchmarks + known strengths); not official scores. Rough ranking:
//   general → Claude > Nova > GPT-OSS/Qwen > Gemma
//   code    → GPT-OSS & Claude lead; Qwen strong; Nova/Gemma trail
//   math    → Qwen leads its tier; Claude close; others trail
// Claude 4.5 Haiku is the strongest *small* model here — that is deliberate and
// realistic, and it is why it makes a credible cheap-but-capable NICE baseline.
export const MODEL_CATALOG: ModelSpec[] = [
  // --- Anthropic (Claude) — frontier general/coding; Haiku = best small model ---
  { id: "claude-haiku-4.5",  displayName: "Claude 4.5 Haiku",  provider: "anthropic", tier: 1, inputCostPer1M: 1.0,  outputCostPer1M: 5.0,   capabilities: { code: 0.80, reasoning: 0.78, math: 0.74, general: 0.82 } },
  { id: "claude-sonnet-4.5", displayName: "Claude 4.5 Sonnet", provider: "anthropic", tier: 2, inputCostPer1M: 3.0,  outputCostPer1M: 15.0,  capabilities: { code: 0.92, reasoning: 0.91, math: 0.87, general: 0.93 } },
  { id: "claude-sonnet-4.6", displayName: "Claude 4.6 Sonnet", provider: "anthropic", tier: 3, inputCostPer1M: 3.75, outputCostPer1M: 18.75, capabilities: { code: 0.95, reasoning: 0.94, math: 0.91, general: 0.96 } },

  // --- Amazon (Nova) — strong general/multimodal, mid code/math ---
  { id: "nova-micro",   displayName: "Nova Micro",   provider: "amazon", tier: 1, inputCostPer1M: 0.035, outputCostPer1M: 0.14,  capabilities: { code: 0.34, reasoning: 0.40, math: 0.36, general: 0.48 } },
  { id: "nova-lite",    displayName: "Nova Lite",    provider: "amazon", tier: 1, inputCostPer1M: 0.06,  outputCostPer1M: 0.24,  capabilities: { code: 0.46, reasoning: 0.52, math: 0.46, general: 0.60 } },
  { id: "nova-2-lite",  displayName: "Nova 2 Lite",  provider: "amazon", tier: 1, inputCostPer1M: 0.09,  outputCostPer1M: 0.36,  capabilities: { code: 0.52, reasoning: 0.56, math: 0.52, general: 0.66 } },
  { id: "nova-pro",     displayName: "Nova Pro",     provider: "amazon", tier: 2, inputCostPer1M: 0.80,  outputCostPer1M: 3.20,  capabilities: { code: 0.68, reasoning: 0.72, math: 0.66, general: 0.80 } },
  { id: "nova-premier", displayName: "Nova Premier", provider: "amazon", tier: 3, inputCostPer1M: 2.50,  outputCostPer1M: 12.50, capabilities: { code: 0.80, reasoning: 0.83, math: 0.80, general: 0.86 } },

  // --- Google (Gemma, open weights) — the weakest per tier; decent multilingual ---
  // flex: true — these appear on the flex-pricing list, so they get the 50%
  // "Timing" discount (see FLEX_DISCOUNT).
  // Gemma is genuinely weak on HARD reasoning/math (AA Index 10; GPQA 42%;
  // AIME 21%) but fine on everyday/general tasks — so only math/reasoning are
  // nudged down here; code/general are left as-is.
  { id: "gemma-3-4b",  displayName: "Gemma 3 4B",  provider: "google", tier: 1, inputCostPer1M: 0.02, outputCostPer1M: 0.04, flex: true, capabilities: { code: 0.28, reasoning: 0.28, math: 0.24, general: 0.42 } },
  { id: "gemma-3-12b", displayName: "Gemma 3 12B", provider: "google", tier: 1, inputCostPer1M: 0.05, outputCostPer1M: 0.10, flex: true, capabilities: { code: 0.44, reasoning: 0.44, math: 0.40, general: 0.54 } },
  { id: "gemma-3-27b", displayName: "Gemma 3 27B", provider: "google", tier: 2, inputCostPer1M: 0.10, outputCostPer1M: 0.20, flex: true, capabilities: { code: 0.55, reasoning: 0.54, math: 0.48, general: 0.68 } },

  // --- OpenAI (GPT-OSS, open weights) — code specialist ---
  // GPT-OSS 120B has elite olympiad-level math (AIME'25 91.6%) — math nudged up.
  { id: "gpt-oss-20b",  displayName: "GPT-OSS 20B",  provider: "openai", tier: 1, inputCostPer1M: 0.05, outputCostPer1M: 0.20, flex: true, capabilities: { code: 0.70, reasoning: 0.64, math: 0.62, general: 0.62 } },
  { id: "gpt-oss-120b", displayName: "GPT-OSS 120B", provider: "openai", tier: 2, inputCostPer1M: 0.15, outputCostPer1M: 0.60, flex: true, capabilities: { code: 0.86, reasoning: 0.84, math: 0.85, general: 0.82 } },

  // --- Alibaba (Qwen) — math / reasoning specialist ---
  { id: "qwen3-32b",      displayName: "Qwen3 32B",      provider: "alibaba", tier: 1, inputCostPer1M: 0.10, outputCostPer1M: 0.30, flex: true, capabilities: { code: 0.66, reasoning: 0.68, math: 0.72, general: 0.62 } },
  { id: "qwen3-next-80b", displayName: "Qwen3 Next 80B", provider: "alibaba", tier: 2, inputCostPer1M: 0.14, outputCostPer1M: 0.42, flex: true, capabilities: { code: 0.82, reasoning: 0.82, math: 0.82, general: 0.80 } },
  { id: "qwen3-235b",     displayName: "Qwen3 235B",     provider: "alibaba", tier: 2, inputCostPer1M: 0.20, outputCostPer1M: 0.60, flex: true, capabilities: { code: 0.85, reasoning: 0.86, math: 0.90, general: 0.85 } },
];

// Flex ("Timing") pricing multiplier: models with `flex: true` cost this
// fraction of their standard price when the Timing routing option is enabled —
// a 50% discount traded for latency headroom (batch/flex tier).
export const FLEX_DISCOUNT = 0.5;

// "Cheap" models = tier 1 (economy). These are the only models offered as the
// up-front complexity judge (see lib/judge.ts) — a judge must cost far less than
// the models it routes to, or the extra call defeats the savings.
export function cheapModelIds(): string[] {
  return MODEL_CATALOG.filter((m) => m.tier === 1).map((m) => m.id);
}

// The standard model NICE would use by default for everything.
// It is the savings baseline every routed choice is compared against. The
// router does NOT pin it to any tier — tiers pick the cheapest capable model.
// Claude 4.5 Haiku: a capable-but-cheap default, so the comparison shows BOTH
// real savings (easy tasks drop to even cheaper models) AND quality upgrades
// (hard tasks move to stronger models that cost more but score higher).
export const NICE_DEFAULT_ID = "claude-haiku-4.5";

// ---------------------------------------------------------------------------
// Scoring weights — max points each dimension can add to the 0..100 score.
// Negative weight = dampening dimension (lowers required capability).
// ---------------------------------------------------------------------------
export interface ScoringWeights {
  code: number;
  reasoning: number;
  math: number;
  structure: number; // multi-step / constraints (was "multiStep")
  length: number;
  criticalDomain: number;
  creativity: number; // dampener
  simpleTask: number; // dampener — mechanical/cheap tasks (translate, summarize…)
  brevity: number; // dampener — explicit short-answer requests
}

// Max points each dimension can add to the 0..100 score. Positive dimensions
// raise required capability; negative ones (dampeners) lower it. The positive
// weights deliberately sum to > 100: no single dimension can carry a prompt to
// the top, and the aggregate is clamped to 100 only at the genuinely-hard
// extreme — so the useful mid-band (20..70) keeps its resolution instead of
// everything piling up at 100.
export const WEIGHTS: ScoringWeights = {
  code: 32,
  reasoning: 28,
  math: 26,
  structure: 14,
  length: 10,
  criticalDomain: 22, // high-stakes domains must not fall to the cheap tier
  creativity: -12,
  simpleTask: -20,
  brevity: -6,
};

// The three "hard skill" dimensions (code / reasoning / math) are correlated:
// a task needing two of them is NOT twice as hard as the harder one, so summing
// them at full weight double-counts and inflates the score. To fix this while
// keeping the explainability bars additive (points still sum to the score), we
// rank the hard skills by contribution and discount the weaker ones: the
// dominant skill keeps full weight, the second gets half, the third a quarter.
export const HARD_SKILL_KEYS = ["code", "reasoning", "math"] as const;
export const HARD_SKILL_DISCOUNTS = [1, 0.5, 0.25] as const;

// ---------------------------------------------------------------------------
// Score -> tier thresholds. Applied to the *adjusted* score (raw + quality bias).
//   Tier 1 = economy (cheapest)         -> easy prompts
//   Tier 2 = NICE Default (Sonnet 4.5)  -> the broad "capable" workhorse tier
//   Tier 3 = premium (Sonnet 4.6)       -> ONLY genuinely hard prompts
// Tier 2 owns a wide band on purpose: going *above* the Sonnet 4.5 standard is
// reserved for super-complex work (score > 70), so premium spend is rare.
// ---------------------------------------------------------------------------
export const THRESHOLDS: { maxScore: number; tier: Tier }[] = [
  { maxScore: 20, tier: 1 },
  { maxScore: 70, tier: 2 },
  { maxScore: 100, tier: 3 },
];

export function tierForScore(score: number): Tier {
  for (const t of THRESHOLDS) {
    if (score <= t.maxScore) return t.tier;
  }
  return 3;
}

// Quality/cost slider -> score bias.
// pref 0   = max cost saving  -> bias -35 (route more to cheap tiers)
// pref 50  = neutral          -> bias   0
// pref 100 = max quality      -> bias +35 (route more to Default/premium)
export function qualityBiasFromPref(pref: number): number {
  const clamped = Math.max(0, Math.min(100, pref));
  return Math.round((clamped - 50) * 0.7);
}

// Quality/cost slider -> capability tolerance used within a tier. A cheaper
// model is preferred only when it is within this much (0..1 capability) of the
// best model for the prompt's dominant skill; otherwise the best is chosen even
// if it costs more (e.g. the Sonnet standard). So the slider trades savings for
// quality *within* a tier, not just across tiers.
//   pref 0   = max saving  -> 0.10 (accept clearly weaker but cheaper models)
//   pref 50  = neutral     -> 0.05
//   pref 100 = max quality -> 0.00 (always the strongest model on the skill)
export function capabilityToleranceFromPref(pref: number): number {
  const clamped = Math.max(0, Math.min(100, pref));
  return Math.round(((100 - clamped) / 1000) * 1000) / 1000;
}

// Complexity score -> minimum affinity (0..1) the task needs on its dominant
// skill. This is the quality FLOOR for value-based routing: the router then
// picks the CHEAPEST model that clears this bar, so cost is favored and pricier
// models are used only when the task needs them. Easy tasks get a low floor
// (cheap models qualify); hard tasks a high one. The curve is steep on purpose:
// near the top it climbs ABOVE the strongest open model's capability, so
// genuinely hard / Quality-lean prompts stop qualifying cheap models and are
// pushed onto a frontier model. Without this, "cheapest good-enough" almost
// always lands on a cheap open model and the strong tiers never auto-select.
// The adjustedScore already carries the Cost/Balanced/Quality lean, so one curve
// serves all three modes:
//   score 0 -> 0.35   score 50 -> 0.65   score 100 -> 0.95
export function affinityFloorFromScore(
  score: number,
  overrides?: { base?: number; slope?: number },
): number {
  const clamped = Math.max(0, Math.min(100, score));
  const base = overrides?.base ?? 0.35;
  const slope = overrides?.slope ?? 0.006;
  return Math.round((base + clamped * slope) * 100) / 100;
}

// A premium upgrade is only surfaced (as an approval-gated option) when the
// strongest model on the skill is at least this much more capable than the
// cheapest good-enough pick — otherwise the auto pick is already near-best.
export const PREMIUM_MIN_CAP_GAIN = 0.04;

// And only when it costs at least this much more, so the "worth it?" decision is
// real. A small premium that's barely pricier is just auto-taken.
export const PREMIUM_MIN_COST_RATIO = 1.15;

// At or above this adjusted score the router flips from cost-first to
// quality-first: the hardest prompts auto-select the STRONGEST model on the
// dominant skill (not merely the cheapest that clears the floor), so frontier
// models are actually used on the work that needs them — not just offered as an
// optional upgrade. Below it, the normal value-based (cost-first) logic runs.
export const QUALITY_FIRST_SCORE = 85;

// Rough token estimate: ~4 chars per token.
export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}
