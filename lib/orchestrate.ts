import {
  MODEL_CATALOG,
  affinityFloorFromScore,
  qualityBiasFromPref,
} from "./config";
import { assessComplexity } from "./scoring";
import { computeCost, dominantSkill, getNiceDefault, selectByValue } from "./router";
import type { CostBreakdown, ModelCostEstimate, Provider, RouteResult } from "./types";

export interface RouteOptions {
  prompt: string;
  providerPref?: Provider | "any";
  qualityPref?: number; // 0 = max cost saving, 50 = neutral, 100 = max quality
  // The NICE standard: the model NICE would use by default, i.e. the savings
  // baseline every routed choice is compared against. Defaults to NICE_DEFAULT_ID.
  standardId?: string;
}

// Pure routing decision — no LLM call. Deterministic, zero cost.
export function route({
  prompt,
  providerPref = "any",
  qualityPref = 50,
  standardId,
}: RouteOptions): RouteResult {
  const assessment = assessComplexity(prompt);
  const { estInputTokens: inTok, estOutputTokens: outTok } = assessment;

  // Apply the quality/cost slider as a bias on the complexity score.
  const qualityBias = qualityBiasFromPref(qualityPref);
  const adjustedScore = Math.max(0, Math.min(100, assessment.score + qualityBias));

  // Baseline = the chosen NICE standard, falling back to the configured default.
  const niceDefaultModel =
    MODEL_CATALOG.find((m) => m.id === standardId) ?? getNiceDefault();

  // Value-based routing (cost-first): the task's complexity sets an affinity
  // floor on its dominant skill, and the router picks the CHEAPEST model in the
  // whole catalog that clears it. Stronger, pricier models are offered only as
  // an approval-gated premium upgrade — never taken automatically.
  const skill = dominantSkill(assessment);
  const affinityFloor = affinityFloorFromScore(adjustedScore);
  const { selected: selectedModel, premium: premiumModel } = selectByValue(
    inTok,
    outTok,
    skill,
    affinityFloor,
    providerPref,
  );
  // Tier is now just a display label for the chosen model, not a routing gate.
  const effectiveTier = selectedModel.tier;

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

  // Quality delta vs the baseline on the prompt's dominant skill. Capabilities
  // live on a 0..1 scale, so the raw delta is tiny (hundredths). We also express
  // it as a *relative* percentage, which reads as a meaningful figure in the UI.
  const selectedCap = selectedModel.capabilities[skill];
  const defaultCap = niceDefaultModel.capabilities[skill];
  const qualityVsDefault = {
    skill,
    selectedCap,
    defaultCap,
    delta: Math.round((selectedCap - defaultCap) * 100) / 100,
    relativePercent:
      defaultCap > 0 ? Math.round(((selectedCap - defaultCap) / defaultCap) * 1000) / 10 : 0,
    retainedPercent: defaultCap > 0 ? Math.round((selectedCap / defaultCap) * 1000) / 10 : 100,
  };

  // Approval-gated premium upgrade, priced and quantified vs the auto pick.
  const premiumOption = premiumModel
    ? (() => {
        const cost = computeCost(premiumModel, inTok, outTok);
        const premCap = premiumModel.capabilities[skill];
        return {
          model: premiumModel,
          cost,
          capDelta: Math.round((premCap - selectedCap) * 100) / 100,
          qualityRelPercent:
            selectedCap > 0 ? Math.round(((premCap - selectedCap) / selectedCap) * 1000) / 10 : 0,
          costPercent:
            selectedCost.totalCost > 0
              ? Math.round(((cost.totalCost - selectedCost.totalCost) / selectedCost.totalCost) * 1000) / 10
              : 0,
        };
      })()
    : null;

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
    dominantSkill: skill,
    selected: { model: selectedModel, cost: selectedCost, isSelected: true, isNiceDefault: selectedModel.id === niceDefaultModel.id, vsDefault: savingsVsDefault },
    niceDefault: { model: niceDefaultModel, cost: defaultCost, isSelected: selectedModel.id === niceDefaultModel.id, isNiceDefault: true, vsDefault: vsDefaultOf(defaultCost) },
    savingsVsDefault,
    qualityVsDefault,
    affinityFloor,
    premiumOption,
    catalog,
  };
}
