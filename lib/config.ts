import type { ModelSpec, Tier } from "./types";

// ---------------------------------------------------------------------------
// Model catalog — mock prices, realistic order of magnitude (USD / 1M tokens).
// Swap these for real numbers when wiring live APIs.
// ---------------------------------------------------------------------------
export const MODEL_CATALOG: ModelSpec[] = [
  // --- Anthropic (Claude) ---
  { id: "claude-haiku-4.5",  displayName: "Claude 4.5 Haiku",  provider: "anthropic", tier: 1, inputCostPer1M: 1.0,  outputCostPer1M: 5.0 },
  { id: "claude-sonnet-4.5", displayName: "Claude 4.5 Sonnet", provider: "anthropic", tier: 2, inputCostPer1M: 3.0,  outputCostPer1M: 15.0 },
  { id: "claude-sonnet-4.6", displayName: "Claude 4.6 Sonnet", provider: "anthropic", tier: 3, inputCostPer1M: 3.75, outputCostPer1M: 18.75 },

  // --- Amazon (Nova) ---
  { id: "nova-micro",   displayName: "Nova Micro",   provider: "amazon", tier: 1, inputCostPer1M: 0.035, outputCostPer1M: 0.14 },
  { id: "nova-lite",    displayName: "Nova Lite",    provider: "amazon", tier: 1, inputCostPer1M: 0.06,  outputCostPer1M: 0.24 },
  { id: "nova-2-lite",  displayName: "Nova 2 Lite",  provider: "amazon", tier: 1, inputCostPer1M: 0.09,  outputCostPer1M: 0.36 },
  { id: "nova-pro",     displayName: "Nova Pro",     provider: "amazon", tier: 2, inputCostPer1M: 0.80,  outputCostPer1M: 3.20 },
  { id: "nova-premier", displayName: "Nova Premier", provider: "amazon", tier: 3, inputCostPer1M: 2.50,  outputCostPer1M: 12.50 },

  // --- Google (Gemma) ---
  { id: "gemma-3-4b",  displayName: "Gemma 3 4B",  provider: "google", tier: 1, inputCostPer1M: 0.02, outputCostPer1M: 0.04 },
  { id: "gemma-3-12b", displayName: "Gemma 3 12B", provider: "google", tier: 1, inputCostPer1M: 0.05, outputCostPer1M: 0.10 },
  { id: "gemma-3-27b", displayName: "Gemma 3 27B", provider: "google", tier: 2, inputCostPer1M: 0.10, outputCostPer1M: 0.20 },

  // --- OpenAI (GPT-OSS, open weights) ---
  { id: "gpt-oss-20b",  displayName: "GPT-OSS 20B",  provider: "openai", tier: 1, inputCostPer1M: 0.05, outputCostPer1M: 0.20 },
  { id: "gpt-oss-120b", displayName: "GPT-OSS 120B", provider: "openai", tier: 2, inputCostPer1M: 0.15, outputCostPer1M: 0.60 },

  // --- Alibaba (Qwen) ---
  { id: "qwen3-32b",      displayName: "Qwen3 32B",      provider: "alibaba", tier: 1, inputCostPer1M: 0.10, outputCostPer1M: 0.30 },
  { id: "qwen3-next-80b", displayName: "Qwen3 Next 80B", provider: "alibaba", tier: 2, inputCostPer1M: 0.14, outputCostPer1M: 0.42 },
  { id: "qwen3-235b",     displayName: "Qwen3 235B",     provider: "alibaba", tier: 2, inputCostPer1M: 0.20, outputCostPer1M: 0.60 },
];

// The standard model NICE would use by default for everything.
// It is the savings baseline every routed choice is compared against. The
// router does NOT pin it to any tier — tiers pick the cheapest capable model.
export const NICE_DEFAULT_ID = "claude-sonnet-4.5";

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
  { maxScore: 20, tier: 1 },
  { maxScore: 40, tier: 2 },
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
