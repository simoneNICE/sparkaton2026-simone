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
  { id: "gemma-3-4b",  displayName: "Gemma 3 4B",  provider: "google", tier: 1, inputCostPer1M: 0.02, outputCostPer1M: 0.04, capabilities: { code: 0.28, reasoning: 0.32, math: 0.30, general: 0.42 } },
  { id: "gemma-3-12b", displayName: "Gemma 3 12B", provider: "google", tier: 1, inputCostPer1M: 0.05, outputCostPer1M: 0.10, capabilities: { code: 0.44, reasoning: 0.48, math: 0.46, general: 0.54 } },
  { id: "gemma-3-27b", displayName: "Gemma 3 27B", provider: "google", tier: 2, inputCostPer1M: 0.10, outputCostPer1M: 0.20, capabilities: { code: 0.58, reasoning: 0.62, math: 0.58, general: 0.68 } },

  // --- OpenAI (GPT-OSS, open weights) — code specialist ---
  { id: "gpt-oss-20b",  displayName: "GPT-OSS 20B",  provider: "openai", tier: 1, inputCostPer1M: 0.05, outputCostPer1M: 0.20, capabilities: { code: 0.70, reasoning: 0.64, math: 0.62, general: 0.62 } },
  { id: "gpt-oss-120b", displayName: "GPT-OSS 120B", provider: "openai", tier: 2, inputCostPer1M: 0.15, outputCostPer1M: 0.60, capabilities: { code: 0.86, reasoning: 0.84, math: 0.82, general: 0.82 } },

  // --- Alibaba (Qwen) — math / reasoning specialist ---
  { id: "qwen3-32b",      displayName: "Qwen3 32B",      provider: "alibaba", tier: 1, inputCostPer1M: 0.10, outputCostPer1M: 0.30, capabilities: { code: 0.66, reasoning: 0.68, math: 0.72, general: 0.62 } },
  { id: "qwen3-next-80b", displayName: "Qwen3 Next 80B", provider: "alibaba", tier: 2, inputCostPer1M: 0.14, outputCostPer1M: 0.42, capabilities: { code: 0.82, reasoning: 0.82, math: 0.82, general: 0.80 } },
  { id: "qwen3-235b",     displayName: "Qwen3 235B",     provider: "alibaba", tier: 2, inputCostPer1M: 0.20, outputCostPer1M: 0.60, capabilities: { code: 0.85, reasoning: 0.86, math: 0.90, general: 0.85 } },
];

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
  multiStep: number;
  length: number;
  criticalDomain: number;
  creativity: number;
}

export const WEIGHTS: ScoringWeights = {
  code: 30,
  reasoning: 26,
  math: 22,
  multiStep: 15,
  length: 10,
  criticalDomain: 24, // high-stakes domains must not fall to the cheap tier
  creativity: -12,
};

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
// picks the CHEAPEST model in the whole catalog that clears this bar, so cost
// is favored and stronger (pricier) models are used only when the task needs
// them. Easy tasks get a low floor (cheap models qualify); hard tasks a higher
// one. Capped at 0.92 so that a cheap-but-strong open model can still clear it —
// the top proprietary models stay reserved for the premium (approval) path.
// The adjustedScore already carries the Cost/Balanced/Quality lean (via the
// quality bias), so this single curve serves all three modes:
//   score 0 -> 0.40   score 50 -> 0.66   score 100 -> 0.92
// The low base (0.40) lets Cost mode reach the very cheapest models on easy
// tasks; the 0.92 cap lets Quality mode require a top model on hard ones.
export function affinityFloorFromScore(score: number): number {
  const clamped = Math.max(0, Math.min(100, score));
  return Math.round((0.4 + clamped * 0.0052) * 100) / 100;
}

// A premium upgrade is only surfaced (as an approval-gated option) when the
// strongest model on the skill is at least this much more capable than the
// cheapest good-enough pick — otherwise the auto pick is already near-best.
export const PREMIUM_MIN_CAP_GAIN = 0.04;

// And only when it costs at least this much more, so the "worth it?" decision is
// real. A small premium that's barely pricier is just auto-taken.
export const PREMIUM_MIN_COST_RATIO = 1.15;

// Rough token estimate: ~4 chars per token.
export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}
