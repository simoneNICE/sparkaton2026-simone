// Fuzzy Prompt Matcher (deterministic, non-AI)
// =============================================
//
// TypeScript port of the standalone Python matcher (prompt_matcher.py, sibling
// repo "model-routing-matcher"). Given a user prompt, it finds the closest
// stored prompt in the database using classical, deterministic text-similarity
// algorithms only — no embeddings, no vector search, no LLM calls, no AI/ML
// models of any kind. This is the engine behind the "Learned" / recall routing
// algorithm (see lib/recall.ts + app/page.tsx ROUTING_ALGORITHMS).
//
// Algorithm
// ---------
// For the input prompt vs. every stored prompt, four classical similarity
// components are computed on normalized text (lowercased, punctuation stripped,
// whitespace collapsed):
//
//   1. Levenshtein similarity    - 1 - (edit distance / max length)
//   2. Token overlap coefficient - |token intersection| / min(|A|, |B|)
//                                  (subset-aware — a short query fully contained
//                                  in a longer stored prompt scores 1.0 here,
//                                  unlike Jaccard)
//   3. Trigram cosine similarity - cosine similarity of character 3-gram
//                                  frequency vectors
//   4. Sequence similarity       - difflib.SequenceMatcher ratio
//                                  (Ratcliff/Obershelp, LCS-based)
//
// Combined into one weighted score:
//
//     score = 0.35*levenshtein + 0.30*token_overlap + 0.25*trigram + 0.10*sequence
//
// The highest-scoring stored prompt is the closest match. If its score clears
// MATCH_THRESHOLD, the associated_model stored next to that prompt is returned
// verbatim — nothing is generated. A middle "weak match" zone reports the
// closest prompt without releasing a model. Below that, NOT_FOUND.

import rawDb from "./matcher-db.json";

export const MATCH_THRESHOLD = 0.75; // score >= this -> FOUND (model released)
export const WEAK_THRESHOLD = 0.55; // this <= score < MATCH_THRESHOLD -> WEAK_MATCH (closest, no model)

export const WEIGHTS = {
  levenshtein: 0.35,
  token_overlap: 0.3,
  trigram: 0.25,
  sequence: 0.1,
} as const;

export const MATCH_TYPE = "fuzzy_text_match";

