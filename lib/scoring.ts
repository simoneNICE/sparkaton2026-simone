import {
  HARD_SKILL_DISCOUNTS,
  HARD_SKILL_KEYS,
  WEIGHTS,
  estimateTokens,
  tierForScore,
} from "./config";
import type { ComplexityAssessment, FeatureContribution } from "./types";

// ---------------------------------------------------------------------------
// Metadata-based complexity scorer (no LLM). Produces a 0..100 score and a
// per-dimension breakdown for the "Why this score?" panel. Design goals:
//   • Calibrated  — correlated skills don't double-count; the mid-band keeps
//     resolution instead of everything saturating at 100.
//   • Precise     — signals don't misfire (years/dates aren't "math", a list of
//     questions isn't "multi-step", a definition of a legal term isn't a
//     high-stakes legal task).
//   • Task-aware  — cheap mechanical tasks (translate/summarize/extract/format)
//     and explicit brevity lower the required capability, so they route cheap.
// ---------------------------------------------------------------------------

// Multilingual keyword banks (English + Italian). Extend freely.
const REASONING_WORDS = [
  "analyze", "analyse", "prove", "explain", "why", "compare", "reason", "evaluate",
  "deduce", "infer", "justify", "critique", "trade-off", "tradeoff", "pros and cons",
  "determine", "conclude", "recommend", "assess", "puzzle", "derive", "diagnose",
  "root cause", "implication", "strategy", "rationale",
  "analizza", "dimostra", "spiega", "perché", "perche", "confronta", "ragiona",
  "valuta", "deduci", "giustifica", "motiva", "pro e contro",
  "determina", "concludi", "raccomanda", "ragionamento",
];

const MATH_WORDS = [
  "calculate", "compute", "equation", "derivative", "integral", "probability",
  "matrix", "algebra", "theorem", "optimize", "sum", "solve", "percentage",
  "compound", "interest rate", "geometry", "statistic", "regression",
  // Unambiguous English math terms (avoid words that double as plain English,
  // e.g. "differentiate between…" is reasoning, not calculus).
  "irrational", "factorial", "modulo", "polynomial", "logarithm", "permutation",
  "combinatorics", "quadratic", "prime number", "standard deviation", "variance",
  "vector", "eigenvalue", "divisor",
  "calcola", "equazione", "derivata", "integrale", "probabilità", "probabilita",
  "matrice", "teorema", "ottimizza", "risolvi", "percentuale",
];

const CRITICAL_DOMAIN_WORDS = [
  "legal", "lawsuit", "contract", "medical", "diagnosis", "patient", "clinical",
  "financial", "tax", "compliance", "gdpr", "hipaa", "audit", "regulation", "liability",
  "securities", "insurance", "custody", "prescription", "dosage", "immigration",
  "visa", "pii", "kyc", "aml", "malpractice", "fiduciary", "sarbanes",
  "legale", "causa", "contratto", "medico", "diagnosi", "paziente", "clinico",
  "finanziario", "fiscale", "conformità", "conformita", "revisione", "normativa",
];

// Cues that a high-stakes domain word actually implies a high-stakes *task*
// (advice / decision / assessment), not just a passing mention or a definition.
const CRITICAL_CONTEXT_CUES = [
  "should i", "should we", "advise", "advice", "recommend", "liable", "liability",
  "risk", "comply", "compliant", "obligation", "eligible", "penalty", "sue",
  "review this", "is it legal", "am i allowed", "consequence",
];

const CREATIVE_WORDS = [
  "poem", "story", "haiku", "brainstorm", "slogan", "tagline", "joke", "song",
  "lyrics", "screenplay", "character", "fiction",
  "poesia", "racconto", "storia", "filastrocca", "slogan", "battuta", "canzone",
  "idee creative",
];

// Sequencing cues — a genuine ordered/multi-step task.
const SEQUENCE_CUES = [
  "step by step", "step-by-step", "then", "after that", "afterwards", "next",
  "first", "second", "third", "finally", "lastly", "subsequently", "followed by",
  "passo passo", "poi", "successivamente", "infine", "prima", "dopo",
];

