import { WEIGHTS, estimateTokens, tierForScore } from "./config";
import type { ComplexityAssessment, FeatureContribution } from "./types";

// Multilingual keyword banks (Italian + English) — extend freely.
const REASONING_WORDS = [
  "analyze", "analyse", "prove", "explain", "why", "compare", "reason", "evaluate",
  "deduce", "infer", "justify", "critique", "trade-off", "tradeoff", "pros and cons",
  "analizza", "dimostra", "spiega", "perché", "perche", "confronta", "ragiona",
  "valuta", "deduci", "giustifica", "motiva", "pro e contro",
];

const MATH_WORDS = [
  "calculate", "compute", "equation", "derivative", "integral", "probability",
  "matrix", "algebra", "theorem", "optimize", "sum", "solve",
  "calcola", "equazione", "derivata", "integrale", "probabilità", "probabilita",
  "matrice", "teorema", "ottimizza", "risolvi",
];

const CRITICAL_DOMAIN_WORDS = [
  "legal", "lawsuit", "contract", "medical", "diagnosis", "patient", "clinical",
  "financial", "tax", "compliance", "gdpr", "audit", "regulation",
  "legale", "causa", "contratto", "medico", "diagnosi", "paziente", "clinico",
  "finanziario", "fiscale", "conformità", "conformita", "revisione", "normativa",
];

const CREATIVE_WORDS = [
  "poem", "story", "haiku", "brainstorm", "slogan", "tagline", "joke", "song",
  "poesia", "racconto", "storia", "filastrocca", "slogan", "battuta", "canzone",
  "idee creative",
];

const MULTISTEP_CUES = [
  "step by step", "then", "after that", "also", "furthermore", "moreover",
  "passo passo", "poi", "successivamente", "inoltre", "infine",
];

