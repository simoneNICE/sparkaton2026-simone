import { MODEL_CATALOG, NICE_DEFAULT_ID } from "./config";
import type {
  ComplexityAssessment,
  CostBreakdown,
  ModelSpec,
  Provider,
  Skill,
  Tier,
} from "./types";

export function computeCost(
  model: ModelSpec,
  inputTokens: number,
  outputTokens: number,
): CostBreakdown {
  const inputCost = (inputTokens / 1_000_000) * model.inputCostPer1M;
  const outputCost = (outputTokens / 1_000_000) * model.outputCostPer1M;
  return {
    inputTokens,
    outputTokens,
    inputCost,
    outputCost,
    totalCost: inputCost + outputCost,
  };
}

function byId(id: string): ModelSpec {
  const m = MODEL_CATALOG.find((x) => x.id === id);
  if (!m) throw new Error(`Model ${id} not in catalog`);
  return m;
}

export const getNiceDefault = (): ModelSpec => byId(NICE_DEFAULT_ID);

// The top capability tier in the catalog — reached only by high quality-risk
// prompts (very complex or high-stakes domains).
const TOP_TIER: Tier = Math.max(...MODEL_CATALOG.map((m) => m.tier)) as Tier;

// The prompt's dominant hard skill, used to pick a specialist within a tier.
// Falls back to "general" when no code/reasoning/math signal is strong enough,
// so easy and broad-language prompts route to a solid all-rounder rather than a
// specialist. The threshold keeps keyword noise from masquerading as a skill.
export function dominantSkill(assessment: ComplexityAssessment): Skill {
  const pointsFor = (key: string) =>
    assessment.contributions.find((c) => c.key === key)?.points ?? 0;
  const skills: Skill[] = ["code", "reasoning", "math"];
  const ranked = skills
    .map((skill) => ({ skill, points: pointsFor(skill) }))
    .sort((a, b) => b.points - a.points);
  return ranked[0].points >= 5 ? ranked[0].skill : "general";
}

// Tier + dominant skill -> concrete model, honoring the provider preference.
//   • lower tiers -> best value: the cheapest model whose capability on the
//     dominant skill is within `tolerance` of the strongest model at this tier.
//     A cheaper specialist wins when it's "good enough"; when only the strongest
//     model clears the bar (e.g. the Sonnet standard on a broad task), that one
//     is chosen even at zero saving — quality is not sacrificed to save cost.
//   • top tier -> quality-first: the most capable model on the dominant skill,
//     regardless of cost, because a prompt only reaches it when it is risky.
export function selectModel(
  tier: Tier,
  inputTokens: number,
  outputTokens: number,
  skill: Skill,
  tolerance: number,
  providerPref?: Provider | "any",
): ModelSpec {
  let pool = MODEL_CATALOG.filter((m) => m.tier === tier);
  if (providerPref && providerPref !== "any") {
    const narrowed = pool.filter((m) => m.provider === providerPref);
    if (narrowed.length) pool = narrowed;
  }
  // Safety net: no model at this tier (shouldn't happen with the catalog above).
  if (!pool.length) return getNiceDefault();

  const cap = (m: ModelSpec) => m.capabilities[skill];
  const price = (m: ModelSpec) => computeCost(m, inputTokens, outputTokens).totalCost;

  if (tier >= TOP_TIER) {
    // Quality-first: best on the needed skill, tie-broken by most capable overall.
    return [...pool].sort((a, b) => cap(b) - cap(a) || price(b) - price(a))[0];
  }

  // Best value: among models within `tolerance` of the best skill capability,
  // pick the cheapest. The bar keeps quality up; the price sort captures savings.
  const bestCap = Math.max(...pool.map(cap));
  const qualified = pool.filter((m) => cap(m) >= bestCap - tolerance);
  return [...qualified].sort((a, b) => price(a) - price(b) || cap(b) - cap(a))[0];
}
