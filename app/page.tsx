"use client";

import { useEffect, useRef, useState } from "react";
import type { RouteResult } from "@/lib/types";
import { MODEL_CATALOG, NICE_DEFAULT_ID } from "@/lib/config";

// Shape returned by /api/answer — one real Bedrock answer per model, with a
// per-model error field so one failure never blanks the other column.
interface OneAnswer {
  modelId: string;
  text?: string;
  usage?: { inputTokens: number; outputTokens: number; totalTokens: number };
  latencyMs?: number;
  bedrockModelId?: string;
  error?: string;
}
interface AnswersResult {
  selected: OneAnswer;
  niceDefault: OneAnswer;
}

// Sentinel shown in the dropdown when the user has typed a custom prompt that
// doesn't match any example.
const CUSTOM_LABEL = "✎ Custom prompt";

// Example prompts are organized as four real NICE Enlighten product areas
// (Intent & Triage, Summarization & Agent Assist, Data & Insights, Quality &
// Coaching), each with an Easy / Medium / Hard rung so the difficulty ladder is
// explicit inside every category.
type ExampleGroup = "intent" | "summary" | "data" | "quality" | "demo";
const EXAMPLE_GROUPS: { key: ExampleGroup; label: string }[] = [
  { key: "demo", label: "🧪 Demo Prompts" },
  { key: "intent", label: "🧭 Intent & Triage" },
  { key: "summary", label: "📝 Summarization & Agent Assist" },
  { key: "data", label: "📊 Data & Insights" },
  { key: "quality", label: "🎯 Quality & Coaching" },
];

