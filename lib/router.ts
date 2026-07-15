import { MODEL_CATALOG, NICE_DEFAULT_ID } from "./config";
import type { CostBreakdown, ModelSpec, Provider, Tier } from "./types";

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

// Tier -> concrete model, within the required capability tier and honoring the
// provider preference:
//   • lower tiers  -> cheapest model (downgrade to save cost)
//   • top tier     -> most capable model (quality-first: protect quality when
//                     the prompt is risky, even if it costs more than the
//                     standard). Capability is proxied by price within the tier.
// The NICE standard is only the savings baseline — it is not pinned to a tier.
export function selectModel(
  tier: Tier,
  inputTokens: number,
  outputTokens: number,
  providerPref?: Provider | "any",
): ModelSpec {
  let pool = MODEL_CATALOG.filter((m) => m.tier === tier);
  if (providerPref && providerPref !== "any") {
    const narrowed = pool.filter((m) => m.provider === providerPref);
    if (narrowed.length) pool = narrowed;
  }
  // Safety net: no model at this tier (shouldn't happen with the catalog above).
  if (!pool.length) return getNiceDefault();

  const priced = pool
    .map((m) => ({ m, cost: computeCost(m, inputTokens, outputTokens).totalCost }))
    .sort((a, b) => a.cost - b.cost);

  // Quality-first at the top tier: pick the most capable (most expensive) model;
  // otherwise the cheapest.
  return tier >= TOP_TIER ? priced[priced.length - 1].m : priced[0].m;
}
