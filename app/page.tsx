"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { RouteResult } from "@/lib/types";
import {
  MODEL_CATALOG,
  NICE_DEFAULT_ID,
  QUALITY_FIRST_SCORE as DEFAULT_QUALITY_FIRST_SCORE,
  WEIGHTS as DEFAULT_WEIGHTS,
} from "@/lib/config";
import type { ScoringWeights } from "@/lib/config";
import { useDebouncedEffect } from "@/lib/useDebouncedEffect";

// Dev-only "Scoring & routing tuning" panel state — gated behind ?tune=1 /
// ?debug=1 (see the `tuneEnabled` check in Home()). Undefined/absent means the
// app behaves exactly as before: no tuning is ever sent to /api/route.
interface TuningState {
  weights: ScoringWeights;
  affinityBase: number;
  affinitySlope: number;
  qualityFirstScore: number;
}
const DEFAULT_TUNING: TuningState = {
  weights: { ...DEFAULT_WEIGHTS },
  affinityBase: 0.35,
  affinitySlope: 0.006,
  qualityFirstScore: DEFAULT_QUALITY_FIRST_SCORE,
};
const TUNING_STORAGE_KEY = "sparkaton.tuning.v1";
const WEIGHT_FIELDS: { key: keyof ScoringWeights; label: string }[] = [
  { key: "code", label: "Code" },
  { key: "reasoning", label: "Reasoning" },
  { key: "math", label: "Math" },
  { key: "structure", label: "Structure / constraints" },
  { key: "length", label: "Input length" },
  { key: "criticalDomain", label: "High-stakes domain" },
  { key: "creativity", label: "Creativity (dampener)" },
  { key: "simpleTask", label: "Mechanical task (dampener)" },
  { key: "brevity", label: "Brevity (dampener)" },
];

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

// Ordered complexity buckets shown as <optgroup> headers in the example
// dropdown, so the expected difficulty of each prompt is explicit.
type ExampleGroup = "easy" | "creative" | "medium" | "coding" | "hard" | "summary";
const EXAMPLE_GROUPS: { key: ExampleGroup; label: string }[] = [
  { key: "easy", label: "🟢 Easy — Economy" },
  { key: "creative", label: "✍️ Creative (short) — Economy" },
  { key: "medium", label: "🟡 Medium — Economy / Standard" },
  { key: "coding", label: "💻 Coding — Economy / Standard" },
  { key: "hard", label: "🔴 Hard reasoning — Economy / Standard" },
  { key: "summary", label: "📞 Call AutoSummary" },
];