// Each example carries a `baselineId` — the catalog model that best matches the
// model NICE runs this task on in production today (see illum-prompt-templates
// modelConfiguration). Selecting an example sets the "NiCE Default (baseline)"
// dropdown to it, so the savings/quality comparison is against real current
// spend. Contact-center text tasks standardize on Claude Sonnet 4.5 as their
// production baseline. The prompts reuse the actual NICE template instructions
// where noted.
const EXAMPLES: { label: string; group: ExampleGroup; baselineId: string; algos?: string[]; prompt: string }[] = [
  // ——— Intent & Triage ———
  {
    // Real: Orchestration-IsRequestingInformationPromptClaude (prod Claude 4.5 Haiku).
    group: "intent",
    label: "🟢 Easy — KB lookup needed? (Orchestration)",
    baselineId: "claude-haiku-4.5",
    prompt: `You are an AI assistant analyzing customer service transcripts. Determine if the customer's last message requires information from a knowledge base (specific processes, services, policies, procedures, or product information).

Customer's last message:
"Do you cover water damage from a burst pipe under my home policy?"

Output a single word: "True" if knowledge base information is needed, "False" if not.`,
  },
  {
    // Real: ConversationManager-IdentifyQuestionIntent (prod Claude Sonnet 4.5).
    group: "intent",
    label: "🟡 Medium — Classify question intent (Conversation Manager)",
    baselineId: "claude-sonnet-4.5",
    prompt: `You are an intent classifier for contact center questions. Identify the intent ONLY — do not answer it. Output only a JSON object.

Supported intents:
- DataQuery: raw data, metrics, trends, summaries, performance insights.
- AutomationOpportunityData: automation opportunities, ROI-based prioritization.
- AugmentationOpportunityData: mid-tier/copilot improvement, task impact, agent variance; ROI, forecasting, prioritization.
- AutomationWorkflow: requests to create AI agents or automated workflows.
- Unidentified: anything else or outside the contact center domain.

Response format: {"intentIdentified": true|false, "intentType": "..."}

Question to classify: "Which intents should we prioritize automating next quarter to cut the most cost?"`,
  },
  {
    // Reasoning-heavy disambiguation (prod Claude Sonnet 4.5).
    group: "intent",
    label: "🔴 Hard — Disambiguate a multi-intent request",
    baselineId: "claude-sonnet-4.5",
    prompt: `A customer wrote one message that mixes several requests. Determine the customer's PRIMARY goal, list every distinct intent you detect, flag which are actionable now vs. need follow-up, and explain your reasoning step by step.

Message:
"Hi — my invoice this month is higher than last month and I don't understand why, also I still haven't received the refund your colleague promised me two weeks ago, and while I have you, can you switch my plan to the annual one but only if it actually works out cheaper given the refund you owe me?"`,
  },

  // ——— Summarization & Agent Assist ———
  {
    // Real: knowledgeGenerator-GenerateTranscriptSummary (prod Claude Sonnet 4.5).
    group: "summary",
    label: "🟢 Easy — Summarize a short call (Knowledge Generator)",
    baselineId: "claude-sonnet-4.5",
    prompt: `You are an AI assistant to contact center agents, helping summarize their calls. Below is a transcript between an agent and a customer. Generate a short summary, maximum 3 sentences, focusing on the issue the customer faced. Do not add any text besides the summary.

Transcript:
Agent: Thanks for calling, how can I help?
Customer: My internet has been dropping every few minutes since this morning.
Agent: I've restarted your line remotely and pushed a firmware update to your router.
Customer: It seems stable now.
Agent: Great — if it drops again, reply to the text I just sent and we'll send a technician.`,
  },
  {
    // Real instruction (GenerateTranscriptSummary) over a full call → length lifts the tier.
    group: "summary",
    label: "🟡 Medium — Summarize full call + list actions",
    baselineId: "claude-sonnet-4.5",
    prompt: `You are an AI assistant to contact center agents. Summarize this call in 3–4 sentences, then list every concrete action the agent took as bullet points.

Transcript:
Agent: Thank you for calling Voyager, this is Darrell. How can I help?
Customer: Hi, I need to follow up on a refund. My membership is VR-[MASKED].
Agent: Thank you — I have the account under Margaret Roberts. Let me pull up booking BK-[MASKED].
Customer: Yes, that's the one. How much will be refunded?
Agent: The refundable amount is $308 based on the fare class and cancellation timing. Refunds take 7–10 business days to the original payment method.
Customer: Okay. And why did nobody call me back like they promised?
Agent: That's fair, and I don't have a clean answer. I'm filing this as a service failure and a senior agent will follow up — by phone, not just email.
Customer: Also, can you set my meal preference to gluten-free going forward?
Agent: Done — it applies to all future bookings. For your upcoming trip I've pushed it to the airline manually; you'll get confirmation within 24 hours.
Customer: Great, thank you.
Agent: I've submitted the refund now and added a note to your account. The reference is CFO-[MASKED].`,
  },
  {
    // Real: BotBuilder-GenerateHandoverSummary (prod Claude Sonnet 4.5).
    group: "summary",
    label: "🔴 Hard — Escalation handover summary (Bot Builder)",
    baselineId: "claude-sonnet-4.5",
    prompt: `You are a conversation-analysis AI that writes handover summaries for escalated bot→human conversations, so an agent can seamlessly continue. You receive the transcript as JSON with a "conversation" array of {client, bot} turns.

Capture: key context, actions the bot performed, unresolved customer requests, and any risks or dependencies (tag teams like Reporting / API / Studio / Admin if relevant). Return a single JSON object: {"HandoverSummary": "..."}.

Conversation:
{"conversation":[
  {"client":["I was double charged for my subscription this month."],"bot":["I'm sorry about that. Can you confirm the email on the account?"]},
  {"client":["jo@example.com"],"bot":["Thanks. I can see two charges on the 3rd. I've opened a billing case and flagged it to the payments team."]},
  {"client":["I also can't log in on the mobile app."],"bot":["The login issue looks like a known outage; I couldn't resolve it, escalating to a human agent now."]}
]}`,
  },

  // ——— Data & Insights ———
  {
    // Math-dominant → routes to a cheap math specialist (Qwen) below the general baseline.
    group: "data",
    label: "🟢 Easy — Average handle time",
    baselineId: "claude-haiku-4.5",
    prompt: `Calculate the average handle time (AHT) from these five calls and give the result in mm:ss:
4:12, 5:30, 3:45, 6:01, 4:48.
Show the total and the average.`,
  },
  {
    // Inspired by DataQuery-GenerateSqlClaudePrompt (prod Claude Sonnet 4.5); code-dominant.
    group: "data",
    label: "🟡 Medium — Generate SQL from a question (Data Query)",
    baselineId: "claude-sonnet-4.5",
    prompt: `You generate ANSI SQL for a contact-center analytics database. Use ONLY this schema:
calls(id, agent_id, reason, handle_time_sec, csat, created_at)
agents(id, name, team)

Question: For the last 30 days, return the top 10 contact reasons by call volume, with their average handle time (in minutes) and average CSAT. Order by volume descending.

Return ONLY the SQL query — no explanation.`,
  },
  {
    // Real: AnomalyDetection-InsightsGenerator (prod Claude Sonnet 4.5).
    group: "data",
    label: "🔴 Hard — Explain an anomaly from metrics (Anomaly Detection)",
    baselineId: "claude-sonnet-4.5",
    prompt: `You are a contact center analytics expert. You are given exact pre-computed values — use them as-is. Write a direct 1–3 sentence insight that answers the question. Start with the finding; never open with "based on" or "the data shows". Report Voice and Chat separately when present. Return only JSON: {"insight":"..."}.

Question: What drove the spike in anomalies last week?
Data:
{ "total_anomalies": 41, "by_channel": {"Voice": 29, "Chat": 12},
  "by_week_peak": "2026-W28", "by_week_peak_count": 41,
  "by_metric_peak": "AbandonRate", "by_metric_peak_count": 18,
  "top_driver": "AbandonRate", "deviation_vs_baseline_pct": 63 }
Record mode: false`,
  },

  // ——— Quality & Coaching ———
  {
    // Simple compliance check (QM AutoScore-Profile prod Nova Pro) → routes cheaper.
    group: "quality",
    label: "🟢 Easy — Compliance check: greet & verify",
    baselineId: "nova-pro",
    prompt: `For this call opening, answer two compliance checks with Yes/No and the exact supporting quote:
1) Did the agent greet the customer?
2) Did the agent verify the customer's identity before discussing the account?

Transcript:
Agent: Good morning, thanks for calling Acme Support, this is Priya.
Customer: Hi, I want to check my account balance.
Agent: I can help. Can you confirm your full name and date of birth first?
Customer: Sure, Jordan Lee, 5th of March 1990.
Agent: Thank you, Jordan — you're verified.`,
  },
  {
    // Reasoning-dominant scoring (QM AutoScore prod Claude Sonnet 4.5).
    group: "quality",
    label: "🟡 Medium — Score empathy with quotes",
    baselineId: "claude-sonnet-4.5",
    prompt: `Score this call from 1–10 on agent empathy. Provide the score, two direct quotes that justify it, and one specific coaching tip.

Transcript:
Customer: I've called three times about this and nobody has fixed it. I'm exhausted.
Agent: I hear you, and I'm sorry you've had to call again — that's genuinely frustrating. Let me own this personally and stay on the line until it's resolved.
Customer: Okay… thank you.
Agent: I've applied the fix and added a note so you won't have to re-explain if you ever call back.`,
  },
  {
    // Real: QualityManagement-AutoScore-V1 (prod Claude Sonnet 4.5). High-stakes.
    group: "quality",
    label: "🔴 Hard — Multi-profile QA autoscore (Quality Management)",
    baselineId: "claude-sonnet-4.5",
    prompt: `You are an expert customer-service evaluation AI. Analyze the transcript against the evaluation profiles. For each profile give: score (1–10), confidence (0.0–1.0), status ("issue" <6 / "meeting" 6–8 / "exceeding" >8), reasoning with transcript evidence, 2–3 quote highlights, and isNA if it doesn't apply. Then give an overall score (1–10) and a 2–3 sentence executive summary. Return only valid JSON.

Evaluation Profiles:
- Greeting & Identity Verification
- Empathy & Tone
- Compliance (no sensitive data read back)
- Resolution & Next Steps

Transcript:
Agent: Thanks for calling, this is Sam. Can you confirm your name and postcode?
Customer: Dana Prince, SW1A 1AA.
Agent: Thank you. I see your card was charged twice — I'm sorry about that.
Customer: Yes, it's really annoying.
Agent: Completely understand. I've refunded the duplicate charge; it'll appear in 3–5 days. I've emailed you a confirmation and a reference number.
Customer: Great, thanks.
Agent: Anything else? … Take care, Dana.`,
  },

  // ——— Demo Prompts (one per routing algorithm the app supports) ———
  {
    // "Learned" / recall: matches a stored prompt in the recall DB
    // (lib/matcher-db.json → gemma-3-27b), so the model is recalled from history
    // with no computation. algos pinned to ["recall"] to isolate the effect.
    group: "demo",
    label: "🧠 Learned — recalled from history",
    baselineId: "claude-sonnet-4.5",
    algos: ["recall"],
    prompt: `Write a SQL query for the following user request: Find the top 10 agents by CSAT`,
  },
  {
    // "Metadata-Based" / signals: transparent keyword + metadata scoring, no LLM
    // call. High-stakes + reasoning + math + multi-step signals drive the score.
    // algos pinned to ["signals"] to show the pure metadata path.
    group: "demo",
    label: "📊 Metadata-Based — transparent rules",
    baselineId: "claude-sonnet-4.5",
    algos: ["signals"],
    prompt: `A high-value customer disputes a $2,400 credit-card chargeback. Assess the fraud risk and financial-compliance exposure, weigh the evidence, then recommend whether to approve the refund or escalate to the fraud team — and explain your reasoning step by step.

Customer: "J. Martins," account age 4 years 2 months
Tier: High-value / Platinum (avg monthly spend $3,100, lifetime spend ~$148,000)
Prior chargebacks: 0 in 4 years
Prior disputes resolved amicably (2, both merchant-error refunds, no chargeback filed)

Disputed Transaction

Amount: $2,400
Merchant: "Aurora Home Furnishings" (physical goods, custom order)
Date of charge: June 2, 2026; dispute filed: July 10, 2026 (38 days later)
Card-present or card-not-present: Card-not-present (online order)
Delivery status: Merchant's system shows "delivered," signature captured
Customer's claim: "Never received the item; signature isn't mine"

Device & Behavioral Signals

Transaction originated from a device/IP consistent with customer's usual login history
No new shipping address added to account in prior 90 days
No password reset, email change, or new device enrollment near time of purchase
Billing address matches shipping address on file

Merchant-Side Evidence

Merchant provided: order confirmation, delivery carrier tracking, photo of package at doorstep, signature image
Signature image is illegible/scrawled (common for doorstep delivery, low evidentiary value)
No photo ID was checked at delivery (standard for this merchant's process)

Compliance Flags

Regulation: Reg E / Reg Z depending on card network rules (assume Visa credit card → Reg Z / card network chargeback rules apply, not Reg E)
Card network chargeback reason code: 13.1 (Merchandise/Services Not Received)
Bank's internal SLA: provisional credit decision due within 10 business days of dispute filing
No OFAC/sanctions flags, no prior fraud-ring linkage on this account`,
  },
  {
    // "Judged" / verdict: a cheap LLM scores complexity up front. This looks
    // trivial to the keyword scorer but hides a reasoning trap, so the judge
    // raises the score. algos pinned to ["verdict"]. Needs Bedrock creds; falls
    // back to the metadata score if the judge call fails.
    group: "demo",
    label: "⚖️ Judged — an LLM scores complexity",
    baselineId: "claude-sonnet-4.5",
    algos: ["verdict"],
    prompt: `A customer insists they were double-charged, but I see two different amounts on the same day: $30.00 and $30.50. Is this one duplicate charge or two separate transactions? Decide and explain briefly.`,
  },
  {
    // "Timing" / tempo: prices flex-capable models at the 50% flex rate when
    // there's latency headroom — the comparison table shows the FLEX −50%
    // discount on flex-capable models. algos → ["tempo"].
    group: "demo",
    label: "⏱️ Timing — flex pricing on latency headroom",
    baselineId: "nova-pro",
    algos: ["tempo"],
    prompt: `You are an evaluator comparing two auto-generated text summaries to determine how semantically and structurally similar they are.

Summary A (Auto-Generated):
"The quarterly sales report shows a 12% increase in revenue compared to last quarter, driven primarily by strong performance in the North American market. Customer retention improved slightly, while operating costs remained stable."

Summary B (Agent-Populated):
"Revenue rose by 12% this quarter versus the previous one, mainly due to solid results in North America. Customer retention saw a small improvement, and operating costs stayed steady."

Task:
Evaluate how similar Summary A and Summary B are. Consider the following dimensions:
1. Semantic similarity (do they convey the same meaning/facts?)
2. Structural similarity (sentence order, organization)
3. Key data point consistency (numbers, percentages, named entities)
4. Any omissions, additions, or contradictions between the two

Provide:
- An overall similarity score (0–100%)
- A short explanation for the score
- A list of any discrepancies found (if none, state "No discrepancies found")`,
  },
];

