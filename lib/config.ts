import type { ModelSpec, Tier } from "./types";

// ---------------------------------------------------------------------------
// Model catalog — mock prices, realistic order of magnitude (USD / 1M tokens).
// Swap these for real numbers when wiring live APIs.
// ---------------------------------------------------------------------------
export const MODEL_CATALOG: ModelSpec[] = [
  { id: "gpt-mini",   displayName: "GPT-mini",           provider: "openai",    tier: 1, inputCostPer1M: 0.15, outputCostPer1M: 0.6 },
  { id: "haiku-4.5",  displayName: "Haiku 4.5",          provider: "anthropic", tier: 1, inputCostPer1M: 1.0,  outputCostPer1M: 5.0 },
  { id: "gpt-full",   displayName: "GPT full",           provider: "openai",    tier: 2, inputCostPer1M: 2.5,  outputCostPer1M: 10.0 },
  { id: "sonnet",     displayName: "NICE Default (Sonnet)", provider: "anthropic", tier: 2, inputCostPer1M: 3.0,  outputCostPer1M: 15.0 },
  { id: "opus-4.8",   displayName: "Opus 4.8",           provider: "anthropic", tier: 3, inputCostPer1M: 15.0, outputCostPer1M: 75.0 },
];

// The standard model NICE would use by default for everything.
// This is BOTH the pinned choice for complex prompts AND the savings baseline.
export const NICE_DEFAULT_ID = "sonnet";

// The premium model, used only for the hardest prompts (top tier).
export const PREMIUM_ID = "opus-4.8";

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
//   Tier 1 = economy (cheapest)      -> easy prompts
//   Tier 2 = NICE Default (Sonnet)   -> complex prompts
//   Tier 3 = premium (Opus)          -> hardest prompts
// ---------------------------------------------------------------------------
export const THRESHOLDS: { maxScore: number; tier: Tier }[] = [
  { maxScore: 35, tier: 1 },
  { maxScore: 72, tier: 2 },
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

// Rough token estimate: ~4 chars per token.
export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}
