// Core domain types for the metadata-based model router POC.

export type Provider = "anthropic" | "openai";

export type Tier = 1 | 2 | 3; // 1 = cheapest, 3 = most capable

export interface ModelSpec {
  id: string;
  displayName: string;
  provider: Provider;
  tier: Tier;
  // Price in USD per 1M tokens.
  inputCostPer1M: number;
  outputCostPer1M: number;
}

// A single scoring dimension and how much it contributed to the final score.
export interface FeatureContribution {
  key: string;
  label: string;
  // Raw normalized signal 0..1 (before weighting).
  signal: number;
  // Max points this dimension can add (negative for dampening dimensions).
  weight: number;
  // Actual points added to the score = signal * weight (clamped by sign).
  points: number;
  // Human-readable evidence for explainability.
  evidence: string;
}

export interface ComplexityAssessment {
  score: number; // 0..100
  // Tier implied by the *raw* score alone (before the quality/cost slider bias).
  // NOT the routing decision — that is RouteResult.effectiveTier. Informational only.
  rawTier: Tier;
  contributions: FeatureContribution[];
  estInputTokens: number;
  estOutputTokens: number;
}

export interface CostBreakdown {
  inputTokens: number;
  outputTokens: number;
  inputCost: number;
  outputCost: number;
  totalCost: number;
}

// A model paired with its estimated cost for this request (no LLM call made).
export interface ModelCostEstimate {
  model: ModelSpec;
  cost: CostBreakdown;
  isSelected: boolean;
  isNiceDefault: boolean;
  // Savings vs the NICE Default for this same request. Positive = cheaper than
  // the Default, negative = more expensive. Computed in lib/, not the UI.
  vsDefault: { absolute: number; percent: number };
}

export interface RouteResult {
  assessment: ComplexityAssessment;
  qualityBias: number; // from the quality/cost slider (-35..+35)
  adjustedScore: number; // raw score + quality bias, clamped 0..100
  effectiveTier: 1 | 2 | 3; // tier chosen from the adjusted score
  selected: ModelCostEstimate;
  niceDefault: ModelCostEstimate; // Sonnet — the savings baseline
  // Savings vs the NICE Default. Positive = cheaper than default (downgraded),
  // negative = premium spend for a hard prompt.
  savingsVsDefault: {
    absolute: number;
    percent: number;
  };
  // Every model's estimated cost for this request (for the comparison table).
  catalog: ModelCostEstimate[];
}