// The three cost/quality stances the user can pick. Each maps to a qualityPref
// (0 / 50 / 100) that shifts the affinity floor: lower floor = cheaper models,
// higher floor = stronger (pricier) ones.
const COST_QUALITY_MODES: { pref: number; icon: string; label: string; desc: string }[] = [
  {
    pref: 0,
    icon: "💰",
    label: "Max savings",
    desc: "Always the cheapest model that can do the job. Stronger models only if you approve.",
  },
  {
    pref: 50,
    icon: "⚖️",
    label: "Balanced (Recommended)",
    desc: "Best value per task — low cost by default, a premium upgrade one click away.",
  },
  {
    pref: 100,
    icon: "🎯",
    label: "Quality first",
    desc: "Leans to stronger models, spending more when it measurably lifts the answer.",
  },
];

// Routing algorithms we use / will use. All shown active in this POC.
const ROUTING_ALGORITHMS: {
  id: string;
  title: string;
  subtitle: string;
  description: string;
  active: boolean;
}[] = [
  {
    id: "recall",
    title: "Learned",
    subtitle: "leverages existing data",
    description:
      "Chooses the model by looking at history: it finds the most similar past requests and routes to the cheapest model that gave a good answer back then.",
    active: true,
  },
  {
    id: "signals",
    title: "Metadata-Based",
    subtitle: "transparent rules on metadata",
    description:
      "Decides by applying transparent rules to the request's metadata (complexity, domain, customer, constraints), without ever calling an LLM.",
    active: true,
  },
  {
    id: "verdict",
    title: "Judged",
    subtitle: "uses an LLM to decide",
    description:
      "A small, cheap model assesses the difficulty of the request (or the quality of a first answer) and determines whether a more powerful model is needed.",
    active: true,
  },
  {
    id: "tempo",
    title: "Timing",
    subtitle: "AWS Bedrock Flex tier",
    description:
      "For latency-tolerant requests, routes to AWS Bedrock's Flex inference tier — the same models at roughly 50% lower cost in exchange for higher, best-effort latency. Picks the cheapest Flex-eligible model that still meets the response-time SLA.",
    active: true,
  },
];

// Long-form copy for the "Read more" about modal — the four strategies here
// mirror ROUTING_ALGORITHMS above, written for a reader who wants the full
// explanation rather than a one-line checkbox subtitle.
const ABOUT_STRATEGIES: { icon: string; title: string; body: string }[] = [
  {
    icon: "🧠",
    title: "Learned",
    body: "Learns from historical requests, routing similar prompts to the lowest-cost model that has consistently delivered high-quality results. The more it's used, the smarter it becomes.",
  },
  {
    icon: "📊",
    title: "Metadata-Based",
    body: "Uses transparent, deterministic rules based on request metadata such as complexity, domain, customer, or constraints. No LLM calls, zero inference cost, and near-zero latency.",
  },
  {
    icon: "⚖️",
    title: "Judged",
    body: "Invoked only when the previous routing stages cannot confidently select a low-cost model. A lightweight LLM evaluates the request—or the quality of an initial response—and determines whether escalation to a more capable model is actually necessary. This keeps LLM routing costs to a minimum while preserving accuracy.",
  },
  {
    icon: "⏱️",
    title: "Timing",
    body: "Sends latency-tolerant requests to AWS Bedrock's Flex inference tier, which serves the same models at roughly 50% lower cost in exchange for higher, best-effort latency. It selects the lowest-cost Flex-eligible model that still meets the required response-time SLA — savings without paying for unnecessary speed.",
  },
];

const TIER_LABEL: Record<number, string> = {
  1: "Economy",
  2: "Standard",
  3: "Premium",
};
const TIER_COLOR: Record<number, string> = { 1: "var(--green)", 2: "var(--amber)", 3: "var(--red)" };

// Task-affinity skills used to pick a specialist within a tier (see lib/router.ts).
type SkillKey = "code" | "reasoning" | "math" | "general";
const SKILL_META: Record<SkillKey, { label: string; icon: string }> = {
  code: { label: "Code", icon: "💻" },
  reasoning: { label: "Reasoning", icon: "🧩" },
  math: { label: "Math", icon: "🔢" },
  general: { label: "General", icon: "💬" },
};

// Simple clock icon — marks models priced at the flex ("Timing") rate.
function ClockIcon({ size = 12 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

// Small inline capability bar (0..1) — visualizes a model's affinity on a skill.
function CapBar({ value, highlight }: { value: number; highlight?: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, justifyContent: "flex-end" }}>
      <div style={{ width: 46, height: 6, background: "var(--panel-2)", borderRadius: 4, overflow: "hidden" }}>
        <div
          style={{
            width: `${Math.round(value * 100)}%`,
            height: "100%",
            background: highlight ? "var(--accent)" : "var(--border)",
          }}
        />
      </div>
      <span style={{ fontVariantNumeric: "tabular-nums", color: highlight ? "var(--text)" : "var(--muted)", width: 26, textAlign: "right" }}>
        {value.toFixed(2)}
      </span>
    </div>
  );
}

function usd(n: number): string {
  if (n === 0) return "$0";
  const a = Math.abs(n);
  if (a >= 0.01) return `$${n.toFixed(4)}`;
  // Sub-cent values (a single cheap call, e.g. Gemma 3 4B) would round to
  // $0.00000 at a fixed 5 decimals. Scale precision to the magnitude so the
  // figure stays visible, capped at 10 decimals.
  const digits = Math.min(10, Math.max(5, Math.ceil(-Math.log10(a)) + 2));
  return `$${n.toFixed(digits)}`;
}

// Parse a fetch response as JSON, but fail with a readable message when the
// server returns HTML instead (e.g. an AWS WAF block page). Without this the
// browser throws the cryptic "Unexpected token '<' … is not valid JSON".
async function readJson(res: Response) {
  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    await res.text().catch(() => "");
    if (res.status === 403) {
      throw new Error(
        "Request blocked (HTTP 403) — likely the AWS WAF firewall. A large prompt can exceed the 8 KB body limit (SizeRestrictions_BODY rule).",
      );
    }
    throw new Error(`Unexpected ${res.status} response (not JSON).`);
  }
  return res.json();
}

const panel: React.CSSProperties = {
  background: "var(--panel)",
  border: "1px solid var(--border)",
  borderRadius: 12,
};

// Shared control tokens — one label style, one field style, so every input on
// the screen shares the same type, radius, and rhythm (8px system).
const fieldLabel: React.CSSProperties = {
  display: "block",
  fontSize: 13,
  fontWeight: 600,
  color: "var(--text)",
  marginBottom: 8,
};
const fieldControl: React.CSSProperties = {
  width: "100%",
  background: "var(--panel)",
  color: "var(--text)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  padding: "10px 12px",
  fontSize: 14,
};
// <select>-specific: white background (not the muted panel-2, which reads as
// "disabled") plus a custom chevron, since the browser-default arrow looks
// inconsistent once the native control styling is otherwise overridden.
const fieldSelect: React.CSSProperties = {
  ...fieldControl,
  paddingRight: 36,
  appearance: "none",
  WebkitAppearance: "none",
  MozAppearance: "none",
  backgroundImage:
    "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%235b6b85' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E\")",
  backgroundRepeat: "no-repeat",
  backgroundPosition: "right 12px center",
  backgroundSize: "16px",
  cursor: "pointer",
};
const sectionKicker: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  letterSpacing: 0.4,
  textTransform: "uppercase",
  color: "var(--muted)",
  marginBottom: 16,
};

