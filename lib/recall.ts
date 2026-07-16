// "Learned" / recall routing algorithm.
//
// Stores prompts already routed before and returns the model that was used, via
// deterministic text similarity — no embeddings, no LLM call. This used to be a
// standalone Python/Flask service (sibling repo "model-routing-matcher") reached
// over HTTP; it has since been ported into this repo (lib/matcher.ts) and now
// runs in-process — no external service, no network round-trip, no timeout.
// Surfaced in the UI as the "Learned" routing algorithm (see app/page.tsx
// ROUTING_ALGORITHMS).
import { MODEL_CATALOG } from "./config";
import { getMatcher } from "./matcher";
import type { ModelSpec } from "./types";

export interface RecallHit {
  model: ModelSpec;
  matchedPrompt: string;
  similarityScore: number;
  matchType: string;
}

// Returns null on anything short of a confident match with a model id that
// resolves in this catalog — callers fall back to the metadata-based router.
// Never throws: a matcher failure is a cache miss, not an error.
export function tryRecall(prompt: string): RecallHit | null {
  let result;
  try {
    result = getMatcher().match(prompt);
  } catch {
    return null;
  }

  if (result.status !== "FOUND" || !result.associatedModel) return null;

  // The matcher's db stores model ids from this same catalog, but don't trust
  // that blindly — a stale/foreign id should be a miss, not a crash.
  const model = MODEL_CATALOG.find((m) => m.id === result.associatedModel);
  if (!model) return null;

  return {
    model,
    matchedPrompt: result.matchedPrompt ?? "",
    similarityScore: result.similarityScore,
    matchType: result.matchType,
  };
}
