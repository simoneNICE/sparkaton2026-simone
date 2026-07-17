// ---------------------------------------------------------------------------
// Bedrock connector
// ---------------------------------------------------------------------------
// A thin, provider-agnostic client over Amazon Bedrock. Takes a request
// (catalog model id + prompt) and actually invokes the model on Bedrock,
// returning the generated text plus real token usage.
//
// It uses the Bedrock **Converse API**, which gives a single unified
// request/response shape across every provider in our catalog (Anthropic,
// Amazon Nova, Google Gemma, OpenAI GPT-OSS, Alibaba Qwen) — so the router does
// not need per-provider payload code.
//
// Credentials: resolved by the AWS default provider chain. Locally that means
// env vars / shared profile; on AWS it means the instance/task/Amplify IAM
// role. Never hard-code keys.
// ---------------------------------------------------------------------------

import {
  BedrockRuntimeClient,
  ConverseCommand,
  ConverseStreamCommand,
} from "@aws-sdk/client-bedrock-runtime";

// ---------------------------------------------------------------------------
// Catalog id -> Bedrock model id mapping.
// ---------------------------------------------------------------------------
// `crossRegion: true` means the model is only invocable through a cross-region
// inference profile, i.e. the base id must be prefixed with a geo ("us", "eu",
// "apac"). We prepend BEDROCK_GEO (default "us") at resolve time. Passing the
// bare base id for these would fail with an HTTP 400 "invocation with on-demand
// throughput isn't supported" / inference-profile error.
//
// Model ids verified against the Bedrock 2026 catalog. Some open-weight ids are
// suffix-less by design (Bedrock's newer naming); that is intentional.
interface BedrockModelMapping {
  bedrockId: string;
  crossRegion: boolean;
}

export const BEDROCK_MODEL_MAP: Record<string, BedrockModelMapping> = {
  // --- Anthropic (Claude) — require a cross-region inference profile ---
  "claude-haiku-4.5":  { bedrockId: "anthropic.claude-haiku-4-5-20251001-v1:0",  crossRegion: true },
  "claude-sonnet-4.5": { bedrockId: "anthropic.claude-sonnet-4-5-20250929-v1:0", crossRegion: true },
  "claude-sonnet-4.6": { bedrockId: "anthropic.claude-sonnet-4-6",               crossRegion: true },

  // --- Amazon (Nova) — v1 family invoked via cross-region profile ---
  "nova-micro":   { bedrockId: "amazon.nova-micro-v1:0",   crossRegion: true },
  "nova-lite":    { bedrockId: "amazon.nova-lite-v1:0",    crossRegion: true },
  "nova-2-lite":  { bedrockId: "amazon.nova-2-lite-v1:0",  crossRegion: true },
  "nova-pro":     { bedrockId: "amazon.nova-pro-v1:0",     crossRegion: true },
  "nova-premier": { bedrockId: "amazon.nova-premier-v1:0", crossRegion: true },

  // --- Google (Gemma 3, open weight) ---
  "gemma-3-4b":  { bedrockId: "google.gemma-3-4b-it",  crossRegion: false },
  "gemma-3-12b": { bedrockId: "google.gemma-3-12b-it", crossRegion: false },
  "gemma-3-27b": { bedrockId: "google.gemma-3-27b-it", crossRegion: false },

  // --- OpenAI (GPT-OSS, open weight) ---
  "gpt-oss-20b":  { bedrockId: "openai.gpt-oss-20b-1:0",  crossRegion: false },
  "gpt-oss-120b": { bedrockId: "openai.gpt-oss-120b-1:0", crossRegion: false },

  // --- Alibaba (Qwen3) ---
  "qwen3-32b":      { bedrockId: "qwen.qwen3-32b-v1:0",            crossRegion: false },
  "qwen3-next-80b": { bedrockId: "qwen.qwen3-next-80b-a3b",        crossRegion: false },
  "qwen3-235b":     { bedrockId: "qwen.qwen3-vl-235b-a22b",         crossRegion: false },
};

// Geo prefix for cross-region inference profiles. Override per deployment region
// group (e.g. "eu", "apac") via env.
const BEDROCK_GEO = process.env.BEDROCK_GEO?.trim() || "us";

// Resolve a catalog id (e.g. "claude-sonnet-4.5") OR a raw Bedrock id to the
// concrete modelId string Converse expects. Unknown ids are passed through
// untouched, so callers may also hand us a full inference-profile ARN.
export function resolveBedrockModelId(catalogOrRawId: string): string {
  const mapping = BEDROCK_MODEL_MAP[catalogOrRawId];
  if (!mapping) return catalogOrRawId; // assume caller passed a real id/ARN
  return mapping.crossRegion ? `${BEDROCK_GEO}.${mapping.bedrockId}` : mapping.bedrockId;
}

export function isBedrockSupported(catalogId: string): boolean {
  return catalogId in BEDROCK_MODEL_MAP;
}

export function supportedBedrockModelIds(): string[] {
  return Object.keys(BEDROCK_MODEL_MAP);
}

// ---------------------------------------------------------------------------
// Client (lazy singleton).
// ---------------------------------------------------------------------------
let _client: BedrockRuntimeClient | null = null;