export default function Home() {
  const [prompt, setPrompt] = useState(EXAMPLES[0].prompt);
  const [exampleLabel, setExampleLabel] = useState(EXAMPLES[0].label);
  const [standardId, setStandardId] = useState<string>(NICE_DEFAULT_ID);
  const [qualityPref, setQualityPref] = useState(50);
  // Which routing algorithms are selected. "recall" ("Learned") checks the
  // fuzzy-match history cache first; "verdict" ("Judged") runs a cheap LLM to
  // score complexity before value-based selection. Precedence: recall hit →
  // judge → metadata heuristic. "signals"/"tempo" are still cosmetic.
  const [selectedAlgos, setSelectedAlgos] = useState<string[]>(
    ROUTING_ALGORITHMS.filter((x) => x.active).map((x) => x.id),
  );
  const [hoveredAlgo, setHoveredAlgo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<RouteResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAbout, setShowAbout] = useState(false);
  // Real-answer feature: run the routed model + NICE Default via Bedrock.
  const [answers, setAnswers] = useState<AnswersResult | null>(null);
  const [answersLoading, setAnswersLoading] = useState(false);
  const [answersError, setAnswersError] = useState<string | null>(null);
  const hasResult = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const resultsAnchorRef = useRef<HTMLDivElement>(null);
  const scrollToResultsRef = useRef(false);

  // The example currently selected (if any) and the production model it maps to
  // — shown as a caption, and used to preset the baseline in pickExample.
  const selectedExample = EXAMPLES.find((e) => e.label === exampleLabel);
  const baselineModelName = selectedExample
    ? MODEL_CATALOG.find((m) => m.id === selectedExample.baselineId)?.displayName
    : undefined;

  // Selecting an example loads its prompt AND clears any prior results, so it's
  // obvious the results panel no longer reflects the current prompt.
  function pickExample(label: string) {
    const ex = EXAMPLES.find((e) => e.label === label);
    if (!ex) return;
    setPrompt(ex.prompt);
    setExampleLabel(label);
    // Preset the baseline to the model NiCE runs this task on in production, so
    // the savings/quality comparison reflects real current spend.
    setStandardId(ex.baselineId);
    // Demo prompts pin the specific algorithm they showcase; any other prompt
    // resets to the full (recommended) set of algorithms.
    setSelectedAlgos(ex.algos ?? ROUTING_ALGORITHMS.filter((x) => x.active).map((x) => x.id));
    setResult(null);
    setError(null);
    setAnswers(null);
    setAnswersError(null);
    hasResult.current = false; // don't auto re-route on quality/provider change
  }

  // Returns the fresh routing result on success (so callers can chain the
  // real-answer run off it without waiting for the result state to flush), or
  // null on error.
  async function runRoute(q = qualityPref): Promise<RouteResult | null> {
    setLoading(true);
    setError(null);
    // A new routing decision may pick a different model, so any prior real
    // answers no longer match — clear them.
    setAnswers(null);
    setAnswersError(null);
    try {
      const res = await fetch("/api/route", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, standardId, qualityPref: q, algos: selectedAlgos }),
      });
      const data = await readJson(res);
      if (!res.ok) throw new Error(data.error || "Request failed");
      setResult(data as RouteResult);
      hasResult.current = true;
      return data as RouteResult;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
      return null;
    } finally {
      setLoading(false);
    }
  }

  // Live re-route when a setting (cost/quality, standard, algorithms, judge
  // model) changes — only after a first run. Since a re-route can pick a
  // different model, the real answers no longer match, so we re-run them too:
  // the "Real model answers" section stays in sync instead of falling back to
  // "Not yet run". These are discrete dropdown/checkbox changes (no continuous
  // slider), so this is one re-run per change, not a burst.
  useEffect(() => {
    if (!hasResult.current) return;
    if (selectedAlgos.length === 0) return; // nothing to route with — keep the last result
    runRoute().then((r) => {
      if (r) fetchAnswers(r);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qualityPref, standardId, selectedAlgos]);

  // Jump to the results after an explicit "Route prompt" click (not on the
  // live re-route above, which happens while the user is still in settings).
  useEffect(() => {
    if (scrollToResultsRef.current && (result || error)) {
      resultsAnchorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      scrollToResultsRef.current = false;
    }
  }, [result, error]);

  // Run the real answers via Bedrock. Triggered automatically after an explicit
  // "Route prompt" click AND after any live setting change (so the section stays
  // in sync with the routed model), plus the manual "Re-run" button. Uses the
  // routed model + NICE Default from the given result (defaults to the latest).
  async function fetchAnswers(r: RouteResult | null = result) {
    if (!r) return;
    setAnswersLoading(true);
    setAnswersError(null);
    try {
      const res = await fetch("/api/answer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          selectedModelId: r.selected.model.id,
          defaultModelId: r.niceDefault.model.id,
        }),
      });
      const data = await readJson(res);
      if (!res.ok) throw new Error(data.error || "Request failed");
      setAnswers(data as AnswersResult);
    } catch (e) {
      setAnswersError(e instanceof Error ? e.message : "Error");
    } finally {
      setAnswersLoading(false);
    }
  }

  const a = result?.assessment;
  const sv = result?.savingsVsDefault;
  const qv = result?.qualityVsDefault;
  // "Timing" (tempo) enabled -> flex-capable models are priced at the 50% flex
  // discount, so the comparison table flags which rows got it.
  const timingOn = selectedAlgos.includes("tempo");
  // Routing needs at least one algorithm selected (Learned / Metadata / Judged /
  // Timing) — disable the "Route prompt" action when none are checked.
  const noAlgoSelected = selectedAlgos.length === 0;

  return (
    <>
      {/* Full-width dark logo bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          background: "#0a0f1c",
          borderBottom: "1px solid #1e2a44",
          padding: "10px 20px",
        }}
      >
        <img
          src="/sparkathon-logo.svg"
          alt="Sparkathon"
          height={28}
          style={{ height: 28, width: "auto", display: "block" }}
        />
      </div>

      <main style={{ maxWidth: 1100, margin: "0 auto", padding: "32px 20px 80px" }}>
      <header style={{ marginBottom: 24 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {/* Logo */}
          <img
            src="/logo.png"
            alt="Smarter Routing"
            width={36}
            height={36}
            style={{ width: 36, height: 36, flexShrink: 0 }}
          />
          <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
            <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>Better AI. Lower Cost. Smarter Routing.</h1>
            <span style={{ color: "var(--text)", fontSize: 15, fontWeight: 600 }}>
              Save up to 90% on AI costs—while getting better results.
            </span>
          </div>
        </div>
        <p style={{ color: "var(--muted)", marginTop: 10, fontSize: 14 }}>
          Before every AI request, Smarter Routing analyzes your prompt and automatically selects the
          best model for the job, balancing quality, speed, and cost in real time. Simple tasks go to
          efficient models, complex ones to the most capable  so you always get the right model at the
          lowest possible cost.
        </p>
        <p style={{ color: "var(--muted)", marginTop: 6, fontSize: 14 }}>
          Try the Model Router below with our sample prompts or enter your own and see the savings
          compared to the{" "}
          <strong style={{ color: "var(--text)" }}>NiCE Default</strong>{" "}
          <button
            onClick={() => setShowAbout(true)}
            style={{
              fontFamily: "inherit",
              background: "none",
              border: "none",
              padding: 0,
              color: "var(--accent)",
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
              textDecoration: "underline",
            }}
          >
            Read more
          </button>
        </p>
      </header>

      {showAbout && <AboutModal onClose={() => setShowAbout(false)} />}

      <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 24 }}>
        {/* MAIN CARD — one continuous flow: choose an example → OR → type
            your own → routing settings → primary CTA at the very end. */}
        <section style={{ ...panel, padding: 24 }}>
          {/* Step 1 — choose an example */}
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <label htmlFor="example-select" style={{ ...fieldLabel, marginBottom: 0, whiteSpace: "nowrap" }}>
              Choose a prompt example
            </label>
            <select
              id="example-select"
              value={exampleLabel}
              onChange={(e) => pickExample(e.target.value)}
              style={{ ...fieldSelect, flex: 1, minWidth: 200 }}
            >
              {exampleLabel === "" && (
                <option value="" disabled>
                  {CUSTOM_LABEL}
                </option>
              )}
              {EXAMPLE_GROUPS.map((g) => (
                <optgroup key={g.key} label={g.label}>
                  {EXAMPLES.filter((ex) => ex.group === g.key).map((ex) => (
                    <option key={ex.label} value={ex.label}>
                      {ex.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>

          {/* Step 2 — type your own prompt */}
          <div style={{ marginTop: 24 }}>
            <textarea
              id="prompt-textarea"
              ref={textareaRef}
              aria-label="Type your own prompt"
              value={prompt}
              onChange={(e) => {
                setPrompt(e.target.value);
                setExampleLabel(""); // typed prompt no longer matches an example
              }}
              onKeyDown={async (e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && prompt.trim() && !loading && !noAlgoSelected) {
                  e.preventDefault();
                  scrollToResultsRef.current = true;
                  const r = await runRoute();
                  if (r) fetchAnswers(r);
                }
              }}
              rows={5}
              placeholder="Type your prompt here…"
              style={{
                ...fieldControl,
                background: "var(--panel)",
                lineHeight: 1.5,
                resize: "vertical",
              }}
            />
          </div>

          {/* Section divider — separates the prompt from routing settings
              within the same card. */}
          <div style={{ borderTop: "1px solid var(--border)", margin: "24px 0" }} />

          {/* Cost vs quality + baseline — two related dropdowns, side by side. */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
              gap: 16,
              alignItems: "start",
            }}
          >
            <div>
              <label htmlFor="cost-quality-select" style={fieldLabel}>
                Cost vs quality Setting
              </label>
              <select
                id="cost-quality-select"
                value={qualityPref}
                onChange={(e) => setQualityPref(Number(e.target.value))}
                style={fieldSelect}
              >
                {COST_QUALITY_MODES.map((m) => (
                  <option key={m.pref} value={m.pref}>
                    {m.label}
                  </option>
                ))}
              </select>
              <p style={{ fontSize: 12, color: "var(--muted)", margin: "8px 0 0" }}>
                {COST_QUALITY_MODES.find((m) => m.pref === qualityPref)?.desc}
              </p>
            </div>

            <div>
              <label htmlFor="baseline-select" style={fieldLabel}>
                NiCE Default (baseline)
              </label>
              <select
                id="baseline-select"
                value={standardId}
                onChange={(e) => setStandardId(e.target.value)}
                title="The model NiCE would use by default — every routed choice is compared against it"
                style={fieldSelect}
              >
                {MODEL_CATALOG.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.displayName} — {TIER_LABEL[m.tier]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Routing algorithm — which strategy decides the model */}
          <div style={{ marginTop: 24 }}>
            <label style={fieldLabel}>Routing algorithm</label>
            <p style={{ fontSize: 12, color: "var(--muted)", margin: "-4px 0 12px" }}>
              Keeping all four selected is the recommended configuration — each stage only runs
              when the previous one isn't confident, so nothing extra is spent.
            </p>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                gap: 8,
              }}
            >
              {ROUTING_ALGORITHMS.map((algo) => {
                const checked = selectedAlgos.includes(algo.id);
                return (
                  <label
                    key={algo.id}
                    onMouseEnter={() => setHoveredAlgo(algo.id)}
                    onMouseLeave={() => setHoveredAlgo((h) => (h === algo.id ? null : h))}
                    style={{
                      position: "relative",
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "10px 12px",
                      borderRadius: 8,
                      border: "1px solid var(--border)",
                      background: "var(--panel)",
                      cursor: "pointer",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) =>
                        setSelectedAlgos((prev) =>
                          e.target.checked
                            ? [...prev, algo.id]
                            : prev.filter((id) => id !== algo.id),
                        )
                      }
                      style={{
                        width: 16,
                        height: 16,
                        accentColor: "var(--text)",
                        cursor: "pointer",
                        flexShrink: 0,
                      }}
                    />
                    <span style={{ lineHeight: 1.35 }}>
                      <span
                        style={{
                          display: "block",
                          fontSize: 13,
                          fontWeight: 600,
                          color: checked ? "var(--text)" : "var(--muted)",
                        }}
                      >
                        {algo.title}
                      </span>
                      <span style={{ display: "block", fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
                        {algo.subtitle}
                      </span>
                    </span>

                    {hoveredAlgo === algo.id && (
                      <div
                        style={{
                          position: "absolute",
                          bottom: "calc(100% + 8px)",
                          left: 0,
                          right: 0,
                          zIndex: 20,
                          background: "var(--panel)",
                          color: "var(--text)",
                          border: "1px solid var(--border)",
                          borderRadius: 8,
                          padding: "10px 12px",
                          fontSize: 12,
                          fontWeight: 400,
                          lineHeight: 1.5,
                          boxShadow: "0 4px 16px rgba(16,24,40,0.10)",
                        }}
                      >
                        {algo.description}
                      </div>
                    )}
                  </label>
                );
              })}
            </div>

          </div>

          {/* Route prompt — the primary action, at the very end of the flow */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "flex-end",
              gap: 12,
              marginTop: 24,
            }}
          >
            <button
              onClick={async () => {
                scrollToResultsRef.current = true;
                // Route, then immediately run both real models off the fresh
                // result so the user doesn't have to click twice.
                const r = await runRoute();
                if (r) fetchAnswers(r);
              }}
              disabled={loading || !prompt.trim() || noAlgoSelected}
              title={noAlgoSelected ? "Select at least one routing algorithm" : undefined}
              style={{
                background: loading || !prompt.trim() || noAlgoSelected ? "var(--panel-2)" : "var(--accent)",
                color: loading || !prompt.trim() || noAlgoSelected ? "var(--muted)" : "#ffffff",
                fontSize: 14,
                fontWeight: 600,
                border:
                  loading || !prompt.trim() || noAlgoSelected
                    ? "1px solid var(--border)"
                    : "1px solid var(--accent)",
                borderRadius: 8,
                padding: "10px 24px",
                cursor: loading || !prompt.trim() || noAlgoSelected ? "default" : "pointer",
              }}
            >
              {loading ? "Routing…" : "Route prompt"}
            </button>
          </div>
        </section>

        {(error || (result && a && sv && qv)) && (
          <div ref={resultsAnchorRef} style={{ display: "grid", gap: 24 }}>
            {error && (
              <div style={{ ...panel, padding: 14, borderColor: "var(--red)", color: "var(--red)" }}>
                {error}
              </div>
            )}

            {/* RESULTS */}
            {result && a && sv && qv && (
              <>
            {/* Decision summary */}
            <section style={{ ...panel, padding: 18 }}>
              <div style={{ display: "flex", gap: 24, alignItems: "center", flexWrap: "wrap" }}>
                <ScoreGauge score={result.adjustedScore} tier={result.effectiveTier} />
                <div style={{ flex: 1, minWidth: 240 }}>
                  <div style={{ fontSize: 13, color: "var(--muted)" }}>Router decision</div>
                  <div style={{ fontSize: 20, fontWeight: 700, marginTop: 2 }}>
                    → {result.selected.model.displayName}{" "}
                    <span style={{ fontSize: 13, color: TIER_COLOR[result.effectiveTier], fontWeight: 700 }}>
                      {TIER_LABEL[result.effectiveTier]}
                    </span>
                  </div>
                  {result.source === "recall" && result.recall ? (
                    // Recalled from the fuzzy-match history cache — a different
                    // provenance than the metadata scorer, so it gets its own badge
                    // instead of the "task affinity" narrative below.
                    <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <span
                        title="This model wasn't computed — it was recalled from a similar prompt seen before."
                        style={{
                          fontSize: 12,
                          fontWeight: 700,
                          color: "var(--green)",
                          border: "1px solid var(--green)",
                          background: "rgba(52,211,153,0.10)",
                          borderRadius: 999,
                          padding: "2px 10px",
                        }}
                      >
                        🔁 Learned: recalled from history
                      </span>
                      <span style={{ fontSize: 12, color: "var(--muted)" }} title={result.recall.matchedPrompt}>
                        {(result.recall.similarityScore * 100).toFixed(0)}% match to one of the known prompts
                      </span>
                    </div>
                  ) : (
                    /* Task affinity — which skill drove the specialist choice.
                       In "Judged" mode a cheap LLM scored the complexity up
                       front, so we prepend a badge crediting that verdict. */
                    <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      {result.source === "judge" && result.judge && (
                        <span
                          title={`A cheap model (${result.judge.modelName}) scored this prompt's complexity at ${result.judge.score}/100 before routing. ${result.judge.rationale}`}
                          style={{
                            fontSize: 12,
                            fontWeight: 700,
                            color: "var(--amber)",
                            border: "1px solid var(--amber)",
                            background: "rgba(251,191,36,0.10)",
                            borderRadius: 999,
                            padding: "2px 10px",
                          }}
                        >
                          ⚖️ Judged: {result.judge.score}/100 by {result.judge.modelName}
                        </span>
                      )}
                      <span
                        title="Dominant task detected from the prompt. Within the chosen tier the router picks the best-value model for this skill."
                        style={{
                          fontSize: 12,
                          fontWeight: 700,
                          color: "var(--accent)",
                          border: "1px solid var(--accent)",
                          background: "rgba(91,157,255,0.10)",
                          borderRadius: 999,
                          padding: "2px 10px",
                        }}
                      >
                        {SKILL_META[result.dominantSkill as SkillKey].icon} Task affinity:{" "}
                        {SKILL_META[result.dominantSkill as SkillKey].label}
                      </span>
                      <span style={{ fontSize: 12, color: "var(--muted)" }}>
                        picked as the best-value{" "}
                        {SKILL_META[result.dominantSkill as SkillKey].label.toLowerCase()} model in{" "}
                        {TIER_LABEL[result.effectiveTier]} (affinity{" "}
                        {result.selected.model.capabilities[result.dominantSkill as SkillKey].toFixed(2)})
                      </span>
                    </div>
                  )}
                  <div style={{ marginTop: 6, fontSize: 13, color: "var(--muted)" }}>
                    Est. cost {usd(result.selected.cost.totalCost)} · ~{a.estInputTokens} in / ~
                    {a.estOutputTokens} out tokens
                  </div>
                  <div style={{ marginTop: 4, fontSize: 12, color: "var(--muted)" }}>
                    {result.source === "judge" ? "judged complexity" : "raw complexity"} {a.score} · quality bias {result.qualityBias >= 0 ? "+" : ""}
                    {result.qualityBias} → adjusted {result.adjustedScore}
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <SavingsBadge absolute={sv.absolute} percent={sv.percent} />
                  <QualityBadge
                    delta={qv.delta}
                    relativePercent={qv.relativePercent}
                    retainedPercent={qv.retainedPercent}
                    savingsPercent={sv.percent}
                    skill={qv.skill}
                    selectedCap={qv.selectedCap}
                    defaultCap={qv.defaultCap}
                    defaultName={result.niceDefault.model.displayName}
                  />
                </div>
              </div>
            </section>

            {/* Comparison table */}
            <section style={{ ...panel, padding: 18 }}>
              <h2 style={{ fontSize: 15, fontWeight: 700, margin: "0 0 4px" }}>
                Cost comparison — all models for this prompt
              </h2>
              <p style={{ fontSize: 12, color: "var(--muted)", margin: "0 0 12px" }}>
                The <strong style={{ color: "var(--text)" }}>Skill fit</strong> column shows each
                model's affinity for the detected task ({SKILL_META[result.dominantSkill as SkillKey].icon}{" "}
                {SKILL_META[result.dominantSkill as SkillKey].label}). The router picks the{" "}
                <strong style={{ color: "var(--text)" }}>cheapest</strong> model whose affinity clears the
                task's floor ({result.affinityFloor.toFixed(2)}); stronger, pricier models are offered only
                as an approval-gated upgrade.
              </p>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ color: "var(--muted)", textAlign: "left" }}>
                      <th style={th}>Model</th>
                      <th style={th}>Provider</th>
                      <th style={th}>Class</th>
                      <th style={{ ...th, textAlign: "right" }}>
                        Skill fit ({SKILL_META[result.dominantSkill as SkillKey].label})
                      </th>
                      <th style={{ ...th, textAlign: "right" }}>Est. cost / call</th>
                      <th style={th}></th>
                      <th style={{ ...th, textAlign: "right" }}>vs Default</th>
                      <th style={th}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.catalog.map((c) => {
                      const { absolute: delta, percent: deltaPct } = c.vsDefault;
                      return (
                        <tr
                          key={c.model.id}
                          style={{
                            background: c.isSelected ? "rgba(91,157,255,0.12)" : "transparent",
                            borderTop: "1px solid var(--border)",
                          }}
                        >
                          <td style={{ ...td, fontWeight: c.isSelected ? 700 : 400 }}>
                            {c.model.displayName}
                          </td>
                          <td style={td}>{c.model.provider}</td>
                          <td style={{ ...td, color: TIER_COLOR[c.model.tier] }}>
                            {TIER_LABEL[c.model.tier]}
                          </td>
                          <td style={{ ...td, textAlign: "right" }}>
                            <CapBar
                              value={c.model.capabilities[result.dominantSkill as SkillKey]}
                              highlight={c.isSelected}
                            />
                          </td>
                          <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                            {usd(c.cost.totalCost)}
                          </td>
                          <td style={{ ...td, whiteSpace: "nowrap", width: "1%" }}>
                            {timingOn && c.model.flex && (
                              <span
                                title="AWS Bedrock Flex tier: ~50% lower cost in exchange for higher, best-effort latency"
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: 4,
                                  fontSize: 10,
                                  fontWeight: 700,
                                  color: "var(--green)",
                                  border: "1px solid var(--green)",
                                  background: "rgba(52,211,153,0.10)",
                                  borderRadius: 999,
                                  padding: "1px 6px",
                                }}
                              >
                                <ClockIcon size={11} />
                                FLEX −50%
                              </span>
                            )}
                          </td>
                          <td
                            style={{
                              ...td,
                              textAlign: "right",
                              fontVariantNumeric: "tabular-nums",
                              color: delta > 0 ? "var(--green)" : delta < 0 ? "var(--red)" : "var(--muted)",
                            }}
                          >
                            {delta === 0 ? "—" : `${delta > 0 ? "-" : "+"}${Math.abs(deltaPct).toFixed(0)}%`}
                          </td>
                          <td style={{ ...td, whiteSpace: "nowrap" }}>
                            {c.isSelected && <Chip color="var(--accent)">◀ SELECTED</Chip>}
                            {c.isNiceDefault && <Chip color="var(--amber)">NiCE DEFAULT</Chip>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>

            {/* Explainability breakdown */}
            <section style={{ ...panel, padding: 18 }}>
              <h2 style={{ fontSize: 15, fontWeight: 700, margin: "0 0 12px" }}>
                {result.source === "judge"
                  ? "Why this score? — judge verdict"
                  : "Why this score? — feature contributions"}
              </h2>
              {result.source === "judge" && result.judge && (
                // In Judged mode the score comes from the LLM, so the keyword
                // contributions below no longer sum to it — they're shown for
                // reference. The verdict is the real "why".
                <div
                  style={{
                    marginBottom: 14,
                    padding: "10px 12px",
                    borderRadius: 10,
                    border: "1px solid var(--amber)",
                    background: "rgba(251,191,36,0.08)",
                    fontSize: 13,
                    color: "var(--text)",
                  }}
                >
                  <strong>{result.judge.modelName}</strong> scored complexity{" "}
                  <strong>{result.judge.score}/100</strong> (task: {result.judge.skill}).
                  <div style={{ marginTop: 4, color: "var(--muted)" }}>
                    “{result.judge.rationale}”
                  </div>
                </div>
              )}
              {result.source === "judge" && (
                <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>
                  Keyword-heuristic breakdown (for reference — not used to route in Judged mode):
                </div>
              )}
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {a.contributions.map((c) => (
                  <ContribRow key={c.key} c={c} />
                ))}
              </div>
            </section>

            {/* Real model answers — routed model vs NiCE Default, via Bedrock */}
            <section style={{ ...panel, padding: 18 }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    flexWrap: "wrap",
                    marginBottom: 14,
                  }}
                >
                  <div style={{ fontSize: 15, fontWeight: 800, color: "var(--text)" }}>
                    Real model answers
                  </div>
                  <div style={{ fontSize: 13, color: "var(--muted)" }}>
                    Runs both models on Bedrock to verify the routed choice was good enough.
                  </div>
                  <button
                    onClick={() => fetchAnswers()}
                    disabled={answersLoading}
                    style={{
                      marginLeft: "auto",
                      background: "var(--accent)",
                      color: "#ffffff",
                      fontWeight: 700,
                      border: "none",
                      borderRadius: 10,
                      padding: "8px 16px",
                      cursor: answersLoading ? "default" : "pointer",
                      opacity: answersLoading ? 0.6 : 1,
                    }}
                  >
                    {answersLoading ? "Running…" : answers ? "Re-run" : "Run both models"}
                  </button>
                </div>

                {answersError && (
                  <div
                    style={{
                      ...panel,
                      padding: 12,
                      borderColor: "var(--red)",
                      color: "var(--red)",
                      marginBottom: 12,
                    }}
                  >
                    {answersError}
                  </div>
                )}

                {result.selected.model.id === result.niceDefault.model.id && (
                  <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 12 }}>
                    The router landed on the NiCE Default for this prompt, so both columns run the
                    same model.
                  </div>
                )}

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
                    gap: 14,
                  }}
                >
                  <AnswerColumn
                    title={result.selected.model.displayName}
                    badge="ROUTED CHOICE"
                    badgeColor="var(--accent)"
                    answer={answers?.selected}
                    loading={answersLoading}
                  />
                  <AnswerColumn
                    title={result.niceDefault.model.displayName}
                    badge="NiCE DEFAULT"
                    badgeColor="var(--amber)"
                    answer={answers?.niceDefault}
                    loading={answersLoading}
                  />
                </div>
              </section>
          </>
        )}
          </div>
        )}
      </div>
    </main>
    </>
  );
}

