import {
  MODEL_CATALOG,
  capabilityToleranceFromPref,
  qualityBiasFromPref,
  tierForScore,
} from "./config";
import { assessComplexity } from "./scoring";
import { computeCost, dominantSkill, getNiceDefault, selectModel } from "./router";
import { tryRecall } from "./recall";
import type {
  ComplexityAssessment,
  CostBreakdown,
  ModelCostEstimate,
  ModelSpec,
  Provider,
  RouteResult,
  Skill,
  Tier,
} from "./types";

export interface RouteOptions {
  prompt: string;
  providerPref?: Provider | "any";
  qualityPref?: number; // 0 = max cost saving, 50 = neutral, 100 = max quality
  // The NICE standard: the model NICE would use by default, i.e. the savings
  // baseline every routed choice is compared against. Defaults to NICE_DEFAULT_ID.
  standardId?: string;
}

// Shared machinery: given a chosen model + assessment, build the cost
// breakdowns, catalog comparison, and savings figures. Used by both the
// metadata-based path and the recall (cache-hit) path so the two never
// diverge on how the numbers are computed.
function buildResult(
  assessment: ComplexityAssessment,
  selectedModel: ModelSpec,
  effectiveTier: Tier,
  skill: Skill,
  qualityBias: number,
  adjustedScore: number,
  niceDefaultModel: ModelSpec,
): Omit<RouteResult, "source" | "recall"> {
  const { estInputTokens: inTok, estOutputTokens: outTok } = assessment;
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
    dominantSkill: skill,
    selected: { model: selectedModel, cost: selectedCost, isSelected: true, isNiceDefault: selectedModel.id === niceDefaultModel.id, vsDefault: savingsVsDefault },
    niceDefault: { model: niceDefaultModel, cost: defaultCost, isSelected: selectedModel.id === niceDefaultModel.id, isNiceDefault: true, vsDefault: vsDefaultOf(defaultCost) },
    savingsVsDefault,
    catalog,
  };
}

// Pure metadata-based routing decision — no LLM call, no cache lookup.
export function route(options: RouteOptions): RouteResult {
  const { prompt, providerPref = "any", qualityPref = 50, standardId } = options;
  const assessment = assessComplexity(prompt);

  // Apply the quality/cost slider as a bias on the complexity score.
  const qualityBias = qualityBiasFromPref(qualityPref);
  const adjustedScore = Math.max(0, Math.min(100, assessment.score + qualityBias));
  const effectiveTier = tierForScore(adjustedScore);

  // Baseline = the chosen NICE standard, falling back to the configured default.
  const niceDefaultModel =
    MODEL_CATALOG.find((m) => m.id === standardId) ?? getNiceDefault();

  // Pick the best-value model within the tier for the prompt's dominant skill:
  // the cheapest that stays within the slider-controlled quality tolerance of
  // the strongest. May legitimately land on the standard when it's the best fit.
  const skill = dominantSkill(assessment);
  const tolerance = capabilityToleranceFromPref(qualityPref);
  const selectedModel = selectModel(
    effectiveTier,
    assessment.estInputTokens,
    assessment.estOutputTokens,
    skill,
    tolerance,
    providerPref,
  );

  return {
    ...buildResult(assessment, selectedModel, effectiveTier, skill, qualityBias, adjustedScore, niceDefaultModel),
    source: "metadata",
  };
}

// Same as route(), but first checks the "Learned" recall cache (lib/recall.ts)
// for a previously-seen, similar-enough prompt. On a cache hit the stored
// model is returned immediately, skipping the metadata scorer's tier/model
// selection entirely (the complexity assessment is still computed, but only
// for display — cost estimate, gauge, catalog comparison). On a miss, or when
// recall is disabled, falls through to the ordinary metadata-based route().
export async function routeWithRecall(
  options: RouteOptions & { useRecall?: boolean },
): Promise<RouteResult> {
  if (options.useRecall) {
    const hit = await tryRecall(options.prompt);
    if (hit) {
      const assessment = assessComplexity(options.prompt);
      const niceDefaultModel =
        MODEL_CATALOG.find((m) => m.id === options.standardId) ?? getNiceDefault();
      const skill = dominantSkill(assessment);

      return {
        ...buildResult(assessment, hit.model, hit.model.tier, skill, 0, assessment.score, niceDefaultModel),
        source: "recall",
        recall: {
          matchedPrompt: hit.matchedPrompt,
          similarityScore: hit.similarityScore,
          matchType: hit.matchType,
        },
      };
    }
  }
  return route(options);
}
