import { MODEL_CATALOG, qualityBiasFromPref, tierForScore } from "./config";
import { assessComplexity } from "./scoring";
import { computeCost, getNiceDefault, selectModel } from "./router";
import type { CostBreakdown, ModelCostEstimate, Provider, RouteResult } from "./types";

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

  // Savings of any cost vs the NICE Default. Positive = cheaper than the Default.
  // Single source of truth so the UI never re-derives this arithmetic.
  const vsDefaultOf = (cost: CostBreakdown) => {
    const absolute = defaultCost.totalCost - cost.totalCost;
    const percent = defaultCost.totalCost > 0 ? (absolute / defaultCost.totalCost) * 100 : 0;
    return { absolute, percent };
  };

  const savingsVsDefault = vsDefaultOf(selectedCost);

  // Full catalog priced for this request (for the comparison table).
  const catalog: ModelCostEstimate[] = MODEL_CATALOG.map((m) => {
    const cost = computeCost(m, inTok, outTok);
    return {
      model: m,
      cost,
      isSelected: m.id === selectedModel.id,
      isNiceDefault: m.id === niceDefaultModel.id,
      vsDefault: vsDefaultOf(cost),
    };
  }).sort((a, b) => a.cost.totalCost - b.cost.totalCost);

  return {
    assessment,
    qualityBias,
    adjustedScore,
    effectiveTier,
    selected: { model: selectedModel, cost: selectedCost, isSelected: true, isNiceDefault: selectedModel.id === niceDefaultModel.id, vsDefault: savingsVsDefault },
    niceDefault: { model: niceDefaultModel, cost: defaultCost, isSelected: selectedModel.id === niceDefaultModel.id, isNiceDefault: true, vsDefault: vsDefaultOf(defaultCost) },
    savingsVsDefault,
    catalog,
  };
}