const th: React.CSSProperties = { padding: "6px 10px", fontWeight: 600, fontSize: 12 };
const td: React.CSSProperties = { padding: "9px 10px" };

function AnswerColumn({
  title,
  badge,
  badgeColor,
  answer,
  loading,
}: {
  title: string;
  badge: string;
  badgeColor: string;
  answer?: OneAnswer;
  loading: boolean;
}) {
  // Approximate cost of this real answer, from the actual Bedrock token usage
  // priced with the catalog rates (mock but realistic, see lib/config.ts).
  const model = MODEL_CATALOG.find((m) => m.id === answer?.modelId);
  const cost =
    model && answer?.usage
      ? (answer.usage.inputTokens / 1e6) * model.inputCostPer1M +
        (answer.usage.outputTokens / 1e6) * model.outputCostPer1M
      : null;

  const meta =
    answer && !answer.error
      ? [
          answer.usage
            ? `${answer.usage.inputTokens} in / ${answer.usage.outputTokens} out tokens`
            : null,
          cost != null ? `≈ ${usd(cost)}` : null,
          answer.latencyMs != null ? `${(answer.latencyMs / 1000).toFixed(1)}s` : null,
        ]
          .filter(Boolean)
          .join(" · ")
      : "";

  return (
    <div style={{ ...panel, padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>{title}</span>
        <Chip color={badgeColor}>{badge}</Chip>
      </div>

      {meta && <div style={{ fontSize: 12, color: "var(--muted)" }}>{meta}</div>}

      <div
        style={{
          fontSize: 13,
          lineHeight: 1.5,
          whiteSpace: "pre-wrap",
          color: answer?.error ? "var(--red)" : "var(--text)",
          minHeight: 40,
        }}
      >
        {loading
          ? "Running…"
          : answer?.error
            ? answer.error
            : answer?.text
              ? answer.text
              : "Not run yet."}
      </div>
    </div>
  );
}

function Chip({ children, color }: { children: React.ReactNode; color: string }) {
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: 0.5,
        color,
        border: `1px solid ${color}`,
        borderRadius: 999,
        padding: "1px 7px",
        marginRight: 6,
      }}
    >
      {children}
    </span>
  );
}

