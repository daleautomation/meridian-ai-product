"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { PERSONAL_NAV, personalPalette, type PersonalNavId } from "@/lib/personal-workspace/config";
import {
  isContactCardProminent,
  isContactCardSelected,
  resolveSelectedContact,
  syncSelectedId,
} from "@/lib/personal-workspace/selection";
import type { PersonalContactCard, PersonalInsightRow, PersonalWorkspaceModel } from "@/lib/personal-workspace/workspace";

interface PersonalWorkspaceProps {
  model: PersonalWorkspaceModel;
}

export default function PersonalWorkspace({ model }: PersonalWorkspaceProps) {
  const [activeNav, setActiveNav] = useState<PersonalNavId>("priority");
  const [selectedId, setSelectedId] = useState(model.priorityContacts[0]?.id ?? "");
  const copy = model.copy;
  const sectionMeta = PERSONAL_NAV.find((n) => n.id === activeNav);

  const visibleContacts = useMemo(() => contactsForNav(model, activeNav), [model, activeNav]);

  useEffect(() => {
    const synced = syncSelectedId(visibleContacts, selectedId);
    if (synced !== selectedId) setSelectedId(synced);
  }, [visibleContacts, selectedId]);

  const selected = useMemo(
    () => resolveSelectedContact(visibleContacts, selectedId),
    [visibleContacts, selectedId],
  );

  return (
    <main style={styles.shell}>
      <header style={styles.header}>
        <div>
          <div style={styles.eyebrow}>{copy.eyebrow}</div>
          <h1 style={styles.title}>{copy.title}</h1>
          <p style={styles.subtitle}>{copy.subtitle}</p>
        </div>
        <div style={styles.headerActions}>
          <Link href={model.importPath} style={styles.importLink}>
            {copy.importCta}
          </Link>
          <span style={styles.workspaceBadge}>
            {model.workspace.name}
            {model.crmContactCount > 0 ? (
              <span style={styles.countPill}>{model.crmContactCount} contacts</span>
            ) : null}
          </span>
        </div>
      </header>

      <nav aria-label={copy.eyebrow} style={styles.nav}>
        {model.nav.map((item) => {
          const active = item.id === activeNav;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                setActiveNav(item.id);
                const nextList = contactsForNav(model, item.id);
                setSelectedId(syncSelectedId(nextList, selectedId));
              }}
              style={{
                ...styles.navButton,
                ...(active ? styles.navButtonActive : null),
              }}
            >
              <span>{item.label}</span>
              <span style={active ? styles.navCountActive : styles.navCount}>{item.count}</span>
            </button>
          );
        })}
      </nav>

      {model.reachability.phoneLight && model.crmContactCount > 0 ? (
        <p style={styles.reachabilityBanner}>{model.reachability.summary}</p>
      ) : null}

      <section style={styles.dashboard}>
        <div style={styles.heroCard}>
          <div style={styles.heroLabel}>{model.hero.focus}</div>
          <p style={styles.heroAnswer}>{model.hero.answer}</p>
        </div>
        <SummaryMetric label="Contacts" value={String(model.summary.totalContacts)} />
        <SummaryMetric label="Priority" value={String(model.summary.priorityCount)} />
        <SummaryMetric label="Follow-ups" value={String(model.summary.followUpsDue)} />
        <SummaryMetric
          label="Avg. strength"
          value={`${model.summary.averageStrength}%`}
          hint={model.crmContactCount > 0 ? "Baseline import scores" : undefined}
        />
      </section>

      {model.resurfacingHighlights.length > 0 ? (
        <section style={styles.resurfacingStrip} aria-label={copy.resurfacingTitle}>
          <h2 style={styles.resurfacingTitle}>{copy.resurfacingTitle}</h2>
          <div style={styles.resurfacingList}>
            {model.resurfacingHighlights.map((h) => (
              <article key={`${h.bucketId}-${h.contactId}`} style={styles.resurfacingCard}>
                <div style={styles.resurfacingMeta}>
                  <strong>{h.contactName}</strong>
                  <span style={styles.resurfacingBucket}>{h.bucketLabel}</span>
                </div>
                <p style={styles.resurfacingWhy}>{h.whyNow}</p>
                <div style={styles.trustBadgeRow}>
                  <span style={styles.verificationBadge}>{h.verificationStatusLabel}</span>
                  <span style={styles.dataQualityBadge}>{h.dataQualityLabel}</span>
                </div>
                <p style={styles.resurfacingAction}>{h.recommendedAction}</p>
                <p style={styles.resurfacingEvidence}>{h.recommendationWhy}</p>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <section style={styles.body}>
        <div style={styles.listColumn}>
          <div style={styles.sectionHeader}>
            <div>
              <h2 style={styles.sectionTitle}>{sectionMeta?.label ?? activeNav}</h2>
              <p style={styles.sectionDesc}>{sectionMeta?.description}</p>
            </div>
            <span style={styles.muted}>
              {activeNav === "insights"
                ? `${model.insights.length} insights`
                : `${visibleContacts.length} contacts`}
            </span>
          </div>

          {activeNav === "insights" ? (
            model.insights.length === 0 ? (
              <EmptySection
                message={model.emptyByNav.insights}
                showImport={model.crmContactCount === 0}
                importPath={model.importPath}
                importCta={copy.importCta}
              />
            ) : (
              <InsightsList insights={model.insights} />
            )
          ) : visibleContacts.length === 0 ? (
            <EmptySection
              message={model.emptyByNav[activeNav] ?? copy.emptyContacts}
              showImport={model.crmContactCount === 0}
              importPath={model.importPath}
              importCta={copy.importCta}
            />
          ) : (
            <div style={styles.cardList}>
              {visibleContacts.map((card, index) => (
                <ContactCard
                  key={card.id}
                  card={card}
                  emailPrimaryLabel={copy.emailPrimaryBadge}
                  selected={isContactCardSelected(card.id, selectedId)}
                  prominent={isContactCardProminent(index, activeNav, card.id, selectedId)}
                  onSelect={() => setSelectedId(card.id)}
                />
              ))}
            </div>
          )}
        </div>

        <ContactDetailPanel
          card={activeNav === "insights" ? null : selected}
          copy={copy}
        />
      </section>
    </main>
  );
}

function contactsForNav(model: PersonalWorkspaceModel, nav: PersonalNavId): PersonalContactCard[] {
  if (nav === "all") return model.allContacts;
  if (nav === "follow-ups") return model.followUps;
  if (nav === "dormant") return model.dormantOpportunities;
  if (nav === "missing") return model.missingInformation;
  return model.priorityContacts;
}

function EmptySection({
  message,
  showImport,
  importPath,
  importCta,
}: {
  message: string;
  showImport: boolean;
  importPath: string;
  importCta: string;
}) {
  return (
    <div style={styles.empty}>
      <p>{message}</p>
      {showImport ? (
        <Link href={importPath} style={styles.emptyLink}>
          {importCta}
        </Link>
      ) : null}
    </div>
  );
}

function InsightsList({ insights }: { insights: PersonalInsightRow[] }) {
  if (insights.length === 0) {
    return null;
  }
  return (
    <div style={styles.cardList}>
      {insights.map((row) => (
        <article key={row.id} style={styles.insightCard}>
          <div style={styles.insightTop}>
            <strong>{row.name}</strong>
            <span style={styles.strengthPill}>{row.strength}%</span>
          </div>
          <div style={styles.muted}>{row.company}</div>
          <p style={styles.insightText}>{row.insight}</p>
        </article>
      ))}
    </div>
  );
}

function ContactCard({
  card,
  emailPrimaryLabel,
  selected,
  prominent,
  onSelect,
}: {
  card: PersonalContactCard;
  emailPrimaryLabel: string;
  selected: boolean;
  prominent?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      style={{
        ...styles.contactCard,
        ...(selected ? styles.contactCardSelected : null),
        ...(prominent ? styles.contactCardProminent : null),
      }}
    >
      <div style={styles.cardTop}>
        <span style={styles.rank}>#{card.rank}</span>
        <span style={styles.strengthPill}>{card.strength}%</span>
        <span style={styles.timing}>{card.timing}</span>
      </div>
      <div style={styles.cardNameRow}>
        <div>
          <h3 style={styles.cardName}>{card.name}</h3>
          <div style={styles.muted}>{card.company}</div>
        </div>
        <span style={styles.actionChip}>{card.suggestedActionLabel}</span>
      </div>
      <div style={styles.trustBadgeRow}>
        <span style={styles.verificationBadge}>{card.verificationStatusLabel}</span>
        <span style={styles.dataQualityBadge}>{card.dataQualityLabel}</span>
      </div>
      {card.primaryChannel === "email" ? (
        <span style={styles.emailBadge}>{emailPrimaryLabel}</span>
      ) : null}
      {card.reasons.slice(0, 2).map((reason) => (
        <div key={reason} style={styles.reason}>{reason}</div>
      ))}
    </button>
  );
}

function ContactDetailPanel({
  card,
  copy,
}: {
  card: PersonalContactCard | null;
  copy: PersonalWorkspaceModel["copy"];
}) {
  if (!card) {
    return (
      <aside style={styles.detail}>
        <p style={styles.muted}>Select a contact to review context and next steps.</p>
      </aside>
    );
  }

  return (
    <aside style={styles.detail}>
      <div style={styles.detailHeader}>
        <h2 style={styles.detailTitle}>{card.name}</h2>
        <p style={styles.muted}>{card.company}</p>
        <span style={styles.enrichmentBadge}>{card.enrichmentLabel}</span>
        <div style={styles.trustBadgeRow}>
          <span style={styles.verificationBadge}>{card.verificationStatusLabel}</span>
          <span style={styles.dataQualityBadge}>{card.dataQualityLabel}</span>
        </div>
        <div style={styles.scoreRow}>
          <span style={styles.strengthPill}>{card.strength}% {copy.strengthLabel}</span>
          <span style={styles.scoreMeta}>{card.scoreLabel}</span>
        </div>
        {!card.scoreIsAuthoritative ? (
          <p style={styles.scoreDisclaimer}>{card.scoreExplanation}</p>
        ) : null}
      </div>

      <DetailBlock title={card.nextStepIsTemplate ? "Suggested follow-up template" : "Suggested next step"}>
        <p style={styles.detailBody}>{card.nextStep}</p>
        {card.nextStepIsTemplate ? (
          <p style={styles.templateNote}>{copy.templateNote}</p>
        ) : null}
      </DetailBlock>

      <DetailBlock title="Why this recommendation">
        <p style={styles.detailBody}>{card.recommendationWhy}</p>
        {card.recommendationEvidence.map((line) => (
          <div key={line} style={styles.detailRow}>Evidence: {line}</div>
        ))}
        {card.recommendationMissing.length > 0 ? (
          <div style={styles.warn}>
            Missing: {card.recommendationMissing.join(" · ")}
          </div>
        ) : null}
      </DetailBlock>

      <DetailBlock title="Angle">
        <p style={styles.detailBody}>{card.angle}</p>
      </DetailBlock>

      <DetailBlock title="Scoring basis">
        <div style={styles.detailRow}>Provenance: {card.scoreProvenance}</div>
        {card.scoreReasonCodes.length > 0 ? (
          <div style={styles.detailRow}>
            Reasons: {card.scoreReasonCodes.join(", ")}
          </div>
        ) : (
          <div style={styles.detailRow}>No reason codes recorded</div>
        )}
        <div style={styles.detailRow}>Confidence: {card.source.confidence}</div>
      </DetailBlock>

      <DetailBlock title="Reachability">
        {card.phone ? (
          <div style={card.phoneActionable ? styles.detailRow : styles.detailRowDisabled}>
            Phone: {card.phone}
            {card.phoneDowngraded ? " (review before call)" : ""}
            {!card.phoneActionable ? " — not actionable at current trust" : ""}
          </div>
        ) : null}
        {card.email ? (
          <div style={card.emailActionable ? styles.detailRow : styles.detailRowDisabled}>
            Email: {card.email}
            {card.emailDowngraded ? " (review before send)" : ""}
            {!card.emailActionable ? " — not actionable at current trust" : ""}
          </div>
        ) : null}
        {card.contactMethodNote ? (
          <div style={styles.info}>{card.contactMethodNote}</div>
        ) : null}
        {!card.phone && card.email ? (
          <div style={styles.info}>{card.reachabilityNote ?? copy.noPhoneExplanation}</div>
        ) : null}
        {!card.phone && !card.email ? (
          <div style={styles.warn}>Add contact paths before outreach.</div>
        ) : null}
      </DetailBlock>

      {card.activityMemory.length > 0 ? (
        <DetailBlock title={copy.activityMemoryTitle}>
          {card.activityMemory.map((line) => (
            <div key={line} style={styles.detailRow}>{line}</div>
          ))}
        </DetailBlock>
      ) : null}

      <DetailBlock title="Signals">
        {card.signals.map((s) => (
          <div key={s} style={styles.detailRow}>{s}</div>
        ))}
      </DetailBlock>

      {card.trustNotes.length > 0 ? (
        <DetailBlock title="Trust notes">
          {card.trustNotes.map((note) => (
            <div key={note} style={styles.detailRow}>{note}</div>
          ))}
        </DetailBlock>
      ) : null}

      <div style={styles.detailMeta}>
        <span>{card.source.freshnessLabel}</span>
        <span>Confidence: {card.source.confidence}</span>
      </div>
    </aside>
  );
}

function DetailBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={styles.detailBlock}>
      <h3 style={styles.detailBlockTitle}>{title}</h3>
      {children}
    </section>
  );
}

function SummaryMetric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div style={styles.metric}>
      <div style={styles.metricValue}>{value}</div>
      <div style={styles.metricLabel}>{label}</div>
      {hint ? <div style={styles.metricHint}>{hint}</div> : null}
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  shell: {
    minHeight: "100dvh",
    padding: "28px 24px 48px",
    background: `linear-gradient(180deg, ${personalPalette.bg} 0%, #FFFFFF 100%)`,
    color: personalPalette.text,
    fontFamily: "var(--font-inter), -apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif",
  },
  header: {
    display: "flex",
    flexWrap: "wrap",
    justifyContent: "space-between",
    gap: "16px",
    marginBottom: "20px",
  },
  eyebrow: {
    fontSize: "11px",
    fontWeight: 700,
    letterSpacing: "0.12em",
    textTransform: "uppercase",
    color: personalPalette.accent,
  },
  title: {
    margin: "6px 0 4px",
    fontSize: "28px",
    fontWeight: 600,
    letterSpacing: "-0.03em",
    lineHeight: 1.1,
  },
  subtitle: {
    margin: 0,
    fontSize: "15px",
    color: personalPalette.textMuted,
    maxWidth: "520px",
    lineHeight: 1.5,
  },
  headerActions: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-end",
    gap: "10px",
  },
  importLink: {
    padding: "10px 16px",
    borderRadius: "12px",
    background: personalPalette.accent,
    color: "#fff",
    fontSize: "13px",
    fontWeight: 600,
    textDecoration: "none",
  },
  workspaceBadge: {
    display: "inline-flex",
    alignItems: "center",
    gap: "8px",
    padding: "8px 12px",
    borderRadius: "999px",
    border: `1px solid ${personalPalette.border}`,
    background: personalPalette.surface,
    fontSize: "12px",
    color: personalPalette.textMuted,
  },
  countPill: {
    padding: "2px 8px",
    borderRadius: "999px",
    background: personalPalette.accentSoft,
    color: personalPalette.accent,
    fontWeight: 600,
  },
  nav: {
    display: "flex",
    flexWrap: "wrap",
    gap: "8px",
    marginBottom: "20px",
  },
  navButton: {
    display: "inline-flex",
    alignItems: "center",
    gap: "8px",
    padding: "10px 14px",
    border: `1px solid ${personalPalette.border}`,
    borderRadius: "12px",
    background: personalPalette.surface,
    color: personalPalette.textMuted,
    fontSize: "13px",
    fontWeight: 500,
    cursor: "pointer",
  },
  navButtonActive: {
    background: personalPalette.accentSoft,
    borderColor: personalPalette.accentBorder,
    color: personalPalette.text,
    fontWeight: 600,
  },
  navCount: {
    fontSize: "11px",
    opacity: 0.7,
  },
  navCountActive: {
    fontSize: "11px",
    fontWeight: 700,
    color: personalPalette.accent,
  },
  dashboard: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 2fr) repeat(4, minmax(0, 1fr))",
    gap: "12px",
    marginBottom: "24px",
  },
  heroCard: {
    padding: "18px 20px",
    borderRadius: "16px",
    border: `1px solid ${personalPalette.border}`,
    background: personalPalette.surface,
  },
  heroLabel: {
    fontSize: "11px",
    fontWeight: 600,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    color: personalPalette.textMuted,
    marginBottom: "6px",
  },
  heroAnswer: {
    margin: 0,
    fontSize: "15px",
    lineHeight: 1.45,
    color: personalPalette.text,
  },
  metric: {
    padding: "16px",
    borderRadius: "14px",
    border: `1px solid ${personalPalette.border}`,
    background: personalPalette.surfaceMuted,
    textAlign: "center",
  },
  metricValue: {
    fontSize: "22px",
    fontWeight: 600,
    letterSpacing: "-0.02em",
  },
  metricLabel: {
    marginTop: "4px",
    fontSize: "11px",
    color: personalPalette.textMuted,
    textTransform: "uppercase",
    letterSpacing: "0.06em",
  },
  body: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1.2fr) minmax(280px, 0.8fr)",
    gap: "20px",
    alignItems: "start",
  },
  listColumn: {
    minWidth: 0,
  },
  sectionHeader: {
    display: "flex",
    justifyContent: "space-between",
    gap: "12px",
    marginBottom: "14px",
  },
  sectionTitle: {
    margin: 0,
    fontSize: "18px",
    fontWeight: 600,
  },
  sectionDesc: {
    margin: "4px 0 0",
    fontSize: "13px",
    color: personalPalette.textMuted,
    lineHeight: 1.4,
    maxWidth: "480px",
  },
  muted: {
    color: personalPalette.textMuted,
    fontSize: "13px",
  },
  cardList: {
    display: "grid",
    gap: "10px",
  },
  contactCard: {
    display: "grid",
    gap: "8px",
    width: "100%",
    padding: "14px 16px",
    border: `1px solid ${personalPalette.border}`,
    borderRadius: "14px",
    background: personalPalette.surface,
    textAlign: "left",
    cursor: "pointer",
    color: personalPalette.text,
  },
  contactCardSelected: {
    borderColor: personalPalette.accentBorder,
    boxShadow: `0 0 0 1px ${personalPalette.accentBorder}`,
  },
  contactCardProminent: {
    background: personalPalette.accentSoft,
  },
  cardTop: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    fontSize: "11px",
  },
  rank: {
    fontWeight: 700,
    color: personalPalette.accent,
  },
  strengthPill: {
    padding: "2px 8px",
    borderRadius: "999px",
    background: personalPalette.successBg,
    color: personalPalette.success,
    fontSize: "11px",
    fontWeight: 600,
  },
  timing: {
    marginLeft: "auto",
    color: personalPalette.textMuted,
  },
  cardNameRow: {
    display: "flex",
    justifyContent: "space-between",
    gap: "10px",
    alignItems: "flex-start",
  },
  cardName: {
    margin: 0,
    fontSize: "16px",
    fontWeight: 600,
  },
  actionChip: {
    padding: "4px 10px",
    borderRadius: "999px",
    background: personalPalette.surfaceMuted,
    fontSize: "11px",
    fontWeight: 600,
    whiteSpace: "nowrap",
  },
  reason: {
    fontSize: "13px",
    color: personalPalette.textMuted,
    lineHeight: 1.35,
  },
  insightCard: {
    padding: "14px 16px",
    border: `1px solid ${personalPalette.border}`,
    borderRadius: "14px",
    background: personalPalette.surface,
  },
  insightTop: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "8px",
  },
  insightText: {
    margin: "8px 0 0",
    fontSize: "14px",
    lineHeight: 1.45,
    color: personalPalette.text,
  },
  empty: {
    padding: "32px 20px",
    borderRadius: "14px",
    border: `1px dashed ${personalPalette.border}`,
    background: personalPalette.surfaceMuted,
    textAlign: "center",
    color: personalPalette.textMuted,
    fontSize: "14px",
  },
  emptyLink: {
    display: "inline-block",
    marginTop: "12px",
    color: personalPalette.accent,
    fontWeight: 600,
    textDecoration: "none",
  },
  detail: {
    position: "sticky",
    top: "24px",
    padding: "20px",
    borderRadius: "16px",
    border: `1px solid ${personalPalette.border}`,
    background: personalPalette.surface,
  },
  detailHeader: {
    marginBottom: "16px",
  },
  detailTitle: {
    margin: "0 0 4px",
    fontSize: "20px",
    fontWeight: 600,
  },
  detailBlock: {
    marginBottom: "16px",
  },
  detailBlockTitle: {
    margin: "0 0 8px",
    fontSize: "11px",
    fontWeight: 700,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    color: personalPalette.textMuted,
  },
  detailBody: {
    margin: 0,
    fontSize: "14px",
    lineHeight: 1.45,
  },
  detailRow: {
    fontSize: "13px",
    lineHeight: 1.4,
    marginBottom: "4px",
  },
  warn: {
    fontSize: "13px",
    color: personalPalette.warning,
    background: personalPalette.warningBg,
    padding: "8px 10px",
    borderRadius: "8px",
  },
  info: {
    fontSize: "13px",
    color: personalPalette.textMuted,
    background: personalPalette.accentSoft,
    padding: "8px 10px",
    borderRadius: "8px",
    lineHeight: 1.45,
  },
  reachabilityBanner: {
    margin: "0 0 16px",
    padding: "12px 16px",
    borderRadius: "12px",
    border: `1px solid ${personalPalette.accentBorder}`,
    background: personalPalette.accentSoft,
    fontSize: "14px",
    lineHeight: 1.45,
    color: personalPalette.text,
  },
  resurfacingStrip: {
    marginBottom: "24px",
  },
  resurfacingTitle: {
    margin: "0 0 10px",
    fontSize: "14px",
    fontWeight: 600,
    color: personalPalette.textMuted,
    letterSpacing: "0.04em",
    textTransform: "uppercase",
  },
  resurfacingList: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
    gap: "10px",
  },
  resurfacingCard: {
    padding: "12px 14px",
    borderRadius: "12px",
    border: `1px solid ${personalPalette.border}`,
    background: personalPalette.surface,
  },
  resurfacingMeta: {
    display: "flex",
    justifyContent: "space-between",
    gap: "8px",
    fontSize: "14px",
    marginBottom: "6px",
  },
  resurfacingBucket: {
    fontSize: "11px",
    color: personalPalette.accent,
    fontWeight: 600,
  },
  resurfacingWhy: {
    margin: "0 0 6px",
    fontSize: "13px",
    color: personalPalette.textMuted,
    lineHeight: 1.35,
  },
  resurfacingAction: {
    margin: 0,
    fontSize: "13px",
    lineHeight: 1.35,
  },
  emailBadge: {
    display: "inline-block",
    width: "fit-content",
    padding: "2px 8px",
    borderRadius: "999px",
    background: personalPalette.accentSoft,
    color: personalPalette.accent,
    fontSize: "10px",
    fontWeight: 700,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
  },
  enrichmentBadge: {
    display: "inline-block",
    marginTop: "8px",
    padding: "4px 10px",
    borderRadius: "999px",
    background: personalPalette.surfaceMuted,
    fontSize: "11px",
    fontWeight: 600,
    color: personalPalette.textMuted,
  },
  trustBadgeRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: "6px",
    marginTop: "8px",
  },
  verificationBadge: {
    padding: "3px 8px",
    borderRadius: "999px",
    background: personalPalette.accentSoft,
    color: personalPalette.accent,
    fontSize: "10px",
    fontWeight: 700,
    letterSpacing: "0.04em",
    textTransform: "uppercase",
  },
  dataQualityBadge: {
    padding: "3px 8px",
    borderRadius: "999px",
    border: `1px solid ${personalPalette.border}`,
    background: personalPalette.surface,
    fontSize: "10px",
    fontWeight: 600,
    color: personalPalette.textMuted,
  },
  resurfacingEvidence: {
    margin: "6px 0 0",
    fontSize: "12px",
    color: personalPalette.textMuted,
    lineHeight: 1.45,
  },
  detailRowDisabled: {
    fontSize: "13px",
    lineHeight: 1.5,
    color: personalPalette.textMuted,
    opacity: 0.65,
    textDecoration: "line-through",
    textDecorationColor: personalPalette.border,
  },
  scoreRow: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: "8px",
    marginTop: "10px",
  },
  scoreMeta: {
    fontSize: "12px",
    color: personalPalette.textMuted,
  },
  scoreDisclaimer: {
    margin: "8px 0 0",
    fontSize: "12px",
    lineHeight: 1.4,
    color: personalPalette.warning,
  },
  templateNote: {
    margin: "8px 0 0",
    fontSize: "12px",
    color: personalPalette.textMuted,
    fontStyle: "italic",
  },
  metricHint: {
    marginTop: "4px",
    fontSize: "10px",
    color: personalPalette.textMuted,
  },
  detailMeta: {
    display: "flex",
    flexWrap: "wrap",
    gap: "10px",
    fontSize: "11px",
    color: personalPalette.textMuted,
    paddingTop: "12px",
    borderTop: `1px solid ${personalPalette.border}`,
  },
};
