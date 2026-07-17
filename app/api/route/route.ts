import { NextResponse } from "next/server";
import { routeWithRecall } from "@/lib/orchestrate";
import type { RouteOptions } from "@/lib/orchestrate";
import type { Provider } from "@/lib/types";
import type { ScoringWeights } from "@/lib/config";

const WEIGHT_KEYS: (keyof ScoringWeights)[] = [
  "code", "reasoning", "math", "structure", "length",
  "criticalDomain", "creativity", "simpleTask", "brevity",
];

// Dev-only tuning payload from the "Scoring & routing tuning" panel — validate
// shape defensively since it's client-controlled, but never throw (malformed
// tuning is just ignored, falling back to the default routing behaviour).
function parseTuning(raw: unknown): RouteOptions["tuning"] {
  if (!raw || typeof raw !== "object") return undefined;
  const body = raw as Record<string, unknown>;

  let weights: Partial<ScoringWeights> | undefined;
  if (body.weights && typeof body.weights === "object") {
    const w = body.weights as Record<string, unknown>;
    const parsed: Partial<ScoringWeights> = {};
    for (const key of WEIGHT_KEYS) {
      if (typeof w[key] === "number" && Number.isFinite(w[key])) {
        parsed[key] = w[key] as number;
      }
    }
    if (Object.keys(parsed).length) weights = parsed;
  }

  const affinityBase = typeof body.affinityBase === "number" && Number.isFinite(body.affinityBase) ? body.affinityBase : undefined;
  const affinitySlope = typeof body.affinitySlope === "number" && Number.isFinite(body.affinitySlope) ? body.affinitySlope : undefined;
  const qualityFirstScore = typeof body.qualityFirstScore === "number" && Number.isFinite(body.qualityFirstScore) ? body.qualityFirstScore : undefined;

  if (!weights && affinityBase === undefined && affinitySlope === undefined && qualityFirstScore === undefined) {
    return undefined;
  }
  return { weights, affinityBase, affinitySlope, qualityFirstScore };
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const prompt = typeof body.prompt === "string" ? body.prompt : "";
    if (!prompt.trim()) {
      return NextResponse.json({ error: "Empty prompt" }, { status: 400 });
    }
    const providerPref: Provider | "any" = body.providerPref ?? "any";
    const qualityPref: number = typeof body.qualityPref === "number" ? body.qualityPref : 50;
    const standardId: string | undefined =
      typeof body.standardId === "string" ? body.standardId : undefined;
    // Routing algorithm toggles from the UI: "recall" = "Learned",
    // "verdict" = "Judged" (judge-then-route), "tempo" = "Timing" (when on,
    // flex-capable models are priced at their discounted flex rate).
    const algos: string[] = Array.isArray(body.algos) ? body.algos : [];
    const useRecall: boolean = algos.includes("recall");
    const useJudge: boolean = algos.includes("verdict");
    const flex: boolean = algos.includes("tempo");
    const tuning = parseTuning(body.tuning);

    const result = await routeWithRecall({
      prompt, providerPref, qualityPref, standardId, useRecall, useJudge, flex, tuning,
    });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 },
    );
  }
}