function SavingsBadge({ absolute, percent }: { absolute: number; percent: number }) {
  if (absolute > 0) {
    return (
      <div style={{ textAlign: "right", background: "rgba(52,211,153,0.1)", border: "1px solid var(--green)", borderRadius: 12, padding: "10px 16px" }}>
        <div style={{ fontSize: 12, color: "var(--muted)" }}>Saved vs NiCE Default</div>
        <div style={{ fontSize: 22, fontWeight: 800, color: "var(--green)" }}>{percent.toFixed(1)}%</div>
        <div style={{ fontSize: 12, color: "var(--muted)" }}>{usd(absolute)} / call</div>
      </div>
    );
  }
  if (absolute < 0) {
    return (
      <div style={{ textAlign: "right", background: "rgba(248,113,113,0.08)", border: "1px solid var(--red)", borderRadius: 12, padding: "10px 16px" }}>
        <div style={{ fontSize: 12, color: "var(--muted)" }}>Premium spend</div>
        <div style={{ fontSize: 22, fontWeight: 800, color: "var(--red)" }}>+{Math.abs(percent).toFixed(1)}%</div>
        <div style={{ fontSize: 12, color: "var(--muted)" }}>vs NiCE Default (hard task)</div>
      </div>
    );
  }
  return (
    <div style={{ textAlign: "right", background: "rgba(251,191,36,0.08)", border: "1px solid var(--amber)", borderRadius: 12, padding: "10px 16px" }}>
      <div style={{ fontSize: 12, color: "var(--muted)" }}>On the standard</div>
      <div style={{ fontSize: 15, fontWeight: 800, color: "var(--amber)" }}>NiCE Default</div>
      <div style={{ fontSize: 12, color: "var(--muted)" }}>no downgrade</div>
    </div>
  );
}

