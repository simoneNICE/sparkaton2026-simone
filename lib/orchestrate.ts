import {
  MODEL_CATALOG,
  affinityFloorFromScore,
  qualityBiasFromPref,
} from "./config";
import { assessComplexity } from "./scoring";
import { tierForScore } from "./config";
import { computeCost, dominantSkill, getNiceDefault, selectByValue } from "./router";
import { tryRecall } from "./recall";
import { judgeComplexity } from "./judge";
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
  // "Timing" enabled: price flex-capable models at their discounted flex rate.
  flex?: boolean;

  // For the "Judged" path: which cheap model scores complexity. Ignored unless
  // it's a cheap (tier-1) Bedrock-supported id; otherwise the judge default wins.
  judgeModelId?: string;
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
  flex: boolean,
): Omit<RouteResult, "source" | "recall" | "judge"> {
  const { estInputTokens: inTok, estOutputTokens: outTok } = assessment;
  const effectiveTier = selectedModel.tier;
  const selectedCost = computeCost(selectedModel, inTok, outTok, flex);
  const defaultCost = computeCost(niceDefaultModel, inTok, outTok, flex);

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
        const cost = computeCost(premiumModel, inTok, outTok, flex);
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
    const cost = computeCost(m, inTok, outTok, flex);
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

// Value-based (cost-first) routing shared by the metadata and judge paths.
// Takes an already-computed assessment (so callers can substitute the complexity
// score — the judge path swaps in an LLM score) and an optional dominant-skill
// override. The score is the ONLY routing lever here: it sets the affinity floor
// via adjustedScore; `selectByValue` is identical in both paths. When `flex` is
// set, flex-capable models are priced at their discounted flex rate.
function routeFromAssessment(
  options: RouteOptions,
  assessment: ComplexityAssessment,
  skillOverride?: Skill,
): Omit<RouteResult, "source" | "recall" | "judge"> {
  const { providerPref = "any", qualityPref = 50, standardId, flex = false } = options;

  // Apply the quality/cost slider as a bias on the complexity score.
  const qualityBias = qualityBiasFromPref(qualityPref);
  const adjustedScore = Math.max(0, Math.min(100, assessment.score + qualityBias));

  // Baseline = the chosen NICE standard, falling back to the configured default.
  const niceDefaultModel =
    MODEL_CATALOG.find((m) => m.id === standardId) ?? getNiceDefault();

  const skill = skillOverride ?? dominantSkill(assessment);
  const affinityFloor = affinityFloorFromScore(adjustedScore);
  const { selected: selectedModel, premium: premiumModel } = selectByValue(
    assessment.estInputTokens,
    assessment.estOutputTokens,
    skill,
    affinityFloor,
    providerPref,
    flex,
  );

  return buildResult(
    assessment,
    selectedModel,
    skill,
    qualityBias,
    adjustedScore,
    niceDefaultModel,
    affinityFloor,
    premiumModel,
    flex,
  );
}

export function route(options: RouteOptions): RouteResult {
  const assessment = assessComplexity(options.prompt);
  return { ...routeFromAssessment(options, assessment), source: "metadata" };
}

// Judge-then-route: a cheap LLM scores the prompt's complexity up front, that
// score is substituted for the keyword-heuristic score, and the SAME value-based
// selection runs. The judge may also redirect to the right specialist by
// returning the dominant skill. On any judge failure, degrades gracefully to the
// ordinary metadata route rather than erroring the request.
export async function routeWithJudge(options: RouteOptions): Promise<RouteResult> {
  const assessment = assessComplexity(options.prompt);
  const verdict = await judgeComplexity(options.prompt, options.judgeModelId);

  if (!verdict) {
    // Judge unavailable / failed — fall back to the transparent heuristic.
    return { ...routeFromAssessment(options, assessment), source: "metadata" };
  }

  // Substitute the judged score (and re-derive the informational rawTier from
  // it). Everything else on the assessment — token estimates, the keyword
  // contributions breakdown — is kept for display.
  const judgedAssessment: ComplexityAssessment = {
    ...assessment,
    score: verdict.score,
    rawTier: tierForScore(verdict.score),
  };

  return {
    ...routeFromAssessment(options, judgedAssessment, verdict.skill),
    source: "judge",
    judge: {
      modelId: verdict.modelId,
      modelName: verdict.modelName,
      score: verdict.score,
      skill: verdict.skill,
      rationale: verdict.rationale,
    },
  };
}

// Same as route(), but first checks the "Learned" recall cache (lib/recall.ts)
// for a previously-seen, similar-enough prompt. On a cache hit the stored
// model is returned immediately, skipping the value-based selector entirely
// (the complexity assessment is still computed, but only for display — cost
// estimate, gauge, catalog comparison). No affinity floor or premium upgrade
// applies to a recalled decision, since it wasn't chosen by score. On a miss
// (or when recall is disabled) it falls through to the judge path if enabled,
// otherwise the ordinary metadata route(). Precedence: recall → judge → metadata.
export async function routeWithRecall(
  options: RouteOptions & { useRecall?: boolean; useJudge?: boolean },
): Promise<RouteResult> {
  if (options.useRecall) {
    const hit = tryRecall(options.prompt);
    if (hit) {
      const assessment = assessComplexity(options.prompt);
      const niceDefaultModel =
        MODEL_CATALOG.find((m) => m.id === options.standardId) ?? getNiceDefault();
      const skill = dominantSkill(assessment);

      return {
        ...buildResult(assessment, hit.model, skill, 0, assessment.score, niceDefaultModel, 0, null, options.flex ?? false),
        source: "recall",
        recall: {
          matchedPrompt: hit.matchedPrompt,
          similarityScore: hit.similarityScore,
          matchType: hit.matchType,
        },
      };
    }
    // Recall miss — fall through (a judged or metadata decision below).
  }
  // Judge-then-route: one cheap LLM call scores complexity, then the value
  // selector runs on that score. Preferred over the pure heuristic when enabled.
  if (options.useJudge) return routeWithJudge(options);
  return route(options);
}
