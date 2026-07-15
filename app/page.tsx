"use client";

import { useEffect, useRef, useState } from "react";
import type { RouteResult } from "@/lib/types";

const EXAMPLES: { label: string; prompt: string }[] = [
  { label: "Simple", prompt: "Translate 'good morning, how are you?' into Italian." },
  { label: "Creative", prompt: "Write a short 4-line poem about the sea at dawn." },
  {
    label: "Medium",
    prompt:
      "Compare REST and GraphQL for a mobile app backend. List pros and cons, then recommend one.",
  },
  {
    label: "Coding",
    prompt:
      "Here is a function:\n```js\nfunction dedupe(a){return a.filter((x,i)=>a.indexOf(x)===i)}\n```\nRefactor it to be O(n) and explain why the original is slower.",
  },
  {
    label: "Hard reasoning",
    prompt:
      "Analyze and prove why the sum of the first n odd numbers equals n^2. Then derive a closed-form and evaluate it for n=1..5 step by step.",
  },
  {
    label: "High-stakes",
    prompt:
      "Review this employment contract clause for GDPR compliance risks and explain the legal reasoning behind each concern.",
  },
];

const TIER_LABEL: Record<number, string> = {
  1: "Economy",
  2: "Standard",
  3: "Premium",
};
const TIER_COLOR: Record<number, string> = { 1: "var(--green)", 2: "var(--amber)", 3: "var(--red)" };

function usd(n: number): string {
  if (n === 0) return "$0";
  if (Math.abs(n) < 0.01) return `$${n.toFixed(5)}`;
  return `$${n.toFixed(4)}`;
}

const panel: React.CSSProperties = {
  background: "var(--panel)",
  border: "1px solid var(--border)",
  borderRadius: 14,
};