function QualityBadge({
  delta,
  relativePercent,
  retainedPercent,
  savingsPercent,
  skill,
  selectedCap,
  defaultCap,
  defaultName,
}: {
  delta: number;
  relativePercent: number;
  retainedPercent: number;
  savingsPercent: number;
  skill: string;
  selectedCap: number;
  defaultCap: number;
  defaultName: string;
}) {
  const skillLabel = SKILL_META[skill as SkillKey]?.label ?? skill;
  const tip = `${defaultName} scores ${defaultCap.toFixed(2)} on ${skillLabel}; the routed model scores ${selectedCap.toFixed(2)} (${delta >= 0 ? "+" : ""}${delta.toFixed(2)}).`;
  const savingsAbs = Math.abs(Math.round(savingsPercent));

  // Upgrade: routed model is stronger than the baseline on the dominant skill.
  if (delta > 0.005) {
    return (
      <div
        title={tip}
        style={{ textAlign: "right", background: "rgba(91,157,255,0.10)", border: "1px solid var(--accent)", borderRadius: 12, padding: "10px 16px" }}
      >
        <div style={{ fontSize: 12, color: "var(--muted)" }}>Quality vs baseline</div>
        <div style={{ fontSize: 22, fontWeight: 800, color: "var(--accent)" }}>+{relativePercent.toFixed(0)}%</div>
        <div style={{ fontSize: 12, color: "var(--muted)" }}>more capable on {skillLabel.toLowerCase()}</div>
      </div>
    );
  }
  // Downgrade but deliberately "good enough" — cheaper model, quality retained.
  if (delta < -0.005) {
    return (
      <div
        title={tip}
        style={{ textAlign: "right", background: "rgba(148,163,184,0.10)", border: "1px solid var(--border)", borderRadius: 12, padding: "10px 16px" }}
      >
        <div style={{ fontSize: 12, color: "var(--muted)" }}>Quality retained</div>
        <div style={{ fontSize: 22, fontWeight: 800, color: "var(--text)" }}>{retainedPercent.toFixed(0)}%</div>
        <div style={{ fontSize: 12, color: "var(--muted)" }}>
          of baseline {savingsPercent > 0.5 ? `at −${savingsAbs}% cost` : `on ${skillLabel.toLowerCase()}`}
        </div>
      </div>
    );
  }
  // Effectively on par with the baseline.
  return (
    <div
      title={tip}
      style={{ textAlign: "right", background: "rgba(52,211,153,0.10)", border: "1px solid var(--green)", borderRadius: 12, padding: "10px 16px" }}
    >
      <div style={{ fontSize: 12, color: "var(--muted)" }}>Quality vs baseline</div>
      <div style={{ fontSize: 15, fontWeight: 800, color: "var(--green)" }}>
        On par{savingsPercent > 0.5 ? ` · −${savingsAbs}% cost` : ""}
      </div>
      <div style={{ fontSize: 12, color: "var(--muted)" }}>same {skillLabel.toLowerCase()} capability</div>
    </div>
  );
}