// Constraint cues — extra requirements the answer must satisfy.
const CONSTRAINT_CUES = [
  "must", "must not", "without", "only", "at least", "at most", "no more than",
  "no less than", "ensure", "make sure", "constraint", "requirement", "exactly",
  "in the format", "as a table", "as json", "as csv", "do not use", "avoid using",
  "senza", "almeno", "al massimo", "esattamente", "assicurati", "vincolo",
];

// Cheap / mechanical tasks a small model handles well — lower the bar.
const SIMPLE_TASK_WORDS = [
  "translate", "translation", "summarize", "summarise", "summary", "tl;dr", "tldr",
  "shorten", "condense", "recap", "rephrase", "paraphrase", "reword", "rewrite",
  "proofread", "spell check", "fix grammar", "correct the", "extract", "list all",
  "pull out", "reformat", "convert to", "format as", "classify", "categorize",
  "categorise", "label", "sentiment", "transcribe", "capitalize",
  // Multi-word forms avoid firing on common English ("sort of", "count on me").
  "anonymize", "redact", "deduplicate", "dedupe", "ocr", "alphabetize",
  "lowercase", "uppercase", "count the", "sort the", "reorder", "merge",
  "traduci", "riassumi", "riassunto", "correggi", "estrai", "elenca",
];

// Explicit brevity requests — small output, low capability need. Only cues that
// unambiguously mean a TRIVIAL output. Style/tone words ("concise", "briefly",
// "in short") are deliberately excluded: they appear all the time in serious
// prompts ("write a concise summary of this contract") without making the task
// brief, so they caused false dampening.
const BREVITY_CUES = [
  "in one word", "one word", "one sentence", "short answer", "just the answer",
  "yes or no", "true or false", "tl;dr", "quick answer",
  "in una parola", "sì o no", "si o no",
];

// Cues that the user wants a long, effortful output — raises the output-token
// estimate (used for cost preview only, not the complexity score).
const LONGFORM_RE =
  /\b(essay|report|article|blog post|guide|tutorial|detailed|comprehensive|in[- ]depth|thorough|elaborate|deep dive|white ?paper|full explanation|walk me through)\b/i;