export default function Home() {
  const [prompt, setPrompt] = useState(EXAMPLES[0].prompt);
  const [providerPref, setProviderPref] = useState<"any" | "anthropic" | "openai">("any");
  const [qualityPref, setQualityPref] = useState(50);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<RouteResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const hasResult = useRef(false);

  async function runRoute(q = qualityPref) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/route", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, providerPref, qualityPref: q }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Request failed");
      setResult(data as RouteResult);
      hasResult.current = true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setLoading(false);
    }
  }

  // Live re-route when the slider or provider changes (only after a first run).
  useEffect(() => {
    if (hasResult.current) runRoute();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qualityPref, providerPref]);

  const a = result?.assessment;
  const sv = result?.savingsVsDefault;

  return (
    <main style={{ maxWidth: 1100, margin: "0 auto", padding: "32px 20px 80px" }}>
      <header style={{ marginBottom: 24 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span
            style={{
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: 1,
              color: "var(--accent)",
              border: "1px solid var(--border)",
              borderRadius: 999,
              padding: "3px 10px",
            }}
          >
            ROUTING ENGINE
          </span>
          <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>Metadata-Based Model Router</h1>
        </div>
        <p style={{ color: "var(--muted)", marginTop: 8, fontSize: 14 }}>
          Pick the cheapest capable model <em>before</em> calling the LLM. Baseline is the{" "}
          <strong style={{ color: "var(--text)" }}>NICE Default (Sonnet)</strong> — easy prompts get
          downgraded to save cost, hard prompts stay on the Default or escalate to Premium.
        </p>
      </header>

      <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 20 }}>
        {/* INPUT PANEL */}
        <section style={{ ...panel, padding: 18 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
            {EXAMPLES.map((ex) => (
              <button
                key={ex.label}
                onClick={() => setPrompt(ex.prompt)}
                style={{
                  fontSize: 12,
                  padding: "5px 10px",
                  borderRadius: 8,
                  border: "1px solid var(--border)",
                  background: "var(--panel-2)",
                  color: "var(--text)",
                  cursor: "pointer",
                }}
              >
                {ex.label}
              </button>
            ))}
          </div>

          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={6}
            placeholder="Type a prompt..."
            style={{
              width: "100%",
              background: "var(--bg)",
              color: "var(--text)",
              border: "1px solid var(--border)",
              borderRadius: 10,
              padding: 12,
              fontSize: 14,
              fontFamily: "ui-monospace, monospace",
              resize: "vertical",
            }}
          />

          {/* Quality vs cost slider */}
          <div style={{ marginTop: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--muted)" }}>
              <span>💰 Max cost saving</span>
              <span style={{ color: "var(--text)", fontWeight: 700 }}>
                {qualityPref < 40 ? "Cost-oriented" : qualityPref > 60 ? "Quality-oriented" : "Balanced"} ({qualityPref})
              </span>
              <span>🎯 Max quality</span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              value={qualityPref}
              onChange={(e) => setQualityPref(Number(e.target.value))}
              style={{ width: "100%", marginTop: 6, accentColor: "var(--accent)" }}
            />
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 16,
              marginTop: 14,
              flexWrap: "wrap",
            }}
          >
            <label style={{ fontSize: 13, color: "var(--muted)" }}>
              Provider preference&nbsp;
              <select
                value={providerPref}
                onChange={(e) => setProviderPref(e.target.value as typeof providerPref)}
                style={{
                  background: "var(--panel-2)",
                  color: "var(--text)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  padding: "4px 8px",
                }}
              >
                <option value="any">Any (cheapest)</option>
                <option value="anthropic">Anthropic</option>
                <option value="openai">OpenAI</option>
              </select>
            </label>

            {/* Coming soon — future optional real answer via Claude CLI */}
            <label
              title="Coming soon"
              style={{
                fontSize: 13,
                color: "var(--muted)",
                display: "flex",
                gap: 6,
                alignItems: "center",
                opacity: 0.55,
                cursor: "not-allowed",
              }}
            >
              <input type="checkbox" disabled />
              Run real answer via Claude CLI
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: 0.5,
                  color: "var(--accent)",
                  border: "1px solid var(--border)",
                  borderRadius: 999,
                  padding: "1px 7px",
                }}
              >
                COMING SOON
              </span>
            </label>

            <button
              onClick={() => runRoute()}
              disabled={loading || !prompt.trim()}
              style={{
                marginLeft: "auto",
                background: "var(--accent)",
                color: "#04122e",
                fontWeight: 700,
                border: "none",
                borderRadius: 10,
                padding: "9px 20px",
                cursor: loading ? "default" : "pointer",
                opacity: loading || !prompt.trim() ? 0.6 : 1,
              }}
            >
              {loading ? "Routing…" : "Route prompt"}
            </button>
          </div>
        </section>

        {error && (
          <div style={{ ...panel, padding: 14, borderColor: "var(--red)", color: "var(--red)" }}>
            {error}
          </div>
        )}

        {/* RESULTS */}
        {result && a && sv && (
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
                  <div style={{ marginTop: 6, fontSize: 13, color: "var(--muted)" }}>
                    Est. cost {usd(result.selected.cost.totalCost)} · ~{a.estInputTokens} in / ~
                    {a.estOutputTokens} out tokens
                  </div>
                  <div style={{ marginTop: 4, fontSize: 12, color: "var(--muted)" }}>
                    raw complexity {a.score} · quality bias {result.qualityBias >= 0 ? "+" : ""}
                    {result.qualityBias} → adjusted {result.adjustedScore}
                  </div>
                </div>
                <SavingsBadge absolute={sv.absolute} percent={sv.percent} />
              </div>
            </section>

            {/* Comparison table */}
            <section style={{ ...panel, padding: 18 }}>
              <h2 style={{ fontSize: 15, fontWeight: 700, margin: "0 0 12px" }}>
                Cost comparison — all models for this prompt
              </h2>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ color: "var(--muted)", textAlign: "left" }}>
                      <th style={th}>Model</th>
                      <th style={th}>Provider</th>
                      <th style={th}>Class</th>
                      <th style={{ ...th, textAlign: "right" }}>Est. cost / call</th>
                      <th style={{ ...th, textAlign: "right" }}>vs Default</th>
                      <th style={th}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.catalog.map((c) => {
                      const delta = result.niceDefault.cost.totalCost - c.cost.totalCost;
                      const deltaPct =
                        result.niceDefault.cost.totalCost > 0
                          ? (delta / result.niceDefault.cost.totalCost) * 100
                          : 0;
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
                          <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                            {usd(c.cost.totalCost)}
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
                            {c.isNiceDefault && <Chip color="var(--amber)">NICE DEFAULT</Chip>}
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
                Why this score? — feature contributions
              </h2>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {a.contributions.map((c) => (
                  <ContribRow key={c.key} c={c} />
                ))}
              </div>
            </section>

            {/* Real answer — coming soon placeholder */}
            <section
              style={{
                ...panel,
                padding: 22,
                borderStyle: "dashed",
                textAlign: "center",
                color: "var(--muted)",
              }}
            >
              <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>
                Real model answer — coming soon
              </div>
              <p style={{ fontSize: 13, margin: "8px auto 0", maxWidth: 560 }}>
                Next step: an optional switch to actually run the selected model (and the NICE
                Default for comparison) via the local Claude CLI, to verify the choice was good
                enough. The routing decision above is already final and real.
              </p>
            </section>
          </>
        )}
      </div>
    </main>
  );
}

const th: React.CSSProperties = { padding: "6px 10px", fontWeight: 600, fontSize: 12 };
const td: React.CSSProperties = { padding: "9px 10px" };

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
        <div style={{ fontSize: 12, color: "var(--muted)" }}>Saved vs NICE Default</div>
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
        <div style={{ fontSize: 12, color: "var(--muted)" }}>vs NICE Default (hard task)</div>
      </div>
    );
  }
  return (
    <div style={{ textAlign: "right", background: "rgba(251,191,36,0.08)", border: "1px solid var(--amber)", borderRadius: 12, padding: "10px 16px" }}>
      <div style={{ fontSize: 12, color: "var(--muted)" }}>On the standard</div>
      <div style={{ fontSize: 15, fontWeight: 800, color: "var(--amber)" }}>NICE Default</div>
      <div style={{ fontSize: 12, color: "var(--muted)" }}>no downgrade</div>
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