function ScoreGauge({ score, tier }: { score: number; tier: number }) {
  const color = TIER_COLOR[tier];
  return (
    <div style={{ position: "relative", width: 120, height: 120 }}>
      <svg width={120} height={120} viewBox="0 0 120 120">
        <circle cx="60" cy="60" r="52" fill="none" stroke="var(--border)" strokeWidth="12" />
        <circle
          cx="60"
          cy="60"
          r="52"
          fill="none"
          stroke={color}
          strokeWidth="12"
          strokeLinecap="round"
          strokeDasharray={`${(score / 100) * 2 * Math.PI * 52} ${2 * Math.PI * 52}`}
          transform="rotate(-90 60 60)"
        />
      </svg>
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div style={{ fontSize: 30, fontWeight: 800 }}>{score}</div>
        <div style={{ fontSize: 11, color: "var(--muted)" }}>complexity</div>
      </div>
    </div>
  );
}

function ContribRow({ c }: { c: { label: string; points: number; weight: number; signal: number; evidence: string } }) {
  const pct = Math.abs(c.points) / Math.max(1, Math.abs(c.weight));
  const positive = c.points >= 0;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <div style={{ width: 150, fontSize: 13 }}>{c.label}</div>
      <div style={{ flex: 1, height: 10, background: "var(--panel-2)", borderRadius: 6, overflow: "hidden" }}>
        <div
          style={{
            width: `${Math.min(100, pct * 100)}%`,
            height: "100%",
            background: positive ? "var(--accent)" : "var(--amber)",
          }}
        />
      </div>
      <div style={{ width: 54, textAlign: "right", fontSize: 13, fontWeight: 700, color: positive ? "var(--text)" : "var(--amber)" }}>
        {c.points >= 0 ? "+" : ""}
        {c.points}
      </div>
      <div style={{ width: 220, fontSize: 11, color: "var(--muted)" }}>{c.evidence}</div>
    </div>
  );
}

// "Read more" — the long-form explanation of the routing system, shown as a
// dismissible modal so it doesn't compete with the primary flow on the page.
function AboutModal({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const modalP: React.CSSProperties = { fontSize: 14, color: "var(--muted)", lineHeight: 1.6, margin: "0 0 12px" };
  const modalH3: React.CSSProperties = { fontSize: 16, fontWeight: 700, margin: "0 0 8px" };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="about-modal-title"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(16,24,40,0.5)",
        display: "flex",
        justifyContent: "center",
        padding: "48px 20px",
        zIndex: 100,
        overflowY: "auto",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--panel)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          maxWidth: 980,
          width: "100%",
          minWidth: 0,
          height: "fit-content",
          padding: 32,
          position: "relative",
        }}
      >
        <button
          onClick={onClose}
          aria-label="Close"
          style={{
            position: "absolute",
            top: 16,
            right: 16,
            background: "var(--panel-2)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            width: 32,
            height: 32,
            cursor: "pointer",
            fontSize: 16,
            color: "var(--muted)",
            lineHeight: 1,
          }}
        >
          ✕
        </button>

        <h2 id="about-modal-title" style={{ fontSize: 20, fontWeight: 700, margin: "0 32px 4px 0" }}>
          Better AI. Lower Cost. Smarter Routing.
        </h2>
        <p style={{ fontSize: 14, fontWeight: 600, color: "var(--text)", margin: "0 0 16px" }}>
          Save up to 90% on token costs—while improving AI quality.
        </p>

        <p style={modalP}>
          Most AI applications rely on a single model for every request, regardless of complexity.
          That means you're often paying premium prices for simple tasks that don't need a premium
          model.
        </p>
        <p style={modalP}>
          Smarter Routing changes that. Before every AI call, it analyzes your prompt and
          automatically selects the model that delivers the best balance of quality, speed, and
          cost. Simple requests are routed to lightweight models, while complex reasoning tasks go
          to the most capable ones—ensuring you never pay for more intelligence than you actually
          need.
        </p>
        <p style={{ ...modalP, marginBottom: 24 }}>
          A real-time Quality ↔ Cost slider lets you choose how aggressively to optimize for
          savings, with instant re-routing. Through a unified interface, you can access 16 leading
          AI models, including Claude, Amazon Nova, Google Gemma, OpenAI GPT-OSS, and Alibaba Qwen.
        </p>

        <h3 style={modalH3}>Progressive Routing Pipeline</h3>
        <p style={modalP}>
          Smarter Routing doesn't run every routing algorithm on every request. Instead, it uses a
          progressive routing pipeline, where algorithms are executed from the cheapest to the most
          sophisticated. Each stage attempts to confidently select the optimal model, and the next
          stage is only invoked when needed.
        </p>
        <p style={{ ...modalP, marginBottom: 24 }}>
          This cascading approach minimizes routing overhead, avoids unnecessary LLM calls, and
          dramatically reduces token consumption while maintaining the highest possible response
          quality.
        </p>

        <h3 style={{ ...modalH3, marginBottom: 12 }}>Four complementary routing strategies</h3>
        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 24 }}>
          {ABOUT_STRATEGIES.map((s) => (
            <div key={s.title} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
              <span style={{ fontSize: 18, lineHeight: 1.4 }} aria-hidden="true">
                {s.icon}
              </span>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>{s.title}</div>
                <p style={{ fontSize: 13.5, color: "var(--muted)", lineHeight: 1.55, margin: "2px 0 0" }}>
                  {s.body}
                </p>
              </div>
            </div>
          ))}
        </div>

        <div style={{ borderTop: "1px solid var(--border)", paddingTop: 16 }}>
          <p style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", margin: "0 0 8px" }}>
            The most expensive router is the one you never have to call.
          </p>
          <p style={{ fontSize: 13.5, color: "var(--muted)", lineHeight: 1.6, margin: 0 }}>
            Smarter Routing escalates intelligently—from deterministic algorithms to AI-based
            reasoning—only when confidence is low. In most cases, routing is completed without
            invoking another LLM, enabling up to 90% lower token costs compared to the standard
            NiCE approach.
          </p>
        </div>
      </div>
    </div>
  );
}