// Matches Python's string.punctuation: !"#$%&'()*+,-./:;<=>?@[\]^_`{|}~
const PUNCT_RE = /[!"#$%&'()*+,\-./:;<=>?@[\]^_`{|}~]/g;
const WS_RE = /\s+/g;

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

export function normalize(text: string): string {
  let t = text.toLowerCase().trim();
  t = t.replace(PUNCT_RE, " ");
  t = t.replace(WS_RE, " ").trim();
  return t;
}

export function tokenize(normalizedText: string): string[] {
  // Python str.split() on the normalized (single-spaced, trimmed) string.
  return normalizedText.length ? normalizedText.split(" ") : [];
}

// Character 3-gram frequency counter, mirroring the Python Counter behavior.
export function charTrigrams(normalizedText: string): Map<string, number> {
  const n = 3;
  const counter = new Map<string, number>();
  if (normalizedText.length < n) {
    if (normalizedText) counter.set(normalizedText, 1);
    return counter;
  }
  for (let i = 0; i <= normalizedText.length - n; i++) {
    const g = normalizedText.slice(i, i + n);
    counter.set(g, (counter.get(g) ?? 0) + 1);
  }
  return counter;
}

// ---------------------------------------------------------------------------
// Similarity components (all deterministic, classical string algorithms)
// ---------------------------------------------------------------------------

export function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  let la = a.length;
  let lb = b.length;
  if (la === 0) return lb;
  if (lb === 0) return la;
  // Keep b the shorter string so the row width (inner loop) is min(la, lb).
  if (lb > la) {
    [a, b] = [b, a];
    [la, lb] = [lb, la];
  }
  let prev = new Array<number>(lb + 1);
  let curr = new Array<number>(lb + 1);
  for (let j = 0; j <= lb; j++) prev[j] = j;
  for (let i = 1; i <= la; i++) {
    curr[0] = i;
    const ca = a[i - 1];
    for (let j = 1; j <= lb; j++) {
      const cost = ca === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[lb];
}

export function levenshteinSimilarity(a: string, b: string): number {
  if (!a && !b) return 1.0;
  return 1.0 - levenshteinDistance(a, b) / Math.max(a.length, b.length);
}

// Overlap coefficient: |A ∩ B| / min(|A|, |B|). Unlike Jaccard (which divides
// by the union), this doesn't penalize a short query for having fewer words
// than a longer stored prompt — a query that's a full subset scores 1.0.
export function tokenOverlapSimilarity(tokensA: string[], tokensB: string[]): number {
  const setA = new Set(tokensA);
  const setB = new Set(tokensB);
  if (setA.size === 0 && setB.size === 0) return 1.0;
  if (setA.size === 0 || setB.size === 0) return 0.0;
  let inter = 0;
  for (const t of setA) if (setB.has(t)) inter++;
  return inter / Math.min(setA.size, setB.size);
}

export function trigramCosineSimilarity(
  trigramsA: Map<string, number>,
  trigramsB: Map<string, number>,
): number {
  if (trigramsA.size === 0 && trigramsB.size === 0) return 1.0;
  if (trigramsA.size === 0 || trigramsB.size === 0) return 0.0;
  let dot = 0;
  // Iterate the smaller map for the intersection.
  const [small, large] =
    trigramsA.size <= trigramsB.size ? [trigramsA, trigramsB] : [trigramsB, trigramsA];
  for (const [g, v] of small) {
    const w = large.get(g);
    if (w !== undefined) dot += v * w;
  }
  let normA = 0;
  for (const v of trigramsA.values()) normA += v * v;
  let normB = 0;
  for (const v of trigramsB.values()) normB += v * v;
  normA = Math.sqrt(normA);
  normB = Math.sqrt(normB);
  if (normA === 0 || normB === 0) return 0.0;
  return dot / (normA * normB);
}

// Faithful port of Python difflib.SequenceMatcher(None, a, b).ratio()
// (Ratcliff/Obershelp). No isjunk (bjunk stays empty); the autojunk heuristic
// is preserved (popular elements purged when the sequence length is >= 200) so
// scores match Python's on long stored prompts.
export function sequenceSimilarity(a: string, b: string): number {
  const la = a.length;
  const lb = b.length;
  if (la + lb === 0) return 1.0;

  // b2j: element -> ascending list of indices in b.
  const b2j = new Map<string, number[]>();
  for (let i = 0; i < lb; i++) {
    const ch = b[i];
    const arr = b2j.get(ch);
    if (arr) arr.push(i);
    else b2j.set(ch, [i]);
  }
  // autojunk: purge popular elements (mirrors CPython difflib).
  if (lb >= 200) {
    const ntest = Math.floor(lb / 100) + 1;
    const popular: string[] = [];
    for (const [elt, idxs] of b2j) if (idxs.length > ntest) popular.push(elt);
    for (const elt of popular) b2j.delete(elt);
  }
  // bjunk is empty (isjunk === None), so junk-adjacent extension never fires.

  const findLongestMatch = (
    alo: number,
    ahi: number,
    blo: number,
    bhi: number,
  ): [number, number, number] => {
    let besti = alo;
    let bestj = blo;
    let bestsize = 0;
    let j2len = new Map<number, number>();
    for (let i = alo; i < ahi; i++) {
      const newj2len = new Map<number, number>();
      const idxs = b2j.get(a[i]);
      if (idxs) {
        for (const j of idxs) {
          if (j < blo) continue;
          if (j >= bhi) break;
          const k = (j2len.get(j - 1) ?? 0) + 1;
          newj2len.set(j, k);
          if (k > bestsize) {
            besti = i - k + 1;
            bestj = j - k + 1;
            bestsize = k;
          }
        }
      }
      j2len = newj2len;
    }
    // Extend the match with equal (non-junk) elements on both sides.
    while (besti > alo && bestj > blo && a[besti - 1] === b[bestj - 1]) {
      besti--;
      bestj--;
      bestsize++;
    }
    while (
      besti + bestsize < ahi &&
      bestj + bestsize < bhi &&
      a[besti + bestsize] === b[bestj + bestsize]
    ) {
      bestsize++;
    }
    return [besti, bestj, bestsize];
  };

  let matches = 0;
  const queue: [number, number, number, number][] = [[0, la, 0, lb]];
  while (queue.length) {
    const [alo, ahi, blo, bhi] = queue.pop()!;
    const [i, j, k] = findLongestMatch(alo, ahi, blo, bhi);
    if (k > 0) {
      matches += k;
      if (alo < i && blo < j) queue.push([alo, i, blo, j]);
      if (i + k < ahi && j + k < bhi) queue.push([i + k, ahi, j + k, bhi]);
    }
  }
  return (2.0 * matches) / (la + lb);
}

export type ScoreComponents = {
  levenshtein: number;
  token_overlap: number;
  trigram: number;
  sequence: number;
};

export function weightedScore(components: ScoreComponents): number {
  return (
    WEIGHTS.levenshtein * components.levenshtein +
    WEIGHTS.token_overlap * components.token_overlap +
    WEIGHTS.trigram * components.trigram +
    WEIGHTS.sequence * components.sequence
  );
}

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------

// A stored prompt with its precomputed normalized form, token set, and trigram
// counter — computed once at load time so repeated searches don't redo work.
export interface Entry {
  id: number;
  prompt: string;
  associatedModel: string;
  normPrompt: string;
  tokens: string[];
  trigrams: Map<string, number>;
}

interface RawEntry {
  id: number;
  prompt: string;
  associated_model: string;
}

function makeEntry(id: number, prompt: string, associatedModel: string): Entry {
  const normPrompt = normalize(prompt);
  return {
    id,
    prompt,
    associatedModel,
    normPrompt,
    tokens: tokenize(normPrompt),
    trigrams: charTrigrams(normPrompt),
  };
}

export function loadEntries(): Entry[] {
  const data = rawDb as { entries: RawEntry[] };
  return data.entries.map((e) => makeEntry(e.id, e.prompt, e.associated_model));
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

export type MatchStatus = "FOUND" | "WEAK_MATCH" | "NOT_FOUND";

export interface MatchResult {
  status: MatchStatus;
  inputPrompt: string;
  matchedPrompt: string | null;
  similarityScore: number;
  associatedModel: string | null;
  components: ScoreComponents | null;
  matchType: string;
}

// The public JSON response shape — mirrors the Python matcher's to_dict()
// exactly (snake_case keys), so /api/match is a drop-in for the old Flask
// service and any external consumer keeps working.
export interface MatchResultDict {
  status: MatchStatus;
  input_prompt: string;
  matched_prompt?: string;
  similarity_score?: number;
  associated_model: string | null;
  match_type: string;
  components?: Record<string, number>;
}

export function matchResultToDict(result: MatchResult, includeComponents = false): MatchResultDict {
  if (result.status === "NOT_FOUND") {
    const dict: MatchResultDict = {
      status: result.status,
      input_prompt: result.inputPrompt,
      associated_model: null,
      match_type: result.matchType,
    };
    if (includeComponents && result.components) {
      dict.components = roundComponents(result.components);
    }
    return dict;
  }
  const dict: MatchResultDict = {
    status: result.status,
    input_prompt: result.inputPrompt,
    matched_prompt: result.matchedPrompt ?? undefined,
    similarity_score: round(result.similarityScore, 4),
    associated_model: result.associatedModel,
    match_type: result.matchType,
  };
  if (includeComponents && result.components) {
    dict.components = roundComponents(result.components);
  }
  return dict;
}

function round(x: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(x * f) / f;
}

function roundComponents(c: ScoreComponents): Record<string, number> {
  return {
    levenshtein: round(c.levenshtein, 4),
    token_overlap: round(c.token_overlap, 4),
    trigram: round(c.trigram, 4),
    sequence: round(c.sequence, 4),
  };
}

// Deterministic fuzzy text matcher. No AI, no embeddings, no vectors.
export class FuzzyPromptMatcher {
  readonly entries: Entry[];
  readonly matchThreshold: number;
  readonly weakThreshold: number;

  constructor(
    entries: Entry[],
    matchThreshold: number = MATCH_THRESHOLD,
    weakThreshold: number = WEAK_THRESHOLD,
  ) {
    if (!entries.length) throw new Error("Database is empty.");
    this.entries = entries;
    this.matchThreshold = matchThreshold;
    this.weakThreshold = weakThreshold;
  }

  private scoreEntry(
    normQuery: string,
    tokensQuery: string[],
    trigramsQuery: Map<string, number>,
    entry: Entry,
  ): ScoreComponents {
    return {
      levenshtein: levenshteinSimilarity(normQuery, entry.normPrompt),
      token_overlap: tokenOverlapSimilarity(tokensQuery, entry.tokens),
      trigram: trigramCosineSimilarity(trigramsQuery, entry.trigrams),
      sequence: sequenceSimilarity(normQuery, entry.normPrompt),
    };
  }

  match(query: string): MatchResult {
    const rawQuery = query ?? "";
    const normQuery = normalize(rawQuery);
    const tokensQuery = tokenize(normQuery);
    const trigramsQuery = charTrigrams(normQuery);

    let bestEntry: Entry | null = null;
    let bestScore = 0.0;
    let bestComponents: ScoreComponents | null = null;

    for (const entry of this.entries) {
      const components = this.scoreEntry(normQuery, tokensQuery, trigramsQuery, entry);
      const score = weightedScore(components);
      if (score > bestScore) {
        bestScore = score;
        bestEntry = entry;
        bestComponents = components;
      }
    }

    if (bestEntry && bestScore >= this.matchThreshold) {
      return {
        status: "FOUND",
        inputPrompt: rawQuery,
        matchedPrompt: bestEntry.prompt,
        similarityScore: bestScore,
        associatedModel: bestEntry.associatedModel,
        components: bestComponents,
        matchType: MATCH_TYPE,
      };
    }
    if (bestEntry && bestScore >= this.weakThreshold) {
      return {
        status: "WEAK_MATCH",
        inputPrompt: rawQuery,
        matchedPrompt: bestEntry.prompt,
        similarityScore: bestScore,
        associatedModel: null,
        components: bestComponents,
        matchType: MATCH_TYPE,
      };
    }
    return {
      status: "NOT_FOUND",
      inputPrompt: rawQuery,
      matchedPrompt: null,
      similarityScore: bestScore,
      associatedModel: null,
      components: bestComponents,
      matchType: MATCH_TYPE,
    };
  }
}

// Process-wide singleton: entries are normalized/tokenized once and reused
// across requests (mirrors the Python app building the matcher at import time).
let _matcher: FuzzyPromptMatcher | null = null;

export function getMatcher(): FuzzyPromptMatcher {
  if (!_matcher) _matcher = new FuzzyPromptMatcher(loadEntries());
  return _matcher;
}
