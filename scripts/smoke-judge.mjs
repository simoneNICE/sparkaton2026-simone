// Local smoke test for the "Judged" routing path — the cheap-model complexity
// classifier (see lib/judge.ts). No Next.js server needed.
//
//   node scripts/smoke-judge.mjs "Write a Python function to reverse a linked list"
//   JUDGE_MODEL_ID=nova-micro node scripts/smoke-judge.mjs "What's the capital of France?"
//
// Requires: AWS creds in the environment (or a configured profile) and Bedrock
// model access enabled in BEDROCK_REGION for the judge model. Run `npm install`
// first. This exercises the SAME system prompt + JSON parsing the app uses, so a
// green run here means the judge verdict the router consumes is well-formed.

import {
  BedrockRuntimeClient,
  ConverseCommand,
} from "@aws-sdk/client-bedrock-runtime";

// Catalog id -> [bedrockId, crossRegion]. Mirrors lib/bedrock.ts (kept local so
// this script has no TS build step, exactly like smoke-bedrock.mjs).
const MAP = {
  "nova-micro":   ["amazon.nova-micro-v1:0", true],
  "nova-lite":    ["amazon.nova-lite-v1:0", true],
  "claude-haiku-4.5": ["anthropic.claude-haiku-4-5-20251001-v1:0", true],
  "gemma-3-4b":   ["google.gemma-3-4b-it", false],
};

// Mirror of the classifier system prompt in lib/judge.ts.
const SYSTEM_PROMPT =
  "You are a routing classifier for an LLM gateway. Given a user task, rate how " +
  "much model capability it demands and reply with ONLY a compact JSON object — no " +
  "prose, no code fences.\n" +
  'Shape: {"score": <int 0-100>, "skill": "code"|"reasoning"|"math"|"general", "rationale": "<max 15 words>"}\n' +
  "score guide: 0-20 trivial; 21-70 moderate; 71-100 hard. " +
  'skill: "code" for programming, "math" for calculation/proofs, ' +
  '"reasoning" for analysis, "general" otherwise.';

// Mirror of parseVerdict() in lib/judge.ts — extract first {...}, clamp, fallback.
function parseVerdict(text) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  let obj;
  try { obj = JSON.parse(match[0]); } catch { return null; }
  if (typeof obj !== "object" || obj === null) return null;
  const n = Number(obj.score);
  if (!Number.isFinite(n)) return null;
  const score = Math.max(0, Math.min(100, Math.round(n)));
  const skill = ["code", "reasoning", "math", "general"].includes(obj.skill) ? obj.skill : "general";
  const rationale = typeof obj.rationale === "string" && obj.rationale.trim()
    ? obj.rationale.trim().slice(0, 160) : "judged by model";
  return { score, skill, rationale };
}

// --- Offline self-check of the parser (runs without AWS creds) ---------------
function assert(cond, msg) { if (!cond) { console.error("FAIL:", msg); process.exitCode = 1; } }
(function offlineChecks() {
  assert(parseVerdict('{"score":42,"skill":"code","rationale":"x"}').score === 42, "basic parse");
  assert(parseVerdict('noise {"score":150,"skill":"math"} tail').score === 100, "clamp high");
  assert(parseVerdict('{"score":-5,"skill":"bogus"}').score === 0, "clamp low");
  assert(parseVerdict('{"score":30,"skill":"bogus"}').skill === "general", "skill fallback");
  assert(parseVerdict("not json at all") === null, "non-json -> null");
  assert(parseVerdict('```json\n{"score":80,"skill":"reasoning","rationale":"hard"}\n```').score === 80, "fenced json");
  console.log("offline parser checks: OK");
})();

const prompt = process.argv[2];
if (!prompt) {
  console.log("\nNo prompt arg given — ran offline checks only. Pass a prompt to do a live judge call.");
  process.exit(process.exitCode ?? 0);
}

const judgeId = process.env.JUDGE_MODEL_ID?.trim() || "nova-micro";
const [bedrockId, crossRegion] = MAP[judgeId] ?? [judgeId, false];
const geo = process.env.BEDROCK_GEO?.trim() || "us";
const modelId = crossRegion ? `${geo}.${bedrockId}` : bedrockId;
const region = process.env.BEDROCK_REGION?.trim() || process.env.AWS_REGION?.trim() || "us-east-1";

console.log(`\nJudging with ${judgeId} (${modelId}) in ${region}…`);
const client = new BedrockRuntimeClient({ region });
const started = Date.now();
const res = await client.send(new ConverseCommand({
  modelId,
  messages: [{ role: "user", content: [{ text: prompt }] }],
  system: [{ text: SYSTEM_PROMPT }],
  inferenceConfig: { maxTokens: 120, temperature: 0 },
}));
const text = res.output?.message?.content?.map((b) => ("text" in b ? b.text : "")).join("").trim() ?? "";
console.log(`latency ${Date.now() - started}ms · tokens ${res.usage?.inputTokens}/${res.usage?.outputTokens}`);
console.log("raw response:", JSON.stringify(text));
console.log("parsed verdict:", parseVerdict(text));
