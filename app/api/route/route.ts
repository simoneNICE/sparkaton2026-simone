import { NextResponse } from "next/server";
import { routeWithRecall } from "@/lib/orchestrate";
import type { Provider } from "@/lib/types";

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

    const result = await routeWithRecall({
      prompt, providerPref, qualityPref, standardId, useRecall, useJudge, flex,
    });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 },
    );
  }
}
