import { MODEL_CATALOG, qualityBiasFromPref, tierForScore } from "./config";
import { assessComplexity } from "./scoring";
import { computeCost, getNiceDefault, selectModel } from "./router";
import type { ModelCostEstimate, Provider, RouteResult } from "./types";

export interface RouteOptions {
  prompt: string;
  providerPref?: Provider | "any";
  qualityPref?: number; // 0 = max cost saving, 50 = neutral, 100 = max quality
}

// Pure routing decision — no LLM call. Deterministic, zero cost.
export function route({
  prompt,
  providerPref = "any",
  qualityPref = 50,
}: RouteOptions): RouteResult {
  const assessment = assessComplexity(prompt);
  const { estInputTokens: inTok, estOutputTokens: outTok } = assessment;

  // Apply the quality/cost slider as a bias on the complexity score.
  const qualityBias = qualityBiasFromPref(qualityPref);
  const adjustedScore = Math.max(0, Math.min(100, assessment.score + qualityBias));
  const effectiveTier = tierForScore(adjustedScore);

  const selectedModel = selectModel(effectiveTier, inTok, outTok, providerPref);
  const niceDefaultModel = getNiceDefault();

  const selectedCost = computeCost(selectedModel, inTok, outTok);
  const defaultCost = computeCost(niceDefaultModel, inTok, outTok);

  const absolute = defaultCost.totalCost - selectedCost.totalCost;
  const percent = defaultCost.totalCost > 0 ? (absolute / defaultCost.totalCost) * 100 : 0;

  // Full catalog priced for this request (for the comparison table).
  const catalog: ModelCostEstimate[] = MODEL_CATALOG.map((m) => ({
    model: m,
    cost: computeCost(m, inTok, outTok),
    isSelected: m.id === selectedModel.id,
    isNiceDefault: m.id === niceDefaultModel.id,
  })).sort((a, b) => a.cost.totalCost - b.cost.totalCost);

  return {
    assessment,
    qualityBias,
    adjustedScore,
    effectiveTier,
    selected: { model: selectedModel, cost: selectedCost, isSelected: true, isNiceDefault: selectedModel.id === niceDefaultModel.id },
    niceDefault: { model: niceDefaultModel, cost: defaultCost, isSelected: selectedModel.id === niceDefaultModel.id, isNiceDefault: true },
    savingsVsDefault: { absolute, percent },
    catalog,
  };
}
