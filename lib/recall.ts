// Client for the standalone "Model Routing" fuzzy prompt matcher (Python /
// Flask project, sibling repo at ../Model Routing). It stores prompts already
// routed before and returns the model that was used, via deterministic text
// similarity — no embeddings, no LLM call. This is the "Learned" / recall
// routing algorithm surfaced in the UI (see app/page.tsx ROUTING_ALGORITHMS).
import { MODEL_CATALOG } from "./config";
import type { ModelSpec } from "./types";

const RECALL_SERVICE_URL = process.env.RECALL_SERVICE_URL ?? "http://127.0.0.1:5050";

interface FuzzyMatchResponse {
  status: "FOUND" | "WEAK_MATCH" | "NOT_FOUND";
  input_prompt: string;
  matched_prompt?: string;
  similarity_score?: number;
  associated_model: string | null;
  match_type: string;
}

export interface RecallHit {
  model: ModelSpec;
  matchedPrompt: string;
  similarityScore: number;
  matchType: string;
}

// Returns null on anything short of a confident match with a model id that
// resolves in this catalog — callers fall back to the metadata-based router.
// Never throws: an unreachable recall service is a cache miss, not an error.
//
// Timeout margin: the matcher's Levenshtein component is a pure-Python O(n*m)
// DP, so a query compared against several long (1000+ char) stored prompts
// can legitimately take 1-2s — a 1500ms timeout was measured aborting real
// matches (they silently fell back to metadata-based routing instead of
// recalling). 8000ms leaves headroom as the database grows; if this service
// needs to scale to a much larger prompt store, replace the pure-Python DP
// with a fast Levenshtein implementation rather than raising this further.
export async function tryRecall(prompt: string): Promise<RecallHit | null> {
  let data: FuzzyMatchResponse;
  try {
    const res = await fetch(
      `${RECALL_SERVICE_URL}/api/match?query=${encodeURIComponent(prompt)}`,
      { signal: AbortSignal.timeout(8000) },
    );
    if (!res.ok) return null;
    data = await res.json();
  } catch {
    return null;
  }

  if (data.status !== "FOUND" || !data.associated_model) return null;

  // The matcher's db.json stores model ids from this same catalog, but don't
  // trust that blindly — a stale/foreign id should be a miss, not a crash.
  const model = MODEL_CATALOG.find((m) => m.id === data.associated_model);
  if (!model) return null;

  return {
    model,
    matchedPrompt: data.matched_prompt ?? "",
    similarityScore: data.similarity_score ?? 0,
    matchType: data.match_type,
  };
}
