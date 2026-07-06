"use client";

import { useState } from "react";

const BUTTONS: Array<{ key: string; label: string }> = [
  { key: "did_this", label: "I did this" },
  { key: "ignored", label: "I ignored this" },
  { key: "better_than_expected", label: "Better than expected" },
  { key: "worse_than_expected", label: "Worse than expected" },
];

export default function RecommendationFeedback({
  subjectKey,
  subjectLabel,
  rank,
}: {
  subjectKey: string;
  subjectLabel: string;
  rank: number;
}) {
  const [sent, setSent] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  async function send(feedback: string) {
    setPending(feedback);
    try {
      const res = await fetch("/api/reality/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subjectKey, subjectLabel, feedback, rank }),
      });
      setSent(res.ok ? feedback : null);
    } catch {
      setSent(null);
    } finally {
      setPending(null);
    }
  }

  return (
    <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
      {BUTTONS.map((b) => {
        const active = sent === b.key;
        return (
          <button
            key={b.key}
            onClick={() => send(b.key)}
            disabled={pending !== null}
            style={{
              fontSize: 12,
              padding: "5px 11px",
              borderRadius: 7,
              cursor: pending ? "default" : "pointer",
              border: `1px solid ${active ? "#3ba55d" : "#2a2f3a"}`,
              background: active ? "#173a25" : "#171b23",
              color: active ? "#7fe0a0" : "#c3cad6",
            }}
          >
            {active ? `✓ ${b.label}` : b.label}
          </button>
        );
      })}
    </div>
  );
}
