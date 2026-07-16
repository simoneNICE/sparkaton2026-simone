// ---------------------------------------------------------------------------
// "Judged" routing — judge-then-route (classify complexity up front).
// ---------------------------------------------------------------------------
// A small, cheap model (Nova Micro / Haiku / Gemma 4B via our Bedrock connector)
// reads the prompt and returns a complexity score (0..100) plus the dominant
// skill. That score is substituted for the keyword-heuristic `assessment.score`
// (see lib/orchestrate.ts) and the SAME value-based `selectByValue` machinery
// then picks the cheapest good-enough model. One extra cheap LLM call, but more
// flexible than the pure keyword heuristic.
//
// Cost control: the judged score is a PURE FUNCTION of the prompt — the
// quality/cost slider only applies its bias *after* the score. So we memoize
// the verdict per (model, prompt). Live re-routing on the slider then re-uses a
// cached verdict instead of firing a fresh (paid) Bedrock call on every drag.
// ---------------------------------------------------------------------------

import { MODEL_CATALOG } from "./config";
import { invokeBedrock, isBedrockSupported } from "./bedrock";
import type { Skill } from "./types";

// The model that does the judging. Cheap by design; override per deployment.
// Defaults to Nova Micro (the cheapest catalog model). Any catalog id works.
const JUDGE_MODEL_ID = process.env.JUDGE_MODEL_ID?.trim() || "nova-micro";

export interface JudgeVerdict {
  // Complexity 0..100, on the same scale as assessComplexity().score.
  score: number;
  // Dominant hard skill the judge thinks the task needs. Used to pick the
  // specialist within a tier (overrides the keyword-derived skill).
  skill: Skill;
  // One short sentence: why this score. Surfaced in the UI.
  rationale: string;
  // Catalog id of the model that produced the verdict, for display.
  modelId: string;
  modelName: string;
}

const SYSTEM_PROMPT =
  "You are a routing classifier for an LLM gateway. Given a user task, rate how " +
  "much model capability it demands and reply with ONLY a compact JSON object — no " +
  "prose, no code fences.\n" +
  'Shape: {"score": <int 0-100>, "skill": "code"|"reasoning"|"math"|"general", "rationale": "<max 15 words>"}\n' +
  "score guide: 0-20 trivial (short factual / chit-chat / simple rewrite); " +
  "21-70 moderate (typical coding, analysis, multi-step, or domain questions); " +
  "71-100 hard (complex reasoning, tricky algorithms, high-stakes legal/medical/financial, long multi-constraint tasks). " +
  'skill: "code" for programming/debugging, "math" for calculation/proofs, ' +
  '"reasoning" for analysis/comparison/deduction, "general" otherwise.';

const VALID_SKILLS: Skill[] = ["code", "reasoning", "math", "general"];

// Extract the first {...} block and parse it. Cheap models sometimes wrap the
// JSON in prose or a code fence despite the instruction, so we don't rely on the
// whole response being valid JSON.
export function parseVerdict(text: string): { score: number; skill: Skill; rationale: string } | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(match[0]);
  } catch {
    return null;
  }
  if (typeof obj !== "object" || obj === null) return null;
  const raw = obj as Record<string, unknown>;

  const n = Number(raw.score);
  if (!Number.isFinite(n)) return null;
  const score = Math.max(0, Math.min(100, Math.round(n)));

  const skill = VALID_SKILLS.includes(raw.skill as Skill) ? (raw.skill as Skill) : "general";
  const rationale =
    typeof raw.rationale === "string" && raw.rationale.trim()
      ? raw.rationale.trim().slice(0, 160)
      : "judged by model";

  return { score, skill, rationale };
}

// Per-(model, prompt) verdict cache. The verdict is prompt-only, so slider drags
// re-route from cache without re-invoking Bedrock. Bounded to avoid unbounded
// growth in a long-lived server process.
const CACHE_LIMIT = 500;
const _cache = new Map<string, JudgeVerdict>();

function cacheGet(key: string): JudgeVerdict | undefined {
  return _cache.get(key);
}
function cacheSet(key: string, value: JudgeVerdict): void {
  if (_cache.size >= CACHE_LIMIT) {
    const oldest = _cache.keys().next().value;
    if (oldest !== undefined) _cache.delete(oldest);
  }
  _cache.set(key, value);
}

// Judge a prompt's complexity via a cheap Bedrock model. Returns null on ANY
// failure (unsupported judge model, missing credentials, bad JSON, empty
// response) so the caller can fall back to the keyword heuristic — a judge
// failure must degrade the request, never break it.
export async function judgeComplexity(prompt: string): Promise<JudgeVerdict | null> {
  const trimmed = prompt.trim();
  if (!trimmed) return null;
  if (!isBedrockSupported(JUDGE_MODEL_ID)) return null;

  const key = `${JUDGE_MODEL_ID}::${trimmed}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  let text: string;
  try {
    const res = await invokeBedrock({
      modelId: JUDGE_MODEL_ID,
      prompt: trimmed,
      system: SYSTEM_PROMPT,
      maxTokens: 120,
      temperature: 0,
    });
    text = res.text;
  } catch {
    return null;
  }

  const parsed = parseVerdict(text);
  if (!parsed) return null;

  const modelName =
    MODEL_CATALOG.find((m) => m.id === JUDGE_MODEL_ID)?.displayName ?? JUDGE_MODEL_ID;

  const verdict: JudgeVerdict = { ...parsed, modelId: JUDGE_MODEL_ID, modelName };
  cacheSet(key, verdict);
  return verdict;
}