export function getBedrockClient(): BedrockRuntimeClient {
  if (_client) return _client;
  const region =
    process.env.BEDROCK_REGION?.trim() ||
    process.env.AWS_REGION?.trim() ||
    "us-east-1";
  _client = new BedrockRuntimeClient({ region });
  return _client;
}

// ---------------------------------------------------------------------------
// Public request / response shapes.
// ---------------------------------------------------------------------------
export interface BedrockInvokeRequest {
  // Catalog id (preferred, e.g. "claude-sonnet-4.5") or a raw Bedrock model id.
  modelId: string;
  prompt: string;
  system?: string;
  maxTokens?: number;
  temperature?: number;
  topP?: number;
}

export interface BedrockUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface BedrockInvokeResult {
  text: string;
  // Chain-of-thought emitted by "reasoning" models (GPT-OSS, some others) in a
  // separate `reasoningContent` block. Kept apart from the answer `text`; used
  // for diagnostics when a model spends its whole token budget reasoning and
  // never reaches the final answer.
  reasoningText: string;
  usage: BedrockUsage;
  stopReason?: string;
  // The concrete Bedrock model id actually invoked (after resolution).
  bedrockModelId: string;
  latencyMs: number;
}

const DEFAULTS = { maxTokens: 4096, temperature: 0.3 };

// Build the Converse inferenceConfig. IMPORTANT: some Bedrock models reject a
// request that sets BOTH temperature and topP ("`temperature` and `top_p`
// cannot both be specified for this model"). So we send exactly one sampling
// knob: topP when the caller explicitly asks for nucleus sampling, otherwise
// temperature (the default).
function buildInferenceConfig(req: BedrockInvokeRequest) {
  const cfg: { maxTokens: number; temperature?: number; topP?: number } = {
    maxTokens: req.maxTokens ?? DEFAULTS.maxTokens,
  };
  if (req.topP != null) cfg.topP = req.topP;
  else cfg.temperature = req.temperature ?? DEFAULTS.temperature;
  return cfg;
}

// ---------------------------------------------------------------------------
// Invoke — single, non-streaming call via the Converse API.
// ---------------------------------------------------------------------------
export async function invokeBedrock(
  req: BedrockInvokeRequest,
): Promise<BedrockInvokeResult> {
  if (!req.prompt?.trim()) throw new Error("Bedrock: empty prompt");

  const bedrockModelId = resolveBedrockModelId(req.modelId);
  const client = getBedrockClient();
  const started = Date.now();

  const command = new ConverseCommand({
    modelId: bedrockModelId,
    messages: [{ role: "user", content: [{ text: req.prompt }] }],
    system: req.system ? [{ text: req.system }] : undefined,
    inferenceConfig: buildInferenceConfig(req),
  });

  const res = await client.send(command);

  // Reasoning models return TWO kinds of content block: the final answer as a
  // `text` block, and their chain-of-thought as a `reasoningContent` block. The
  // old code only read `text` blocks, so a model that hit the token cap while
  // still reasoning (no `text` block yet) came back empty. Collect both.
  let text = "";
  let reasoningText = "";
  for (const block of res.output?.message?.content ?? []) {
    if ("text" in block && typeof block.text === "string") {
      text += block.text;
    } else if (
      "reasoningContent" in block &&
      block.reasoningContent &&
      "reasoningText" in block.reasoningContent
    ) {
      reasoningText += block.reasoningContent.reasoningText?.text ?? "";
    }
  }
  text = text.trim();
  reasoningText = reasoningText.trim();

  return {
    text,
    reasoningText,
    usage: {
      inputTokens: res.usage?.inputTokens ?? 0,
      outputTokens: res.usage?.outputTokens ?? 0,
      totalTokens: res.usage?.totalTokens ?? 0,
    },
    stopReason: res.stopReason,
    bedrockModelId,
    latencyMs: Date.now() - started,
  };
}

// ---------------------------------------------------------------------------
// Invoke (streaming) — async generator of text deltas via ConverseStream.
// Useful later for the UI; the final delta carries usage metadata.
// ---------------------------------------------------------------------------
export interface BedrockStreamChunk {
  delta: string;
  done: boolean;
  usage?: BedrockUsage;
  stopReason?: string;
}

export async function* invokeBedrockStream(
  req: BedrockInvokeRequest,
): AsyncGenerator<BedrockStreamChunk> {
  if (!req.prompt?.trim()) throw new Error("Bedrock: empty prompt");

  const bedrockModelId = resolveBedrockModelId(req.modelId);
  const client = getBedrockClient();

  const command = new ConverseStreamCommand({
    modelId: bedrockModelId,
    messages: [{ role: "user", content: [{ text: req.prompt }] }],
    system: req.system ? [{ text: req.system }] : undefined,
    inferenceConfig: buildInferenceConfig(req),
  });

  const res = await client.send(command);
  if (!res.stream) return;

  for await (const event of res.stream) {
    if (event.contentBlockDelta?.delta && "text" in event.contentBlockDelta.delta) {
      yield { delta: event.contentBlockDelta.delta.text ?? "", done: false };
    }
    if (event.metadata) {
      yield {
        delta: "",
        done: true,
        usage: {
          inputTokens: event.metadata.usage?.inputTokens ?? 0,
          outputTokens: event.metadata.usage?.outputTokens ?? 0,
          totalTokens: event.metadata.usage?.totalTokens ?? 0,
        },
      };
    }
  }
}
