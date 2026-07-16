import { NextResponse } from "next/server";
import {
  invokeBedrock,
  isBedrockSupported,
  supportedBedrockModelIds,
} from "@/lib/bedrock";

// Bedrock invocation is I/O bound and needs the AWS SDK -> Node runtime.
export const runtime = "nodejs";

// GET /api/bedrock -> list the catalog model ids this connector can invoke.
export async function GET() {
  return NextResponse.json({ models: supportedBedrockModelIds() });
}

// POST /api/bedrock
// body: { modelId: string, prompt: string, system?, maxTokens?, temperature?, topP? }
// Takes a request and sends it to Bedrock; returns the real answer + usage.
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const modelId = typeof body.modelId === "string" ? body.modelId : "";
    const prompt = typeof body.prompt === "string" ? body.prompt : "";

    if (!modelId.trim()) {
      return NextResponse.json({ error: "Missing modelId" }, { status: 400 });
    }
    if (!prompt.trim()) {
      return NextResponse.json({ error: "Empty prompt" }, { status: 400 });
    }
    if (!isBedrockSupported(modelId)) {
      return NextResponse.json(
        {
          error: `Model "${modelId}" is not mapped to Bedrock`,
          supported: supportedBedrockModelIds(),
        },
        { status: 400 },
      );
    }

    const result = await invokeBedrock({
      modelId,
      prompt,
      system: typeof body.system === "string" ? body.system : undefined,
      maxTokens: typeof body.maxTokens === "number" ? body.maxTokens : undefined,
      temperature:
        typeof body.temperature === "number" ? body.temperature : undefined,
      topP: typeof body.topP === "number" ? body.topP : undefined,
    });

    return NextResponse.json(result);
  } catch (e) {
    // Surface AWS SDK error name (AccessDenied, ValidationException, etc.) to
    // make credential/region/model-access issues obvious during the demo.
    const name = e instanceof Error ? e.name : "Error";
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: `${name}: ${message}` }, { status: 500 });
  }
}
