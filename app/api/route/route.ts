import { NextResponse } from "next/server";
import { route } from "@/lib/orchestrate";
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

    const result = route({ prompt, providerPref, qualityPref });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 },
    );
  }
}
