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
    // "recall" is the id of the "Learned" routing algorithm toggle in the UI.
    const useRecall: boolean = Array.isArray(body.algos) && body.algos.includes("recall");

    const result = await routeWithRecall({ prompt, providerPref, qualityPref, standardId, useRecall });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 },
    );
  }
}
