// Meridian — per-card signal disclosure (T9). Closed by default.
// Renders evaluator contributions verbatim; no charts, badges, or AI copy.

import type { RecoveryBriefItem } from "@/lib/recovery/brief";
import type { SignalContribution } from "@/lib/recovery/signals/types";
import { shortDate } from "@/components/outcomes/format";

type ExtendedContribution = SignalContribution & {
  sourceTier?: string;
  evidenceLabel?: string | null;
  sourceUrl?: string | null;
};

export interface SignalDecompositionProps {
  item: Pick<
    RecoveryBriefItem,
    "signalContributions" | "score" | "headlineSignal" | "weakOnly"
  >;
  now?: Date;
  className?: string;
}

function contributionExtras(contrib: SignalContribution): Pick<
  ExtendedContribution,
  "sourceTier" | "evidenceLabel" | "sourceUrl"
> {
  const ext = contrib as ExtendedContribution;
  return {
    sourceTier: ext.sourceTier,
    evidenceLabel: ext.evidenceLabel ?? null,
    sourceUrl: ext.sourceUrl ?? null,
  };
}

function formatContributionLine(contrib: SignalContribution, now: Date): string {
  const date = shortDate(contrib.observedAt, now);
  return `${contrib.name} · ${contrib.source} · ${date} · weight ${contrib.weight} → applied ${contrib.contribution}`;
}

export function SignalDecomposition({ item, now = new Date(), className }: SignalDecompositionProps) {
  const contributions = item.signalContributions ?? [];
  const count = contributions.length;

  return (
    <details
      className={className}
      data-meridian="signal-decomposition"
      style={{
        marginTop: 18,
        fontSize: 12,
        color: "#687381",
      }}
    >
      <summary
        style={{
          cursor: "pointer",
          color: "#687381",
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          listStyle: "none",
          userSelect: "none",
        }}
      >
        Show signals · {count}
      </summary>

      <div
        style={{
          marginTop: 10,
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        <dl
          style={{
            margin: 0,
            display: "grid",
            gridTemplateColumns: "auto 1fr",
            gap: "4px 12px",
            fontSize: 12,
            lineHeight: 1.5,
            color: "#2f3a46",
          }}
        >
          <dt style={{ color: "#9aa3ad", fontWeight: 600 }}>Total score</dt>
          <dd style={{ margin: 0 }}>{item.score}</dd>
          <dt style={{ color: "#9aa3ad", fontWeight: 600 }}>Headline signal</dt>
          <dd style={{ margin: 0 }}>{item.headlineSignal ?? "—"}</dd>
          <dt style={{ color: "#9aa3ad", fontWeight: 600 }}>Weak only</dt>
          <dd style={{ margin: 0 }}>{item.weakOnly ? "yes" : "no"}</dd>
        </dl>

        {count === 0 ? (
          <p style={{ margin: 0, color: "#2f3a46", fontSize: 13, lineHeight: 1.5 }}>
            No usable source-backed signals yet.
          </p>
        ) : (
          <ul
            style={{
              margin: 0,
              padding: 0,
              listStyle: "none",
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            {contributions.map((contrib) => {
              const { sourceTier, evidenceLabel, sourceUrl } = contributionExtras(contrib);
              const href = contrib.evidenceUrl ?? sourceUrl;
              return (
                <li
                  key={`${contrib.name}-${contrib.recordId}-${contrib.observedAt}`}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 4,
                    color: "#2f3a46",
                    fontSize: 12,
                    lineHeight: 1.5,
                  }}
                >
                  <span>{formatContributionLine(contrib, now)}</span>
                  <span style={{ color: "#687381" }}>
                    confidence {contrib.confidence}
                    {sourceTier ? ` · tier ${sourceTier}` : null}
                    {evidenceLabel ? ` · ${evidenceLabel}` : null}
                    {` · record ${contrib.recordId}`}
                  </span>
                  {href ? (
                    <a
                      href={href}
                      style={{ color: "#5b6673", fontSize: 12 }}
                      rel="noopener noreferrer"
                      target="_blank"
                    >
                      {contrib.evidenceUrl ? "Evidence" : "Source"}
                    </a>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </details>
  );
}