const EXAMPLES: { label: string; group: ExampleGroup; prompt: string }[] = [
  // — Easy → Economy —
  { group: "easy", label: "Greeting translation", prompt: "Translate 'good morning, how are you?' into Italian." },
  { group: "easy", label: "Capital city", prompt: "What is the capital of Australia?" },
  { group: "easy", label: "Date formatting", prompt: "Reformat the date '2026-07-15' as 'July 15, 2026'." },
  { group: "easy", label: "Yes/no fact", prompt: "Is water an element? Answer yes or no in one sentence." },
  { group: "easy", label: "Word count", prompt: "How many words are in the sentence 'The quick brown fox jumps'?" },
  { group: "easy", label: "Simple math", prompt: "What is 17 multiplied by 24?" },
  { group: "easy", label: "Synonym", prompt: "Give me three synonyms for the word 'happy'." },

  // — Creative (short) —
  { group: "creative", label: "Haiku", prompt: "Write a haiku about the sea at dawn." },
  { group: "creative", label: "Product name", prompt: "Suggest 5 catchy names for a plant-based energy drink." },
  { group: "creative", label: "Tagline", prompt: "Write a one-line marketing slogan for a noise-cancelling headphone." },
  { group: "creative", label: "Short poem", prompt: "Write a short 4-line poem about the sea at dawn." },

  // — Medium → Standard —
  {
    group: "medium",
    label: "REST vs GraphQL",
    prompt:
      "Compare REST and GraphQL for a mobile app backend. List pros and cons, then recommend one.",
  },
  {
    group: "medium",
    label: "Summarize paragraph",
    prompt:
      "Summarize the following in two sentences: Machine learning models improve as they are exposed to more data, but they can also inherit biases present in that data, which raises fairness concerns in high-impact decisions.",
  },
  {
    group: "medium",
    label: "Professional email",
    prompt:
      "Write a polite professional email to a client asking to reschedule tomorrow's meeting to Friday afternoon.",
  },
  {
    group: "medium",
    label: "Regex",
    prompt: "Write a regular expression that matches a valid IPv4 address, and explain each part.",
  },
  {
    group: "medium",
    label: "SQL query",
    prompt:
      "Given tables users(id, name) and orders(id, user_id, total), write a SQL query for the top 5 users by total spend.",
  },
  {
    // Standard tier, code-dominant → routes to a code specialist below Sonnet.
    group: "medium",
    label: "Refactor SQL subquery",
    prompt:
      "Refactor this SQL query for performance and explain the change: SELECT * FROM orders WHERE user_id IN (SELECT id FROM users).",
  },
  {
    // Standard tier, math-dominant → routes to a math specialist below Sonnet.
    group: "medium",
    label: "Dice probability",
    prompt:
      "Calculate the probability of rolling two dice and getting a sum of 7, and show the steps.",
  },
  {
    // Standard tier, reasoning-dominant → routes to a reasoning specialist below Sonnet.
    group: "medium",
    label: "SQL vs NoSQL",
    prompt:
      "Compare SQL and NoSQL databases and recommend one for an e-commerce catalog.",
  },
  {
    // High-stakes but broad-language → cost-first still finds a cheap capable
    // model; the premium (approval) option covers the extra-assurance case.
    group: "medium",
    label: "GDPR audit summary (high-stakes)",
    prompt:
      "Summarize the key GDPR compliance obligations in this data processing contract for our upcoming audit.",
  },

  // — Coding —
  {
    group: "coding",
    label: "Refactor to O(n)",
    prompt:
      "Here is a function:\n```js\nfunction dedupe(a){return a.filter((x,i)=>a.indexOf(x)===i)}\n```\nRefactor it to be O(n) and explain why the original is slower.",
  },
  {
    group: "coding",
    label: "Debug stack trace",
    prompt:
      "My Node app throws `TypeError: Cannot read properties of undefined (reading 'map')` at line 42 when the API returns an empty body. Explain the likely cause and how to fix it defensively.",
  },
  {
    group: "coding",
    label: "Explain closures",
    prompt: "Explain JavaScript closures to a junior developer, with one concrete code example.",
  },
  {
    group: "coding",
    label: "Write unit test",
    prompt:
      "Write Jest unit tests for a function `add(a, b)` that returns their sum, covering typical and edge cases.",
  },

  // — Hard reasoning → Premium —
  {
    group: "hard",
    label: "Prove sum of odds",
    prompt:
      "Analyze and prove why the sum of the first n odd numbers equals n^2. Then derive a closed-form and evaluate it for n=1..5 step by step.",
  },
  {
    group: "hard",
    label: "Logic puzzle",
    prompt:
      "Three people (Alice, Bob, Carol) each have a different pet (cat, dog, fish). Alice doesn't own the dog. The fish owner sits next to Bob. Carol owns the cat. Determine who owns what, showing your reasoning.",
  },
  {
    group: "hard",
    label: "Architecture trade-offs",
    prompt:
      "We expect 50k requests/sec with strict p99 latency. Analyze the trade-offs between a monolith, microservices, and a serverless architecture for this workload, and recommend one with justification.",
  },
  {
    group: "hard",
    label: "Constraint planning",
    prompt:
      "Plan a 3-day conference schedule for 4 parallel tracks and 30 talks, where 6 speakers can each only present on day 1, and no track may have two talks in the same slot. Explain the scheduling strategy.",
  },
  {
    group: "summary",
    label: "Copilot AutoSummary — Example 1",
    prompt: `You are tasked with analyzing customer service interactions as an agent. Follow this refined process:

- **Analyze the exchange** between agent and customer.
- **Analyze the additional interaction context** that may assist in your analysis if it is provided.
- **Grasp full context** and flow of the conversation.
- **Create a summary** with a professional and neutral tone, in english.
- **Adhere to word limit** and ensure your response is exactly 300 words or fewer. This is a strict requirement.
- **Verify** alignment with instructions and content accuracy.
- Keep your output concise yet comprehensive, adhering strictly to the parameters.
- **Apply the following additional instructions**:

Produce a structured call summary using exactly these four labeled sections in this order:

CALLER
State who called using one of these identifiers: Member, Spouse, Dependent, Friend, or Other. Include the caller's name if available. Example: "Member – Margaret Roberts"

REASON FOR CALL
1–2 sentences maximum. State only the primary reason(s) the caller contacted support. Do not include any actions taken by the agent, outcomes, or resolutions.

ACTIONS TAKEN
Bullet list. Include only the specific steps the agent performed during the call. Do not include what was discussed, decided, or any outcomes. Each bullet must be a concrete, completed action (e.g., "Submitted refund request", "Updated meal preference to gluten-free on all future bookings").

RESOLUTION
Bullet list. State only what was resolved, decided, or determined. Do not repeat agent actions. Do not include pending or follow-up items.

FOLLOW-UP
Bullet list of next steps and pending items only. Each bullet must identify who is responsible (agent, member, airline, senior agent, etc.) and include a deadline or timeframe if known. Leave this section blank if no follow-up is needed.

Additional rules:
- Exclude all sensitive data (masked values, membership numbers, booking references, refund reference numbers).
- Use gender-neutral pronouns (they/them) if referring to the caller.
- Output "No meaningful dialogue" if the transcript contains no substantive conversation.

here is the transcript

Agent: Thank you for calling voyager this. Is darrell philbin account up corp m c nine hundred thirty two how can, I help.
Customer: Hi I need to follow up. On a, refund. My membership is v are [MASKED].
Agent: Of, course, can, I confirm your membership number please.
Customer: Yes v are [MASKED].
Agent: Thank you account is up margaret roberts with corp m z nine hundred thirty two.
Customer: Great.
Agent: Let me pull up. The booking I have b k [MASKED] for. The refund request.
Customer: Yes b k [MASKED] oh.
Agent: I can, see the cancellation has already been processed. The refund needs to be, initiated separately.
Customer: How, much will be refunded?
Agent: The refundable amount is three hundred eight, dollars based on the fare class and timing of cancellation.
Customer: when will it appear?
Agent: Refunds typically takes seven to ten, business days to appear on the original payment method.
Customer: okay.
Agent: I am submitting the refund request now. You will receive a confirmation by email within the hour.
Customer: Good.
Agent: The refund reference is c f o [MASKED], please retain that for your records.
Customer: Got it cfo for. [MASKED].
Agent: I have also added a. Note to your account so, any follow up can find this thread quickly.
Customer: Thanks.
Agent: Anything else. I can sort out for. You today.
Customer: Actually yes what's the lounge access situation on my upcoming trip.
Agent: For your trip on p, h x, s e a, e you have access, at both end points under your voyager. Select tier you can also bring one gas.
Customer: What about during the layover it's a four hour gap?
Agent: Yes the connecting airport lounges included as well, there's a, priority pass partner lounge plus the airlines own.
Customer: which one's better at that airport.
Agent: The airline lounge is quieter but smaller the partner lounge has hot food honestly i'd start at the partner and move if it's busy.
Customer: Useful thanks i'll do that.
Agent: I'll add a. Note to your, file so, the airline nose to expect you in their lounge if you do switch.
Customer: Perfect I appreciate the heads up.
Agent: I wanna make sure I haven't missed anything. You needed to raise today.
Customer: I want to know, why nobody from your side called me back. Like they said. They would.
Agent: That's a fair question and I don't have a clean answer i'm filing this as a, service failure and a. Senior agent will follow up.
Customer: I want them to actually call not, just email.
Agent: Anything else on this trip.
Customer: Yes can, you check what meal preference I have on file.
Agent: You're set to no preference across all carriers, which means standard meal did you wanna change that.
Customer: Yes, gluten free going forward.
Agent: Updated that applies to all future bookings for your existing, upcoming trip i'll need to push it to the airline manually done.
Customer: Will I get a, confirmation that the airline received. It.
Agent: Yes within twenty four hours if you don't see. It the gate agent can reconfirm. It check in.
Customer: Good thanks for. The heads up on the timeline.
Agent: Glad to help small thing, but. It makes a difference on a, long flight.
Customer: Exactly especial.`,
  },
  {
    group: "summary",
    label: "Copilot AutoSummary — Example 2",
    prompt: `You are tasked with analyzing customer service interactions as an agent. Follow this refined process:

- **Analyze the exchange** between agent and customer.
- **Analyze the additional interaction context** that may assist in your analysis if it is provided.
- **Grasp full context** and flow of the conversation.
- **Create a summary** with a professional and neutral tone, in english.
- **Adhere to word limit** and ensure your response is exactly 300 words or fewer. This is a strict requirement.
- **Verify** alignment with instructions and content accuracy.
- Keep your output concise yet comprehensive, adhering strictly to the parameters.
- **Apply the following additional instructions**:

Summarize: In clear language, summarize the key points and order details of the conversation as a paragraph called "Summary: ". Then write out text called "Order details: " extracting the following information from the transcript:

- Products mentioned as a comma separated list
- Agent follow up needed (requested follow or offered follow up?)
- Customer follow up needed?
- What was the call disposition?
- Did the call need to be transferred and why?
- If the call was transferred, what category was it?

When referencing the agent, use the label "Representative". When referencing the customer, use the label "Customer".

Here are some important rules for each summary and order detail list:

- For each order mentioned, write a separate order detail list. If there are multiple entries for a field, there should be multiple order details lists.
- If the information is not provided, say: "Not provided".
- Make sure "Not provided" is used for missing/not applicable information in the order detail list.
- Make sure each order is separated into its own order list.
- Make sure you extracted all the desired information.
- Agent Follow up needed yes or no, if yes, why?
- Does the Customer need to follow up, yes or no?
- Assign call disposition based on list, if none match, create a one or two word disposition: Product Inquiry (Warranty), Repair/Remake, Damaged product, General Information, Order Status (Current or Past Due), Transfer, Quote, Change/Cancel, PowerView, HDIS, Online Tools (Direct Connect, eOrder), Hang Up, Sampling, Motorization, Status Past Due, Troubleshooting, Consumer Call Escalation, Credit/Trip Charge, Courier Status/Inquiry, Sales Contact, Installation, Marketing
- Transferred, where and why?
- Transferred call category: Standard Order, Out of Spec during order, Out of Spec prior to order, volume discount, Quote, Post-Sale Help, Trip Charge, Order Status, Plant Inquiry, Backorder, Order Change, Order Cancel, Product Info, Automation, Specialty Order, Order Exception, Contact Update, Samples, Rush Order, Expedite Shipping, Discount, Hold, Online Tools, Reassignment, Other

Transcript:

Agent: Hi, this is Jennifer with Three Day Blinds. I'll be assisting in booking your free consultation. Can I start by getting your first and last name, please?
Client: Sure, it's all incorrectly, but I just want to double check. Your website said that Wisconsin is not covered in the United Lake Geneva, Wisconsin.
Agent: Oh, what is the zip code there? Let me look that up.
Client: [MASKED].
Agent: All right, let me find out if you have service there just a second.
Client: Okay. I did talk to somebody and she checked for a long, long time she came back and said yes, but I want to be doubly sure.
Agent: Oh, okay. All right. Just a minute. Okay, so I'm showing that actually it was approved we can service that location. What is your name please?
Client: (spells last name) K-U-R-O-G-H-L-I-A-N.
Agent: (confirms) K U R O G H L I A N, correct. All right, and then how many windows do you want to submit? Oh, and I need the actual address. What is the address?
Client: Okay, 526 Maxwell Street, Maxwell M-A-X-W-E-L-L, Maxwell Street Lake Geneva Wisconsin.
Agent: Okay, Maxwell. All right. And do you have an email address I can send a confirmation to?
Client: Yes, it's E and my last name: E-K-U-R-O-G-H-L-I-A-N.
Agent: So E-K-U-R-O-G-H-L-I-A-N@gmail.com, correct?
Client: That's it, yeah.
Agent: All right, and then how many windows do you want us to measure here?
Client: Well, it's done, but I need it. I want a consultation. I want shades, but I don't really know what kind, and I don't know the features of all kinds. And I do have a coupon for buy one and get one free.
Agent: It's buy one get one 50% off. So for each one you purchase, you'll get one 50% off. It's a BOGO 50, that's what it is.
Client: Oh, that's great. Okay, great. Do you have appointments pretty soon? I mean, I can't wait a few weeks.
Agent: Yeah, let me look for that just a second. I'm just correcting this account here. Were you in a gated community, do you have any pets there?
Client: Oh, no.
Agent: Okay. Would you prefer a weekday or weekend appointment?
Client: I don't care. I just like when...
Agent: I have this Thursday the 16th at 9 a.m. Do you want that one?
Client: No, I'm sorry. I can't do that.
Agent: How about Tuesday, July 21st at 9 a.m., 11 or 3?
Client: Yeah, 9 a.m.
Agent: Okay, 9 a.m. on the 21st and the designer will arrive between 9 and 10.
Client: Yeah, that's great. Yeah, that's fine. Well, yes, I want a phone number and a little bit more information about what the person is going to do. So what is the name of your business? Three-day blinds? Is that it?
Agent: Three-day blinds, and the designer will come out, measure the windows, provide samples and a quote. And it's a free consultation. There's no obligation. The designer will call you the day before to confirm the appointment. And her name is Catherine with a C. Is there anything else? Oh, and you wanted shades or blinds or straight curtains or motorized?
Client: I want change, not motorized.
Agent: Okay. And how many did you want again? Was it eight? Ten?
Client: Well, I said 10 but some are short. I do not want motorized, I don't think.
Agent: Not motorized. Okay.
Client: And then could you tell me how long it takes since I decide to do this? There's no obligation, right? And there's no charge for her to come?
Agent: What was that last part? I'm sorry. I couldn't hear you very well.
Client: I'm sorry. I put you on speaker. There's no obligation and there's no charge for her to come, right?
Agent: Exactly. There's no obligation in the end. Free consultation.
Client: Okay. And then if I choose to do this, which I'm inclined to do, how long does it take for this product to arrive and be installed?
Agent: Okay, yes, so we do everything from measuring to install, so we're kind of like a white glove service for window treatments.
Client: How long? What's the time frame? No, I need you on the time frame.
Agent: So the motorized shades usually take a week and a half.
Client: It would not be motorized.
Agent: Oh, I'm sorry, not motorized. The regular ones take three business days to manufacture and then you do have the option to pay for the expedited shipping, so it's probably going to be about a week from the time you order to the time they're installed.
Client: But they come in and install them, right? I can't do it.
Agent: Yes, that's right. We install for you. So once they're manufactured, we ship them to the installer, then the installer will call you to book the appointment for the install as long as you're available. We'll get it done right away.
Client: Okay, right away? It's not going to be like five weeks or anything like that, right?
Agent: No, not at all. I got mine, I didn't even pay for expedited, out of mine in 12 days. Is there anything else?
Client: Now, where is Catherine coming from?
Agent: So the designer lives in your area and is coming from that area, either from another appointment or from the planner's home office. The designer will call you the day before to confirm and we'll give you the designer's phone number. But if you need to contact us before that, you can call us at any time at 800-493-1740.
Client: Wait, 493?
Agent: Yes, 800-493-1740.
Client: Yes, [MASKED]. Okay, we covered it. I appreciate your help.
Agent: All right, thank you.
Client: Thank you so much!
Agent: Bye-bye.`,
  },

  // — Call AutoSummary (metadata-scored, verified against the live router) —
  // Calibrated around the NICE baseline (Claude 4.5 Haiku): one summary routes
  // BELOW it (a cheaper specialist that's good enough), two land ON it (Haiku is
  // the best value), one goes ABOVE it (a task that needs a stronger model).
  // No prompt is special-cased — placement comes purely from content.
  {
    // Math-dominant (totals/figures) → the router picks the cheaper math
    // specialist Qwen3 32B; ~97% of Haiku's math quality at a fraction of cost.
    group: "summary",
    label: "AutoSummary — billing total (math-heavy)",
    prompt: `Summarize this billing call, then calculate the total charged.

Agent: The invoice has a base fee of 40, an add-on of 15, and a late fee of 5, minus a 10 credit.`,
  },
  {
    // Plain general summary → no cheaper Economy model matches Haiku's general
    // quality, so the router selects the baseline itself.
    group: "summary",
    label: "AutoSummary — appointment confirm (simple)",
    prompt: `Summarize this short customer call in three bullet points.

Agent: Hi, thanks for calling. How can I help?
Customer: I just wanted to confirm my appointment for Thursday.
Agent: Yes, you're booked for Thursday at 10. See you then.
Customer: Great, thank you.`,
  },
  {
    // Light reasoning ("explain … whether it was resolved") but still Economy —
    // Haiku leads reasoning at this tier, so it stays on the baseline.
    group: "summary",
    label: "AutoSummary — support recap (light reasoning)",
    prompt: `In two sentences, explain what the customer wanted and whether it was resolved.

Agent: Support here, how can I help?
Customer: My app keeps logging me out every few minutes.
Agent: I've reset your session token, that should stop it. Let me know if it recurs.
Customer: Okay, thanks.`,
  },
  {
    // High-stakes (compliance/financial), broad-language summary → the router
    // spends above the Haiku baseline for a real quality upgrade (Sonnet 4.5):
    // no cheaper model is close enough on the general skill.
    group: "summary",
    label: "AutoSummary — compliance recap (high-stakes)",
    prompt: `Summarize this call for our records. Produce these sections:
- CALLER
- PURPOSE OF CALL
- ACTIONS TAKEN
- OUTCOME
- FOLLOW-UP

Use a neutral, professional tone and keep it under 200 words. This summary will be filed for a compliance audit, so keep it factual and exclude any sensitive financial account numbers.

Agent: Thank you for calling, how can I help?
Customer: Hi, I need to update the billing details on my business account.
Agent: I can help with that. Can you confirm the company name on the account?
Customer: Yes, it's Marlow Trading.
Agent: Thank you. What would you like to change?
Customer: The card on file expired, I want to add a new one.
Agent: I've added the new card and set it as the default payment method.
Customer: Will the next invoice use the new card?
Agent: Yes, the next invoice on the first of the month will be charged to it.
Customer: And can I get a copy of the last invoice?
Agent: I've emailed a copy of the last invoice to the address on file.
Customer: Perfect, thank you.
Agent: You're welcome. Is there anything else?
Customer: No, that's everything.`,
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
    subtitle: "exploits latency headroom",
    description:
      "Routes based on the required response time: picks the cheapest model among those fast enough to meet the SLA.",
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
    body: "Optimizes for latency by selecting the lowest-cost model capable of meeting the required response-time SLA, ensuring speed without paying for unnecessary performance.",
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
  return (
    <Suspense fallback={null}>
      <HomeInner />
    </Suspense>
  );
}

function HomeInner() {
  const searchParams = useSearchParams();
  const tuneEnabled = searchParams.get("tune") === "1" || searchParams.get("debug") === "1";

  const [tuning, setTuning] = useState<TuningState>(DEFAULT_TUNING);

  // Load persisted tuning values once, only when the panel is actually active.
  useEffect(() => {
    if (!tuneEnabled) return;
    try {
      const raw = window.localStorage.getItem(TUNING_STORAGE_KEY);
      if (raw) setTuning({ ...DEFAULT_TUNING, ...JSON.parse(raw) });
    } catch {
      // ignore malformed/absent storage
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tuneEnabled]);

  useEffect(() => {
    if (!tuneEnabled) return;
    try {
      window.localStorage.setItem(TUNING_STORAGE_KEY, JSON.stringify(tuning));
    } catch {
      // ignore storage failures (e.g. private browsing quota)
    }
  }, [tuneEnabled, tuning]);

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

  // Selecting an example loads its prompt AND clears any prior results, so it's
  // obvious the results panel no longer reflects the current prompt.
  function pickExample(label: string) {
    const ex = EXAMPLES.find((e) => e.label === label);
    if (!ex) return;
    setPrompt(ex.prompt);
    setExampleLabel(label);
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
        body: JSON.stringify({
          prompt,
          standardId,
          qualityPref: q,
          algos: selectedAlgos,
          ...(tuneEnabled ? { tuning } : {}),
        }),
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
  useDebouncedEffect(
    () => {
      if (!hasResult.current) return;
      if (selectedAlgos.length === 0) return; // nothing to route with — keep the last result
      runRoute().then((r) => {
        if (r) fetchAnswers(r);
      });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [qualityPref, standardId, selectedAlgos, tuning],
    500,
  );

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
          efficient models, complex ones to the most capable—so you always get the right model at the
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

          {tuneEnabled && (
            <TuningPanel tuning={tuning} setTuning={setTuning} result={result} />
          )}

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
                                title="Flex pricing: 50% discount for latency headroom (Timing enabled)"
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

// Dev-only panel (gated behind ?tune=1 / ?debug=1) for live-tuning the scorer
// and router: per-key scoring weights, the affinity-floor curve, and the
// quality-first threshold. Shows the live effect (selected model, dominant
// skill, adjusted score, affinity floor) so the tuning loop is immediate.
function TuningPanel({
  tuning,
  setTuning,
  result,
}: {
  tuning: TuningState;
  setTuning: React.Dispatch<React.SetStateAction<TuningState>>;
  result: RouteResult | null;
}) {
  const numberInput: React.CSSProperties = { ...fieldControl, padding: "6px 8px", fontSize: 13 };

  return (
    <div style={{ marginTop: 24, ...panel, padding: 16, borderStyle: "dashed" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <div style={sectionKicker}>Scoring &amp; routing tuning (dev only)</div>
        <button
          onClick={() => setTuning(DEFAULT_TUNING)}
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: "var(--accent)",
            background: "none",
            border: "1px solid var(--accent)",
            borderRadius: 8,
            padding: "4px 10px",
            cursor: "pointer",
          }}
        >
          Reset to defaults
        </button>
      </div>

      {result && (
        <div
          style={{
            display: "flex",
            gap: 16,
            flexWrap: "wrap",
            fontSize: 12,
            color: "var(--muted)",
            marginBottom: 16,
            padding: "8px 10px",
            background: "var(--panel-2)",
            borderRadius: 8,
          }}
        >
          <span>
            Selected: <strong style={{ color: "var(--text)" }}>{result.selected.model.displayName}</strong>
          </span>
          <span>
            Dominant skill: <strong style={{ color: "var(--text)" }}>{result.dominantSkill}</strong>
          </span>
          <span>
            Adjusted score: <strong style={{ color: "var(--text)" }}>{result.adjustedScore}</strong>
          </span>
          <span>
            Affinity floor used: <strong style={{ color: "var(--text)" }}>{result.affinityFloor.toFixed(2)}</strong>
          </span>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
        {WEIGHT_FIELDS.map((f) => (
          <div key={f.key}>
            <label style={{ ...fieldLabel, fontSize: 12, marginBottom: 4 }}>
              {f.label} <span style={{ color: "var(--muted)", fontWeight: 400 }}>(default {DEFAULT_WEIGHTS[f.key]})</span>
            </label>
            <input
              type="number"
              value={tuning.weights[f.key]}
              onChange={(e) =>
                setTuning((t) => ({
                  ...t,
                  weights: { ...t.weights, [f.key]: Number(e.target.value) },
                }))
              }
              style={numberInput}
            />
          </div>
        ))}
      </div>

      <div style={{ borderTop: "1px solid var(--border)", margin: "16px 0" }} />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
        <div>
          <label style={{ ...fieldLabel, fontSize: 12, marginBottom: 4 }}>
            Affinity floor — base <span style={{ color: "var(--muted)", fontWeight: 400 }}>(default {DEFAULT_TUNING.affinityBase})</span>
          </label>
          <input
            type="number"
            step="0.01"
            value={tuning.affinityBase}
            onChange={(e) => setTuning((t) => ({ ...t, affinityBase: Number(e.target.value) }))}
            style={numberInput}
          />
        </div>
        <div>
          <label style={{ ...fieldLabel, fontSize: 12, marginBottom: 4 }}>
            Affinity floor — slope <span style={{ color: "var(--muted)", fontWeight: 400 }}>(default {DEFAULT_TUNING.affinitySlope})</span>
          </label>
          <input
            type="number"
            step="0.001"
            value={tuning.affinitySlope}
            onChange={(e) => setTuning((t) => ({ ...t, affinitySlope: Number(e.target.value) }))}
            style={numberInput}
          />
        </div>
        <div>
          <label style={{ ...fieldLabel, fontSize: 12, marginBottom: 4 }}>
            Quality-first score <span style={{ color: "var(--muted)", fontWeight: 400 }}>(default {DEFAULT_QUALITY_FIRST_SCORE})</span>
          </label>
          <input
            type="number"
            value={tuning.qualityFirstScore}
            onChange={(e) => setTuning((t) => ({ ...t, qualityFirstScore: Number(e.target.value) }))}
            style={numberInput}
          />
        </div>
      </div>
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