// Whole-word (Unicode-aware) matching so "sum" doesn't fire on "summary" or
// "tax" on "syntax". A small set of inflectional suffixes is tolerated on the
// right (reason→reasoning/reasons) but only for needles long enough (>=4 chars)
// that the suffix can't accidentally swallow a different word. Multi-word
// phrases and accented Italian keywords still match. `haystack` is pre-lowercased.
function countMatches(haystack: string, needles: string[]): { count: number; hits: string[] } {
  const hits: string[] = [];
  for (const n of needles) {
    const esc = n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const suffix = n.length >= 4 && !n.includes(" ") ? "(?:s|es|ed|ing|d)?" : "";
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${esc}${suffix}(?![\\p{L}\\p{N}])`, "u");
    if (re.test(haystack)) hits.push(n);
  }
  return { count: hits.length, hits };
}

// Saturating map: n occurrences -> 0..1, reaching 1 around `full`.
function saturate(n: number, full: number): number {
  if (n <= 0) return 0;
  return Math.min(1, n / full);
}

// --- code -----------------------------------------------------------------
function detectCode(text: string): { signal: number; evidence: string } {
  const codeFence = /```/.test(text);
  const codeTokens = (
    text.match(
      /\b(function|def|class|import|const|let|var|return|public|private|void|async|await|enum|struct|SELECT|FROM|WHERE|JOIN|INSERT|UPDATE|DELETE|for\s*\(|while\s*\()\b/g,
    ) || []
  ).length;
  // Symbol *density* (per 100 chars), not an absolute count — prose that merely
  // contains a few parentheses shouldn't read as code, but a short snippet with
  // heavy punctuation should.
  const symbolCount = (text.match(/[{}[\]();=<>]|=>|::|->|&&|\|\||!==?/g) || []).length;
  const density = text.length ? (symbolCount / text.length) * 100 : 0;
  const askedToCode =
    /\b(code|coding|debug|refactor|implement|compile|compiler|function|bug|stack trace|regex|sql|query|database|schema|endpoint|algorithm|api|typescript|python|javascript|java|rust|kotlin|golang|docker|kubernetes|terraform|npm|git|backend|frontend|dependency|unit test|null pointer|segfault|runtime error|codice|programma|funzione|errore|algoritmo)\b/i.test(
      text,
    );

  let signal = 0;
  const reasons: string[] = [];
  if (codeFence) { signal += 0.6; reasons.push("code block"); }
  if (codeTokens > 0) { signal += Math.min(0.4, codeTokens * 0.1); reasons.push(`${codeTokens} code keywords`); }
  if (density > 4) { signal += Math.min(0.25, (density - 4) * 0.05); reasons.push("dense symbols"); }
  if (askedToCode) { signal += 0.35; reasons.push("programming intent"); }

  return {
    signal: Math.min(1, signal),
    evidence: reasons.length ? reasons.join(", ") : "no code signals",
  };
}

// --- math ------------------------------------------------------------------
// Precision: bare numbers are weak evidence and are actively scrubbed of
// years, dates, times, versions/IPs and long IDs before counting, so "the 2024
// report on 12/03 at 15:30" contributes nothing. Real arithmetic (operators
// between numbers, decimals, fractions, %, currency) is the strong signal.
function detectMath(prompt: string, lower: string): { signal: number; evidence: string } {
  const kw = countMatches(lower, MATH_WORDS);

  // Scrub non-computational number patterns FIRST, then look for arithmetic on
  // the cleaned text — so "12/03" (a date) isn't read as a fraction and "2024"
  // isn't read as an operand. Versions need >=2 dots (1.2.3) so plain decimals
  // like "3.5" survive as real numbers.
  const scrubbed = prompt
    .replace(/\b\d+(?:[-.\s]\d+){2,}\b/g, " ") // phone / ID digit groups: 800-493-1740
    .replace(/\b(?:19|20)\d{2}\b/g, " ") // years
    .replace(/\b\d{1,2}[:h]\d{2}\b/g, " ") // times
    .replace(/\b\d{1,2}[/.\-]\d{1,2}(?:[/.\-]\d{2,4})?\b/g, " ") // dates
    .replace(/\bv?\d+(?:\.\d+){2,}\b/g, " ") // versions / IPs (x.y.z)
    .replace(/\b\d{5,}\b/g, " "); // long IDs / zips

  const arithmetic = (
    scrubbed.match(/\d+\s*[-+*/^×÷]\s*\d+|\b\d+[.,]\d+\b|\d+\s*%|[$€£]\s*\d+|\b\d+\s*=\s*\d/g) || []
  ).length;
  const plainNums = (scrubbed.match(/\b\d+(?:[.,]\d+)?\b/g) || []).length;

  // Bare numbers are weak, noisy evidence — a call transcript is full of times,
  // amounts and digits. They only AMPLIFY math when an explicit math keyword is
  // present; on their own they never create a math signal.
  const numFactor = kw.count > 0 ? saturate(plainNums, 12) * 0.25 : 0;
  const signal = Math.min(
    1,
    saturate(kw.count, 2) * 0.7 + saturate(arithmetic, 3) * 0.6 + numFactor,
  );

  const parts: string[] = [];
  if (kw.count) parts.push(`kw: ${kw.hits.slice(0, 3).join(", ")}`);
  if (arithmetic) parts.push(`${arithmetic} arithmetic exprs`);
  if (plainNums) parts.push(`${plainNums} numbers`);
  return { signal, evidence: parts.length ? parts.join("; ") : "none" };
}

// --- structure / multi-step / constraints ----------------------------------
// Precision: the count of "?" is NOT used — an FAQ or a list of questions isn't
// inherently complex. Signal comes from genuine ordering (sequence cues, an
// enumerated list of instructions) and explicit constraints on the answer.
function detectStructure(prompt: string, lower: string): { signal: number; evidence: string } {
  const listItems = (prompt.match(/^\s*(?:[-*•]|\d+[.)])\s+\S/gm) || []).length;
  const seq = countMatches(lower, SEQUENCE_CUES);
  const constraints = countMatches(lower, CONSTRAINT_CUES);

  const signal = Math.min(
    1,
    saturate(listItems, 4) * 0.45 + saturate(seq.count, 2) * 0.4 + saturate(constraints.count, 3) * 0.45,
  );
  return {
    signal,
    evidence: `${listItems} list items, ${seq.count} sequencing, ${constraints.count} constraint cues`,
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
    const points = Math.round(signal * weight * 10) / 10;
    contributions.push({ key, label, signal, weight, points, evidence });
  };

  // --- hard-skill signals (computed first; aggregated with group discount) ---
  const code = detectCode(prompt);

  const reasoning = countMatches(lower, REASONING_WORDS);
  const reasoningSignal = saturate(reasoning.count, 3);

  const math = detectMath(prompt, lower);

  // Rank the three correlated hard skills and discount the weaker ones so a
  // multi-skill prompt doesn't triple-count. Ranking is by raw (signal*weight).
  const hard = [
    { key: "code", label: "Code / programming", signal: code.signal, base: WEIGHTS.code, evidence: code.evidence },
    {
      key: "reasoning",
      label: "Reasoning required",
      signal: reasoningSignal,
      base: WEIGHTS.reasoning,
      evidence: reasoning.count ? `keywords: ${reasoning.hits.slice(0, 4).join(", ")}` : "none",
    },
    { key: "math", label: "Math / logic", signal: math.signal, base: WEIGHTS.math, evidence: math.evidence },
  ];
  const rankOrder = [...hard].sort((a, b) => b.signal * b.base - a.signal * a.base);
  const discountFor = new Map<string, number>();
  rankOrder.forEach((h, i) => {
    discountFor.set(h.key, HARD_SKILL_DISCOUNTS[i] ?? HARD_SKILL_DISCOUNTS[HARD_SKILL_DISCOUNTS.length - 1]);
  });
  for (const h of hard) {
    const discount = discountFor.get(h.key) ?? 1;
    const effWeight = Math.round(h.base * discount * 10) / 10;
    const note = discount < 1 && h.signal > 0 ? ` (×${discount} overlap)` : "";
    add(h.key, h.label, h.signal, effWeight, h.evidence + note);
  }

  const hasHardSignals = code.signal > 0.3 || math.signal > 0.3 || reasoning.count >= 2;

  // --- structure / multi-step / constraints ---
  const structure = detectStructure(prompt, lower);
  add("structure", "Structure / constraints", structure.signal, WEIGHTS.structure, structure.evidence);

  // --- length / context ---
  const tokens = estimateTokens(prompt);
  const lengthSignal = saturate(tokens, 1500); // ~1500 tokens -> full
  add("length", "Input length", lengthSignal, WEIGHTS.length, `~${tokens} tokens`);

  // --- critical domain (gated) ---
  // A domain word alone isn't a high-stakes *task* — "what is GDPR?" is trivia.
  // The full floor applies only with a decision/advice cue, reasoning, or a
  // non-trivial length; otherwise it's damped to a fraction.
  const critical = countMatches(lower, CRITICAL_DOMAIN_WORDS);
  const criticalContext = countMatches(lower, CRITICAL_CONTEXT_CUES);
  const criticalHasContext = criticalContext.count > 0 || reasoning.count > 0 || tokens > 120;
  const criticalSignal = saturate(critical.count, 2) * (criticalHasContext ? 1 : 0.35);
  add(
    "criticalDomain",
    "High-stakes domain",
    criticalSignal,
    WEIGHTS.criticalDomain,
    critical.count
      ? `domain: ${critical.hits.slice(0, 3).join(", ")}${criticalHasContext ? "" : " (mention only)"}`
      : "none",
  );

  // --- creativity (dampener) — only when purely creative ---
  const creative = countMatches(lower, CREATIVE_WORDS);
  const creativeSignal = hasHardSignals || critical.count ? 0 : saturate(creative.count, 1);
  add(
    "creativity",
    "Open creative writing",
    creativeSignal,
    WEIGHTS.creativity,
    creative.count ? `creative task: ${creative.hits.slice(0, 3).join(", ")}` : "none",
  );

  // --- simple / mechanical task (dampener) — new ---
  // Translation, summarization, extraction, reformatting, classification: a
  // small model does these well. Damp only when no hard skill or high-stakes
  // domain competes (summarizing a contract for legal risk is NOT simple).
  const simple = countMatches(lower, SIMPLE_TASK_WORDS);
  const simpleSignal = hasHardSignals || critical.count ? 0 : saturate(simple.count, 1);
  add(
    "simpleTask",
    "Mechanical task",
    simpleSignal,
    WEIGHTS.simpleTask,
    simple.count ? `cheap task: ${simple.hits.slice(0, 3).join(", ")}` : "none",
  );

  // --- brevity (dampener) — new ---
  // Only a genuinely short, simple ask ("answer in one word") should damp. A
  // brevity cue buried in a long, structured spec — "concise yet comprehensive"
  // in a summarization task, or "yes or no" as an extraction FIELD — is part of
  // the task, not a request for a trivial answer, so it's suppressed.
  const brevity = countMatches(lower, BREVITY_CUES);
  const substantialTask = hasHardSignals || structure.signal > 0.3 || tokens > 200;
  const brevitySignal = substantialTask ? 0 : saturate(brevity.count, 1);
  add(
    "brevity",
    "Brevity requested",
    brevitySignal,
    WEIGHTS.brevity,
    brevity.count
      ? substantialTask
        ? `mention only: ${brevity.hits.slice(0, 2).join(", ")} (task isn't brief)`
        : `short output: ${brevity.hits.slice(0, 2).join(", ")}`
      : "none",
  );

  // --- aggregate ---
  const rawScore = contributions.reduce((sum, c) => sum + c.points, 0);
  const score = Math.max(0, Math.min(100, Math.round(rawScore)));
  const rawTier = tierForScore(score);

  // --- output-token estimate (cost preview only; task-aware) ---
  const estOutputTokens = estimateOutputTokens(prompt, tokens, {
    brevity: brevitySignal > 0,
    // Ungated: a summary/extraction compresses even when the task also needs
    // reasoning, so the output estimate should shrink regardless of the score.
    summarize: simple.count > 0,
    creative: creativeSignal > 0,
  });

  return {
    score,
    rawTier,
    contributions,
    estInputTokens: tokens,
    estOutputTokens,
  };
}

// Output length is impossible to know pre-call, but the ask usually signals it:
// brevity requests are tiny, mechanical tasks scale with the input, long-form
// requests are large. This only affects the cost preview, never the score.
function estimateOutputTokens(
  prompt: string,
  inputTokens: number,
  flags: { brevity: boolean; summarize: boolean; creative: boolean },
): number {
  let est: number;

  // An explicit output limit in the prompt is the strongest signal and wins:
  // "300 words or fewer", "in 150 words", "one sentence". Words -> tokens ~x1.4.
  const wordLimit = prompt.match(/\b(\d{2,4})\s*words?\b/i);
  const sentenceLimit = /\b(?:one|1|two|2|a few)\s+sentences?\b/i.test(prompt);

  if (wordLimit) {
    est = Math.round(Number(wordLimit[1]) * 1.4);
  } else if (flags.brevity) {
    est = 60;
  } else if (sentenceLimit) {
    est = 90;
  } else if (flags.summarize) {
    // Summaries / extractions compress: the output is a fraction of the input,
    // never larger — even for a big transcript.
    est = Math.round(Math.min(inputTokens * 0.5, 700));
  } else if (flags.creative || LONGFORM_RE.test(prompt)) {
    est = Math.round(inputTokens * 1.5 + 400);
  } else {
    est = Math.round(inputTokens * 1.2);
  }
  return Math.max(40, Math.min(2000, est));
}
