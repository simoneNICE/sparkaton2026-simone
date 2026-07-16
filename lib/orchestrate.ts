import {
  MODEL_CATALOG,
  affinityFloorFromScore,
  qualityBiasFromPref,
} from "./config";
import { assessComplexity } from "./scoring";
import { computeCost, dominantSkill, getNiceDefault, selectByValue } from "./router";
import { tryRecall } from "./recall";
import type {
  ComplexityAssessment,
  CostBreakdown,
  ModelCostEstimate,
  ModelSpec,
  Provider,
  RouteResult,
  Skill,
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
// breakdowns, catalog comparison, quality-vs-default, and premium-upgrade
// figures. Used by both the metadata-based path and the recall (cache-hit)
// path so the two never diverge on how the numbers are computed.
function buildResult(
  assessment: ComplexityAssessment,
  selectedModel: ModelSpec,
  skill: Skill,
  qualityBias: number,
  adjustedScore: number,
  niceDefaultModel: ModelSpec,
  affinityFloor: number,
  premiumModel: ModelSpec | null,
): Omit<RouteResult, "source" | "recall"> {
  const { estInputTokens: inTok, estOutputTokens: outTok } = assessment;
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
  // null for the recall path — a recalled decision isn't chosen by affinity
  // floor, so there's no "next tier up" to offer.
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

// Pure metadata-based routing decision — no LLM call, no cache lookup.
// Value-based (cost-first): the task's complexity sets an affinity floor on
// its dominant skill, and the router picks the CHEAPEST model in the whole
// catalog that clears it. Stronger, pricier models are offered only as an
// approval-gated premium upgrade — never taken automatically.
export function route(options: RouteOptions): RouteResult {
  const { prompt, providerPref = "any", qualityPref = 50, standardId } = options;
  const assessment = assessComplexity(prompt);

  // Apply the quality/cost slider as a bias on the complexity score.
  const qualityBias = qualityBiasFromPref(qualityPref);
  const adjustedScore = Math.max(0, Math.min(100, assessment.score + qualityBias));

  // Baseline = the chosen NICE standard, falling back to the configured default.
  const niceDefaultModel =
    MODEL_CATALOG.find((m) => m.id === standardId) ?? getNiceDefault();

  const skill = dominantSkill(assessment);
  const affinityFloor = affinityFloorFromScore(adjustedScore);
  const { selected: selectedModel, premium: premiumModel } = selectByValue(
    assessment.estInputTokens,
    assessment.estOutputTokens,
    skill,
    affinityFloor,
    providerPref,
  );

  return {
    ...buildResult(assessment, selectedModel, skill, qualityBias, adjustedScore, niceDefaultModel, affinityFloor, premiumModel),
    source: "metadata",
  };
}

// Same as route(), but first checks the "Learned" recall cache (lib/recall.ts)
// for a previously-seen, similar-enough prompt. On a cache hit the stored
// model is returned immediately, skipping the value-based selector entirely
// (the complexity assessment is still computed, but only for display — cost
// estimate, gauge, catalog comparison). No affinity floor or premium upgrade
// applies to a recalled decision, since it wasn't chosen by score. On a miss,
// or when recall is disabled, falls through to the ordinary route().
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
        ...buildResult(assessment, hit.model, skill, 0, assessment.score, niceDefaultModel, 0, null),
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
