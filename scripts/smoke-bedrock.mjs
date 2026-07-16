// Local smoke test for the Bedrock connector — no Next.js server needed.
//
//   node scripts/smoke-bedrock.mjs "claude-sonnet-4.5" "Say hi in one short sentence."
//
// Requires: AWS creds in the environment (or a configured profile) and Bedrock
// model access enabled in BEDROCK_REGION. Run `npm install` first.

import {
  BedrockRuntimeClient,
  ConverseCommand,
} from "@aws-sdk/client-bedrock-runtime";

const MAP = {
  "claude-haiku-4.5":  ["anthropic.claude-haiku-4-5-20251001-v1:0", true],
  "claude-sonnet-4.5": ["anthropic.claude-sonnet-4-5-20250929-v1:0", true],
  "claude-sonnet-4.6": ["anthropic.claude-sonnet-4-6", true],
  "nova-micro":   ["amazon.nova-micro-v1:0", true],
  "nova-lite":    ["amazon.nova-lite-v1:0", true],
  "nova-2-lite":  ["amazon.nova-2-lite-v1:0", true],
  "nova-pro":     ["amazon.nova-pro-v1:0", true],
  "nova-premier": ["amazon.nova-premier-v1:0", true],
  "gemma-3-4b":  ["google.gemma-3-4b-it", false],
  "gemma-3-12b": ["google.gemma-3-12b-it", false],
  "gemma-3-27b": ["google.gemma-3-27b-it", false],
  "gpt-oss-20b":  ["openai.gpt-oss-20b-1:0", false],
  "gpt-oss-120b": ["openai.gpt-oss-120b-1:0", false],
  "qwen3-32b":      ["qwen.qwen3-32b-v1:0", false],
  "qwen3-next-80b": ["qwen.qwen3-next-80b-a3b", false],
  "qwen3-235b":     ["qwen.qwen3-vl-235b-a22b", false],
};

const geo = process.env.BEDROCK_GEO || "us";
const region = process.env.BEDROCK_REGION || process.env.AWS_REGION || "us-east-1";

const catalogId = process.argv[2] || "claude-sonnet-4.5";
const prompt = process.argv[3] || "Say hi in one short sentence.";

const entry = MAP[catalogId];
if (!entry) {
  console.error(`Unknown model "${catalogId}". Known: ${Object.keys(MAP).join(", ")}`);
  process.exit(1);
}
const modelId = entry[1] ? `${geo}.${entry[0]}` : entry[0];

console.log(`Region: ${region}  Model: ${modelId}\nPrompt: ${prompt}\n---`);

const client = new BedrockRuntimeClient({ region });
const res = await client.send(
  new ConverseCommand({
    modelId,
    messages: [{ role: "user", content: [{ text: prompt }] }],
    inferenceConfig: { maxTokens: 256, temperature: 0.3, topP: 0.9 },
  }),
);

const text = (res.output?.message?.content ?? [])
  .map((b) => b.text ?? "")
  .join("");

console.log(text.trim());
console.log("---");
console.log("usage:", JSON.stringify(res.usage), "stop:", res.stopReason);
