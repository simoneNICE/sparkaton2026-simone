import { MODEL_CATALOG, NICE_DEFAULT_ID, PREMIUM_ID } from "./config";
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
export const getPremium = (): ModelSpec => byId(PREMIUM_ID);

// Tier -> concrete model.
//   Tier 1: cheapest economy model (provider preference respected).
//   Tier 2: the NICE Default (Sonnet) — pinned, this is the "standard".
//   Tier 3: the premium model (Opus).
export function selectModel(
  tier: Tier,
  inputTokens: number,
  outputTokens: number,
  providerPref?: Provider | "any",
): ModelSpec {
  if (tier === 3) return getPremium();
  if (tier === 2) return getNiceDefault();

  // Tier 1 — economy: cheapest tier-1 model, honoring provider preference.
  let pool = MODEL_CATALOG.filter((m) => m.tier === 1);
  if (providerPref && providerPref !== "any") {
    const narrowed = pool.filter((m) => m.provider === providerPref);
    if (narrowed.length) pool = narrowed;
  }
  return pool
    .map((m) => ({ m, cost: computeCost(m, inputTokens, outputTokens).totalCost }))
    .sort((a, b) => a.cost - b.cost)[0].m;
}