// Whole-word (Unicode-aware) matching, so "sum" doesn't fire on "summary",
// "tax" on "syntax", or "story" on "history". Boundaries are only checked at
// the ends of each needle, so multi-word phrases ("pros and cons") and
// accented Italian keywords ("perché", "probabilità") still match correctly.
// `haystack` is expected to be pre-lowercased.
function countMatches(haystack: string, needles: string[]): { count: number; hits: string[] } {
  const hits: string[] = [];
  for (const n of needles) {
    const esc = n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${esc}(?![\\p{L}\\p{N}])`, "u");
    if (re.test(haystack)) hits.push(n);
  }
  return { count: hits.length, hits };
}

// Saturating map: n occurrences -> 0..1, reaching ~1 around `full`.
function saturate(n: number, full: number): number {
  if (n <= 0) return 0;
  return Math.min(1, n / full);
}

function detectCode(text: string): { signal: number; evidence: string } {
  const codeFence = /```/.test(text);
  const codeTokens = (text.match(/\b(function|def|class|import|const|let|var|return|public|void|SELECT|FROM|WHERE)\b/g) || []).length;
  const symbols = (text.match(/[{}();=<>]|=>|::|->/g) || []).length;
  const askedToCode = /\b(code|debug|refactor|implement|function|bug|stack trace|regex|codice|programma|funzione|errore)\b/i.test(text);

  let signal = 0;
  const reasons: string[] = [];
  if (codeFence) { signal += 0.6; reasons.push("code block"); }
  if (codeTokens > 0) { signal += Math.min(0.4, codeTokens * 0.08); reasons.push(`${codeTokens} code keywords`); }
  if (symbols > 6) { signal += 0.2; reasons.push("many code symbols"); }
  if (askedToCode) { signal += 0.3; reasons.push("programming intent"); }

  return {
    signal: Math.min(1, signal),
    evidence: reasons.length ? reasons.join(", ") : "no code signals",
  };
}

export function assessComplexity(promptRaw: string): ComplexityAssessment {
  const prompt = promptRaw.trim();
  const lower = prompt.toLowerCase();

  const contributions: FeatureContribution[] = [];

  const add = (
    key: string,
    label: string,
    signal: number,
    weight: number,
    evidence: string,
  ) => {
    // Positive weights only add when signal>0; negative weights subtract.
    const points = Math.round(signal * weight * 10) / 10;
    contributions.push({ key, label, signal, weight, points, evidence });
  };

  // --- code ---
  const code = detectCode(prompt);
  add("code", "Code / programming", code.signal, WEIGHTS.code, code.evidence);

  // --- reasoning ---
  const reasoning = countMatches(lower, REASONING_WORDS);
  add(
    "reasoning",
    "Reasoning required",
    saturate(reasoning.count, 3),
    WEIGHTS.reasoning,
    reasoning.count ? `keywords: ${reasoning.hits.slice(0, 4).join(", ")}` : "none",
  );

  // --- math ---
  const math = countMatches(lower, MATH_WORDS);
  const digitRuns = (prompt.match(/\d+([.,]\d+)?/g) || []).length;
  const mathSignal = Math.min(1, saturate(math.count, 2) + saturate(digitRuns, 8) * 0.5);
  add(
    "math",
    "Math / logic",
    mathSignal,
    WEIGHTS.math,
    math.count || digitRuns
      ? `${math.hits.length ? "kw: " + math.hits.slice(0, 3).join(", ") + "; " : ""}${digitRuns} numbers`
      : "none",
  );

  // --- multi-step / constraints ---
  const questionMarks = (prompt.match(/\?/g) || []).length;
  const bullets = (prompt.match(/^\s*[-*\d]+[.)]?\s+/gm) || []).length;
  const cues = countMatches(lower, MULTISTEP_CUES);
  const multiSignal = Math.min(
    1,
    saturate(questionMarks, 3) * 0.4 + saturate(bullets, 4) * 0.4 + saturate(cues.count, 2) * 0.4,
  );
  add(
    "multiStep",
    "Multi-step / constraints",
    multiSignal,
    WEIGHTS.multiStep,
    `${questionMarks} questions, ${bullets} list items, ${cues.count} sequencing cues`,
  );

  // --- length / context ---
  const tokens = estimateTokens(prompt);
  const lengthSignal = saturate(tokens, 1500); // ~1500 tokens -> full
  add("length", "Input length", lengthSignal, WEIGHTS.length, `~${tokens} tokens`);

  // --- critical domain ---
  const critical = countMatches(lower, CRITICAL_DOMAIN_WORDS);
  add(
    "criticalDomain",
    "High-stakes domain",
    saturate(critical.count, 2),
    WEIGHTS.criticalDomain,
    critical.count ? `domain: ${critical.hits.slice(0, 3).join(", ")}` : "none",
  );

  // --- creativity (dampening) ---
  const creative = countMatches(lower, CREATIVE_WORDS);
  const hasHardSignals = code.signal > 0.3 || reasoning.count > 0 || mathSignal > 0.3;
  // Only dampen if it's *purely* creative (no hard signals competing).
  const creativeSignal = hasHardSignals ? 0 : saturate(creative.count, 1);
  add(
    "creativity",
    "Open creative writing",
    creativeSignal,
    WEIGHTS.creativity,
    creative.count ? `creative task: ${creative.hits.slice(0, 3).join(", ")}` : "none",
  );

  // --- aggregate ---
  const rawScore = contributions.reduce((sum, c) => sum + c.points, 0);
  const score = Math.max(0, Math.min(100, Math.round(rawScore)));
  // Tier implied by the raw score alone. The actual routing tier is decided in
  // orchestrate.ts after applying the quality/cost slider bias.
  const rawTier = tierForScore(score);

  // Output tokens are hard to know pre-call; heuristic estimate for cost preview.
  const estOutputTokens = Math.min(2000, Math.max(150, Math.round(tokens * 1.2)));

  return {
    score,
    rawTier,
    contributions,
    estInputTokens: tokens,
    estOutputTokens,
  };
}
