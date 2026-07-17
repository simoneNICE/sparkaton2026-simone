import { NextResponse } from "next/server";
import { invokeBedrock, isBedrockSupported } from "@/lib/bedrock";

// Real model answers are I/O bound (two Bedrock calls) — Node runtime, and a
// longer timeout since a big model can take a while.
export const runtime = "nodejs";
export const maxDuration = 60;

export interface OneAnswer {
  modelId: string;
  text?: string;
  usage?: { inputTokens: number; outputTokens: number; totalTokens: number };
  latencyMs?: number;
  bedrockModelId?: string;
  stopReason?: string;
  error?: string;
}

// Output-token budget for the real comparison call. Generous on purpose:
// "reasoning" models (e.g. GPT-OSS) spend a large chunk of their output on an
// internal chain-of-thought before the final answer — with a tight cap they hit
// the token limit mid-reasoning and return NO answer text at all. maxTokens is a
// ceiling, not a target, so non-reasoning models still stop early at end_turn
// and this doesn't inflate their cost.
const ANSWER_MAX_TOKENS = 4096;

// Run a single model, converting any failure into an error field instead of
// throwing — so one model being unavailable never blanks out the other column.
async function runOne(modelId: string, prompt: string): Promise<OneAnswer> {
  if (!isBedrockSupported(modelId)) {
    return { modelId, error: `Model "${modelId}" is not mapped to Bedrock` };
  }
  try {
    const r = await invokeBedrock({ modelId, prompt, maxTokens: ANSWER_MAX_TOKENS });

    // A real (paid) call that comes back with no answer text used to render as
    // "Not run yet." — indistinguishable from never having run. Surface WHY:
    // usually a reasoning model that exhausted the token budget before the
    // final answer (stopReason "max_tokens"), sometimes an empty completion.
    let error: string | undefined;
    if (!r.text) {
      if (r.stopReason === "max_tokens") {
        error =
          `No answer returned: hit the ${ANSWER_MAX_TOKENS}-token output limit` +
          (r.reasoningText ? " while still reasoning" : "") +
          ". This is a reasoning model — try a shorter prompt or a higher budget.";
      } else if (r.reasoningText) {
        error = "Model returned reasoning but no final answer.";
      } else {
        error = "Model returned an empty response.";
      }
    }

    return {
      modelId,
      text: r.text,
      usage: r.usage,
      latencyMs: r.latencyMs,
      bedrockModelId: r.bedrockModelId,
      stopReason: r.stopReason,
      error,
    };
  } catch (e) {
    const name = e instanceof Error ? e.name : "Error";
    const message = e instanceof Error ? e.message : "Unknown error";
    return { modelId, error: `${name}: ${message}` };
  }
}

// POST /api/answer
// body: { prompt, selectedModelId, defaultModelId }
// Runs the routed model and the NICE Default side by side for comparison.
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const prompt = typeof body.prompt === "string" ? body.prompt : "";
    const selectedModelId =
      typeof body.selectedModelId === "string" ? body.selectedModelId : "";
    const defaultModelId =
      typeof body.defaultModelId === "string" ? body.defaultModelId : "";

    if (!prompt.trim()) {
      return NextResponse.json({ error: "Empty prompt" }, { status: 400 });
    }
    if (!selectedModelId || !defaultModelId) {
      return NextResponse.json(
        { error: "Missing selectedModelId or defaultModelId" },
        { status: 400 },
      );
    }

    // When the router lands on the NICE Default, both ids match — run once and
    // reuse, so the demo doesn't pay for two identical calls.
    if (selectedModelId === defaultModelId) {
      const same = await runOne(selectedModelId, prompt);
      return NextResponse.json({ selected: same, niceDefault: same });
    }

    const [selected, niceDefault] = await Promise.all([
      runOne(selectedModelId, prompt),
      runOne(defaultModelId, prompt),
    ]);
    return NextResponse.json({ selected, niceDefault });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 },
    );
  }
}
