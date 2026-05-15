"use client";

import { useMemo, useState, type CSSProperties } from "react";
import { palette } from "@/lib/theme";
import type {
  RelationshipPriorityCard,
  RelationshipPriorityNavId,
  RelationshipPriorityWorkspaceModel,
} from "@/lib/relationship-priority/workspace";

interface RelationshipPriorityWorkspaceProps {
  model: RelationshipPriorityWorkspaceModel;
}

export default function RelationshipPriorityWorkspace({
  model,
}: RelationshipPriorityWorkspaceProps) {
  const showcase = model.showcase;
  const [activeNav, setActiveNav] = useState<RelationshipPriorityNavId>(
    showcase?.preset.initialNav ?? "priority",
  );
  const [selectedId, setSelectedId] = useState(model.priorityQueue[0]?.id ?? "");
  const selected = useMemo(
    () => model.priorityQueue.find((card) => card.id === selectedId) ?? model.priorityQueue[0] ?? null,
    [model.priorityQueue, selectedId],
  );
  const visibleQueue = queueForNav(model, activeNav);

  return (
    <main
      className={showcase ? "relationship-priority-showcase-shell" : undefined}
      style={{
        ...styles.shell,
        ...(showcase ? showcaseShellStyle(showcase) : null),
      }}
    >
      <section style={{ ...styles.chrome, ...(showcase ? styles.showcaseChrome : null) }}>
        <div style={styles.header}>
          <div>
            <div style={{ ...styles.eyebrow, ...(showcase ? styles.showcaseEyebrow : null) }}>
              {showcase ? "MERIDIAN SHOWCASE MODE" : "MERIDIAN RELATIONSHIP DESK"}
            </div>
            <h1 style={{ ...styles.title, ...(showcase ? styles.showcaseTitle : null) }}>
              {showcase ? `${showcase.vertical.label} Priority Queue` : "Today's Priority Queue"}
            </h1>
            <p style={{ ...styles.subtitle, ...(showcase ? styles.showcaseSubtitle : null) }}>
              {model.hero.question}
            </p>
          </div>
          <div style={{ ...styles.workspaceBadge, ...(showcase ? styles.showcaseWorkspaceBadge : null) }}>
            <span style={styles.statusDot} />
            {model.workspace.name}
            {model.demoMode ? (
              <span style={{ ...styles.demoPill, ...(showcase ? styles.showcaseDemoPill : null) }}>
                {showcase ? showcase.preset.label : "Demo ready"}
              </span>
            ) : null}
          </div>
        </div>

        <nav
          aria-label="Relationship workspace navigation"
          style={{ ...styles.nav, ...(showcase ? styles.showcaseNav : null) }}
        >
          {model.nav.map((item) => {
            const selectedNav = item.id === activeNav;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveNav(item.id)}
                className="relationship-priority-nav-button"
                style={{
                  ...styles.navButton,
                  ...(selectedNav ? styles.navButtonActive : null),
                  ...(showcase && selectedNav ? styles.showcaseNavButtonActive : null),
                }}
              >
                <span>{item.label}</span>
                <span style={selectedNav ? styles.navCountActive : styles.navCount}>
                  {item.count}
                </span>
              </button>
            );
          })}
        </nav>

        {showcase ? <ShowcaseStoryStrip showcase={showcase} /> : null}

        <section style={{ ...styles.heroGrid, ...(showcase ? styles.showcaseHeroGrid : null) }}>
          <div style={{ ...styles.heroCard, ...(showcase ? styles.showcaseHeroCard : null) }}>
            <div style={styles.heroLabel}>{model.hero.focus}</div>
            <div style={styles.heroAnswer}>{model.hero.answer}</div>
            <div style={styles.heroActions}>
              <ActionButton label="Call" primary />
              <ActionButton label="Email" />
              <ActionButton label="Follow Up" />
              <ActionButton label="Assign" />
              <ActionButton label="Open Context" />
            </div>
          </div>
          <Metric label={showcase ? "Ready now" : "Ready now"} value={String(model.summary.readyNowCount)} />
          <Metric label={showcase ? "Avg. confidence" : "Avg. fit"} value={`${model.summary.averageMarketFit}%`} />
          <Metric
            label={showcase ? showcase.screenSafe.label : "Compressed signals"}
            value={showcase ? "9:16" : String(model.summary.compressedSignals)}
          />
        </section>

        <section style={{ ...styles.bodyGrid, ...(showcase ? styles.showcaseBodyGrid : null) }}>
          <div style={styles.queueColumn}>
            <div style={styles.sectionHeader}>
              <div>
                <div style={styles.sectionKicker}>{activeNavLabel(activeNav)}</div>
                <h2 style={styles.sectionTitle}>{laneTitle(activeNav, model)}</h2>
              </div>
              <div style={styles.mutedText}>
                {visibleQueue.length} relationships
              </div>
            </div>

            <div style={styles.queueList}>
              {activeNav === "outcomes" ? (
                showcase ? <BeforeAfterLane showcase={showcase} /> : <OutcomesLane model={model} />
              ) : activeNav === "assistant" ? (
                <AssistantLane model={model} selected={selected} />
              ) : (
                <>
                  {visibleQueue.map((card, index) => (
                    <PriorityCard
                      key={card.id}
                      card={card}
                      selected={selected?.id === card.id}
                      dominant={index === 0}
                      showcase={showcase}
                      onSelect={() => setSelectedId(card.id)}
                    />
                  ))}
                  {visibleQueue.length === 0 ? (
                    <div style={styles.emptyState}>
                      No relationships in this lane. Priority work stays in the main queue.
                    </div>
                  ) : null}
                </>
              )}
            </div>
          </div>

          <RelationshipContextPanel card={selected} model={model} />
        </section>
      </section>
    </main>
  );
}

function queueForNav(
  model: RelationshipPriorityWorkspaceModel,
  nav: RelationshipPriorityNavId,
): RelationshipPriorityCard[] {
  if (nav === "recovery") return model.recoveryQueue;
  if (nav === "follow-up") return model.followUpQueue;
  if (nav === "outcomes") return model.priorityQueue.slice(0, 4);
  if (nav === "assistant") return model.priorityQueue.slice(0, 3);
  return model.priorityQueue;
}

function activeNavLabel(nav: RelationshipPriorityNavId): string {
  if (nav === "recovery") return "Recovery";
  if (nav === "follow-up") return "Follow-up";
  if (nav === "outcomes") return "Outcomes";
  if (nav === "assistant") return "Assistant";
  return "Priority queue";
}

function laneTitle(nav: RelationshipPriorityNavId, model: RelationshipPriorityWorkspaceModel): string {
  if (model.showcase) {
    if (nav === "outcomes") return "Cluttered CRM becomes a Meridian priority queue";
    if (nav === "recovery") return `${model.showcase.vertical.label} relationships that can still be recovered`;
    if (nav === "follow-up") return "Promised follow-ups before momentum fades";
    return model.showcase.preset.heroFocus;
  }
  if (nav === "recovery") return "Relationships that need recovery";
  if (nav === "follow-up") return "Follow-ups due before momentum fades";
  if (nav === "outcomes") return "Execution outcomes ready to capture";
  if (nav === "assistant") return "AI assistance for the selected relationship";
  return "Who deserves attention first";
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div style={styles.metricCard}>
      <div style={styles.metricValue}>{value}</div>
      <div style={styles.metricLabel}>{label}</div>
    </div>
  );
}

function OutcomesLane({ model }: { model: RelationshipPriorityWorkspaceModel }) {
  return (
    <div style={styles.specialLane}>
      <div style={styles.specialLaneHero}>
        <div style={styles.sectionKicker}>Outcomes</div>
        <h3 style={styles.specialLaneTitle}>Capture only what changes the next action.</h3>
        <p style={styles.specialLaneCopy}>
          Meridian keeps outcome work compressed: one result, one next step, one owner.
        </p>
      </div>
      {model.outcomeNotes.map((outcome) => (
        <div key={outcome.id} style={styles.outcomeCard}>
          <span style={styles.outcomeIcon}>OK</span>
          <div>
            <strong>{outcome.label}</strong>
            <div style={styles.mutedText}>{outcome.detail}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function AssistantLane({
  model,
  selected,
}: {
  model: RelationshipPriorityWorkspaceModel;
  selected: RelationshipPriorityCard | null;
}) {
  return (
    <div style={styles.specialLane}>
      <div style={styles.assistantHero}>
        <div style={styles.sectionKicker}>Assistant</div>
        <h3 style={styles.specialLaneTitle}>
          {selected ? `Work the angle for ${selected.company}` : "Select a relationship to activate the assistant"}
        </h3>
        <p style={styles.specialLaneCopy}>
          The assistant starts from the selected relationship&apos;s signals, not a blank chat.
        </p>
      </div>
      {model.assistantPrompts.map((prompt) => (
        <button key={prompt} type="button" style={styles.assistantPromptCard}>
          <span style={styles.assistantSpark}>*</span>
          {prompt}
        </button>
      ))}
    </div>
  );
}

function ShowcaseStoryStrip({
  showcase,
}: {
  showcase: NonNullable<RelationshipPriorityWorkspaceModel["showcase"]>;
}) {
  return (
    <section style={styles.showcaseStoryStrip} aria-label="Showcase narrative">
      <div style={styles.showcaseStoryPrimary}>
        <span style={styles.showcaseAccentDot} />
        <div>
          <div style={styles.sectionKicker}>{showcase.vertical.eyebrow}</div>
          <strong>{showcase.narratives[0]}</strong>
        </div>
      </div>
      <div style={styles.showcaseStoryPills}>
        <span style={styles.showcaseStoryPill}>{showcase.vertical.queueLabel}</span>
        <span style={styles.showcaseStoryPill}>{showcase.preset.label}</span>
        <span style={styles.showcaseStoryPill}>{showcase.screenSafe.detail}</span>
      </div>
    </section>
  );
}

function BeforeAfterLane({
  showcase,
}: {
  showcase: NonNullable<RelationshipPriorityWorkspaceModel["showcase"]>;
}) {
  return (
    <div style={styles.beforeAfterGrid}>
      <BeforeAfterPanel title={showcase.beforeAfter.beforeTitle} items={showcase.beforeAfter.beforeItems} muted />
      <div style={styles.beforeAfterArrow}>-&gt;</div>
      <BeforeAfterPanel title={showcase.beforeAfter.afterTitle} items={showcase.beforeAfter.afterItems} />
    </div>
  );
}

function BeforeAfterPanel({
  title,
  items,
  muted,
}: {
  title: string;
  items: string[];
  muted?: boolean;
}) {
  return (
    <article style={{ ...styles.beforeAfterPanel, ...(muted ? styles.beforeAfterPanelMuted : null) }}>
      <div style={styles.sectionKicker}>{muted ? "Before" : "After"}</div>
      <h3 style={styles.beforeAfterTitle}>{title}</h3>
      <div style={styles.beforeAfterList}>
        {items.map((item) => (
          <div key={item} style={styles.reasonItem}>
            <span style={muted ? styles.beforeDot : styles.reasonDot} />
            {item}
          </div>
        ))}
      </div>
    </article>
  );
}

function PriorityCard({
  card,
  selected,
  dominant,
  showcase,
  onSelect,
}: {
  card: RelationshipPriorityCard;
  selected: boolean;
  dominant: boolean;
  showcase?: RelationshipPriorityWorkspaceModel["showcase"];
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="relationship-priority-card"
      style={{
        ...styles.priorityCard,
        ...(dominant ? styles.priorityCardDominant : null),
        ...(selected ? styles.priorityCardSelected : null),
        ...(dominant && showcase ? styles.showcasePriorityCardDominant : null),
        ...(selected && showcase ? styles.showcasePriorityCardSelected : null),
      }}
    >
      <div style={styles.cardTopline}>
        <span
          style={{
            ...(dominant ? styles.rankBadgeDominant : styles.rankBadge),
            ...(dominant && showcase ? styles.showcaseRankBadgeDominant : null),
          }}
        >
          #{card.rank}
        </span>
        <span style={fitStyle(card.marketFit)}>{card.marketFit}% fit</span>
        <span style={urgencyStyle(card.urgency)}>{card.urgency}</span>
      </div>
      <div style={styles.cardTitleRow}>
        <div>
          <h3 style={dominant ? styles.cardTitleDominant : styles.cardTitle}>{card.company}</h3>
          <div style={styles.cardRelationship}>{card.relationship}</div>
        </div>
        <div style={styles.actionChip}>{card.recommendedAction}</div>
      </div>
      <div style={styles.reasonList}>
        {card.topReasons.slice(0, dominant ? 3 : 2).map((reason) => (
          <div key={reason} style={styles.reasonItem}>
            <span style={styles.reasonDot} />
            {reason}
          </div>
        ))}
      </div>
      <div style={styles.nextStep}>{card.nextStep}</div>
      {dominant && showcase ? (
        <div style={styles.showcaseFocusGrid}>
          <FocusItem label="Who matters" value={card.company} />
          <FocusItem label="Why now" value={card.topReasons[0]} />
          <FocusItem label="Next action" value={card.nextStep} />
        </div>
      ) : null}
      <div style={styles.contactRow}>
        <span>{card.bestContact.name}</span>
        <span style={styles.contactDivider}>/</span>
        <span>{card.contactMethods[0]?.value ?? "Contact pending"}</span>
      </div>
    </button>
  );
}

function FocusItem({ label, value }: { label: string; value: string }) {
  return (
    <div style={styles.focusItem}>
      <span style={styles.focusLabel}>{label}</span>
      <strong style={styles.focusValue}>{value}</strong>
    </div>
  );
}

function RelationshipContextPanel({
  card,
  model,
}: {
  card: RelationshipPriorityCard | null;
  model: RelationshipPriorityWorkspaceModel;
}) {
  const showcase = model.showcase;
  if (!card) {
    return (
      <aside style={styles.contextPanel}>
        <div style={styles.emptyState}>Select a relationship to open context.</div>
      </aside>
    );
  }

  return (
    <aside style={styles.contextPanel}>
      <div style={styles.contextHeader}>
        <div>
          <div style={styles.sectionKicker}>Relationship context</div>
          <h2 style={styles.contextTitle}>{card.company}</h2>
          <p style={styles.contextSubtitle}>{card.suggestedAngle}</p>
        </div>
        <span style={fitStyle(card.marketFit)}>{card.marketFit}%</span>
      </div>

      <div style={styles.contextActions}>
        <ActionButton label="Call" primary={card.recommendedAction === "Call"} />
        <ActionButton label="Email" primary={card.recommendedAction === "Email"} />
        <ActionButton label="Follow Up" primary={card.recommendedAction === "Follow Up"} />
        <ActionButton label="Assign" primary={card.recommendedAction === "Assign"} />
      </div>

      <ContextBlock title="Best contact">
        <div style={styles.contactCard}>
          <div>
            <strong>{card.bestContact.name}</strong>
            <div style={styles.mutedText}>{card.bestContact.title}</div>
          </div>
          <div style={styles.contactMethods}>
            {card.contactMethods.map((method) => (
              <span key={`${method.type}-${method.value}`} style={styles.methodPill}>
                {method.type}: {method.value}
              </span>
            ))}
          </div>
        </div>
      </ContextBlock>

      <ContextBlock title="Top signals">
        {card.topSignals.map((signal) => (
          <div key={signal} style={styles.signalRow}>{signal}</div>
        ))}
      </ContextBlock>

      {showcase ? (
        <ContextBlock title="Demo narrative">
          {showcase.narratives.map((item) => (
            <div key={item} style={styles.timelineItem}>{item}</div>
          ))}
        </ContextBlock>
      ) : (
        <>
          <ContextBlock title="Relationship history">
            {card.relationshipHistory.map((item) => (
              <div key={item} style={styles.timelineItem}>{item}</div>
            ))}
          </ContextBlock>

          <ContextBlock title="Follow-up history">
            {card.followUpHistory.length > 0
              ? card.followUpHistory.map((item) => <div key={item} style={styles.timelineItem}>{item}</div>)
              : <div style={styles.mutedText}>No noisy task wall. Follow-ups appear only when they change the next action.</div>}
          </ContextBlock>

          <ContextBlock title="Assistant">
            {model.assistantPrompts.map((prompt) => (
              <button key={prompt} type="button" style={styles.promptButton}>{prompt}</button>
            ))}
          </ContextBlock>
        </>
      )}

      <div style={styles.compressionBox}>
        <div style={styles.sectionKicker}>{showcase ? "Showcase compression" : "Execution compression"}</div>
        {model.simplificationNotes.map((note) => (
          <div key={note} style={styles.compressionNote}>{note}</div>
        ))}
      </div>
    </aside>
  );
}

function ContextBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={styles.contextBlock}>
      <h3 style={styles.contextBlockTitle}>{title}</h3>
      <div style={styles.contextBlockBody}>{children}</div>
    </section>
  );
}

function ActionButton({
  label,
  primary,
}: {
  label: string;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      className="relationship-priority-action"
      style={{
        ...styles.actionButton,
        ...(primary ? styles.actionButtonPrimary : null),
      }}
    >
      {label}
    </button>
  );
}

function fitStyle(value: number): CSSProperties {
  return {
    ...styles.fitPill,
    color: value >= 90 ? palette.success : palette.blue,
    background: value >= 90 ? palette.successBg : palette.bluePale,
    borderColor: value >= 90 ? "rgba(22, 163, 74, 0.18)" : palette.blueBorder,
  };
}

function urgencyStyle(value: RelationshipPriorityCard["urgency"]): CSSProperties {
  return {
    ...styles.urgencyPill,
    color: value === "Now" ? palette.orange : value === "Today" ? palette.warning : palette.textSecondary,
    background: value === "Now" ? palette.orangePale : value === "Today" ? palette.warningBg : palette.surfaceHover,
    boxShadow: value === "Now" ? `0 0 0 4px ${palette.orangeGlow}` : undefined,
  };
}

function showcaseShellStyle(
  showcase: NonNullable<RelationshipPriorityWorkspaceModel["showcase"]>,
): CSSProperties {
  return {
    background:
      `radial-gradient(circle at 50% -8%, ${showcase.vertical.glow}, transparent 28%), ` +
      "radial-gradient(circle at 18% 0%, rgba(37,99,235,0.16), transparent 30%), " +
      "linear-gradient(180deg, #FBFDFF 0%, #F4F7FC 100%)",
  };
}

const styles: Record<string, CSSProperties> = {
  shell: {
    minHeight: "100dvh",
    background:
      "radial-gradient(circle at 18% 0%, rgba(37,99,235,0.16), transparent 30%), linear-gradient(180deg, #FBFDFF 0%, #F4F7FC 100%)",
    color: palette.textPrimary,
    fontFamily: "var(--font-inter), -apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif",
  },
  chrome: {
    width: "min(1440px, 100%)",
    margin: "0 auto",
    padding: "24px",
  },
  showcaseChrome: {
    width: "min(1180px, 100%)",
    padding: "22px clamp(14px, 3vw, 28px) 34px",
  },
  header: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: "20px",
    padding: "8px 2px 18px",
  },
  eyebrow: {
    color: palette.blue,
    fontSize: "11px",
    fontWeight: 800,
    letterSpacing: "0.14em",
  },
  showcaseEyebrow: {
    color: palette.orange,
  },
  title: {
    margin: "8px 0 4px",
    fontSize: "clamp(34px, 5vw, 64px)",
    lineHeight: 0.95,
    letterSpacing: "-0.055em",
    fontWeight: 760,
  },
  showcaseTitle: {
    maxWidth: "820px",
    fontSize: "clamp(38px, 5.4vw, 68px)",
  },
  subtitle: {
    margin: 0,
    color: palette.textSecondary,
    fontSize: "16px",
  },
  showcaseSubtitle: {
    maxWidth: "760px",
    fontSize: "17px",
    lineHeight: 1.5,
  },
  workspaceBadge: {
    display: "flex",
    alignItems: "center",
    gap: "9px",
    minHeight: "42px",
    padding: "9px 12px",
    border: `1px solid ${palette.border}`,
    borderRadius: "999px",
    background: palette.surfaceGlass,
    boxShadow: palette.shadow,
    fontSize: "13px",
    fontWeight: 700,
    whiteSpace: "nowrap",
  },
  showcaseWorkspaceBadge: {
    borderColor: palette.orangeBorder,
    background: "rgba(255,255,255,0.88)",
    boxShadow: "0 18px 46px rgba(15,23,42,0.08)",
  },
  statusDot: {
    width: "8px",
    height: "8px",
    borderRadius: "999px",
    background: palette.success,
    boxShadow: "0 0 0 4px rgba(22,163,74,0.10)",
  },
  demoPill: {
    color: palette.blue,
    background: palette.bluePale,
    borderRadius: "999px",
    padding: "5px 8px",
    fontSize: "11px",
  },
  showcaseDemoPill: {
    color: palette.orange,
    background: palette.orangePale,
  },
  nav: {
    display: "flex",
    gap: "8px",
    padding: "8px",
    marginBottom: "18px",
    border: `1px solid ${palette.borderLight}`,
    borderRadius: "22px",
    background: "rgba(255,255,255,0.68)",
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.88)",
    overflowX: "auto",
  },
  showcaseNav: {
    width: "fit-content",
    maxWidth: "100%",
    marginBottom: "12px",
    borderColor: "rgba(234,122,33,0.12)",
  },
  navButton: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    padding: "10px 13px",
    border: "1px solid transparent",
    borderRadius: "16px",
    background: "transparent",
    color: palette.textSecondary,
    fontSize: "13px",
    fontWeight: 760,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  navButtonActive: {
    color: palette.textPrimary,
    background: palette.surface,
    borderColor: palette.border,
    boxShadow: palette.shadow,
  },
  showcaseNavButtonActive: {
    borderColor: palette.orangeBorder,
    boxShadow: `0 0 0 4px ${palette.orangeGlow}, ${palette.shadow}`,
  },
  navCount: {
    color: palette.textTertiary,
  },
  navCountActive: {
    color: palette.blue,
  },
  heroGrid: {
    display: "grid",
    gridTemplateColumns: "minmax(320px, 1fr) repeat(3, minmax(150px, 190px))",
    gap: "14px",
    marginBottom: "18px",
  },
  showcaseHeroGrid: {
    gridTemplateColumns: "minmax(0, 1fr) repeat(3, minmax(118px, 150px))",
    gap: "12px",
  },
  heroCard: {
    padding: "24px",
    border: `1px solid ${palette.blueBorder}`,
    borderRadius: "30px",
    background:
      "linear-gradient(135deg, rgba(255,255,255,0.94), rgba(239,246,255,0.88))",
    boxShadow: "0 28px 70px rgba(37,99,235,0.12)",
  },
  showcaseHeroCard: {
    borderColor: palette.orangeBorder,
    background:
      "linear-gradient(135deg, rgba(255,255,255,0.96), rgba(255,247,237,0.70) 44%, rgba(239,246,255,0.82))",
    boxShadow: "0 26px 70px rgba(234,122,33,0.10), 0 18px 56px rgba(37,99,235,0.10)",
  },
  heroLabel: {
    color: palette.blue,
    fontSize: "12px",
    fontWeight: 820,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
  },
  heroAnswer: {
    maxWidth: "720px",
    marginTop: "10px",
    fontSize: "25px",
    lineHeight: 1.18,
    letterSpacing: "-0.035em",
    fontWeight: 720,
  },
  heroActions: {
    display: "flex",
    flexWrap: "wrap",
    gap: "8px",
    marginTop: "18px",
  },
  metricCard: {
    display: "flex",
    minHeight: "132px",
    flexDirection: "column",
    justifyContent: "space-between",
    padding: "20px",
    border: `1px solid ${palette.border}`,
    borderRadius: "28px",
    background: palette.surfaceGlass,
    boxShadow: palette.shadow,
  },
  metricValue: {
    fontSize: "34px",
    fontWeight: 760,
    letterSpacing: "-0.04em",
  },
  metricLabel: {
    color: palette.textSecondary,
    fontSize: "13px",
    fontWeight: 700,
  },
  bodyGrid: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) minmax(340px, 420px)",
    gap: "18px",
    alignItems: "start",
  },
  showcaseBodyGrid: {
    gridTemplateColumns: "minmax(0, 1fr) minmax(300px, 360px)",
    gap: "16px",
  },
  queueColumn: {
    minWidth: 0,
  },
  sectionHeader: {
    display: "flex",
    justifyContent: "space-between",
    gap: "14px",
    alignItems: "flex-end",
    padding: "4px 4px 14px",
  },
  sectionKicker: {
    color: palette.textTertiary,
    fontSize: "11px",
    fontWeight: 820,
    letterSpacing: "0.12em",
    textTransform: "uppercase",
  },
  sectionTitle: {
    margin: "5px 0 0",
    fontSize: "20px",
    letterSpacing: "-0.025em",
  },
  mutedText: {
    color: palette.textSecondary,
    fontSize: "13px",
  },
  queueList: {
    display: "grid",
    gap: "12px",
  },
  priorityCard: {
    width: "100%",
    textAlign: "left",
    padding: "18px",
    border: `1px solid ${palette.border}`,
    borderRadius: "26px",
    background: palette.surfaceGlass,
    boxShadow: palette.shadow,
    cursor: "pointer",
    color: palette.textPrimary,
  },
  priorityCardDominant: {
    padding: "23px",
    borderColor: palette.blueBorder,
    background: "linear-gradient(180deg, #FFFFFF 0%, #F8FBFF 100%)",
    boxShadow: "0 24px 70px rgba(15,23,42,0.10)",
  },
  priorityCardSelected: {
    borderColor: "rgba(37,99,235,0.36)",
    boxShadow: "0 0 0 4px rgba(37,99,235,0.08), 0 18px 44px rgba(15,23,42,0.08)",
  },
  showcasePriorityCardDominant: {
    padding: "28px",
    borderColor: palette.orangeBorder,
    background:
      "linear-gradient(145deg, rgba(255,255,255,0.98), rgba(255,247,237,0.72) 46%, rgba(239,246,255,0.86))",
    boxShadow: "0 34px 90px rgba(15,23,42,0.13), 0 0 0 1px rgba(234,122,33,0.10)",
  },
  showcasePriorityCardSelected: {
    borderColor: "rgba(234,122,33,0.35)",
    boxShadow: "0 0 0 4px rgba(234,122,33,0.12), 0 22px 56px rgba(15,23,42,0.10)",
  },
  cardTopline: {
    display: "flex",
    gap: "8px",
    alignItems: "center",
    marginBottom: "13px",
  },
  rankBadge: {
    color: palette.textSecondary,
    background: palette.surfaceHover,
    borderRadius: "999px",
    padding: "6px 9px",
    fontSize: "12px",
    fontWeight: 820,
  },
  rankBadgeDominant: {
    color: "#FFFFFF",
    background: `linear-gradient(135deg, ${palette.blue}, #0F172A)`,
    borderRadius: "999px",
    padding: "6px 10px",
    fontSize: "12px",
    fontWeight: 820,
  },
  showcaseRankBadgeDominant: {
    background: `linear-gradient(135deg, ${palette.orange}, ${palette.blue})`,
    boxShadow: `0 10px 24px ${palette.orangeGlow}`,
  },
  fitPill: {
    border: "1px solid transparent",
    borderRadius: "999px",
    padding: "6px 9px",
    fontSize: "12px",
    fontWeight: 800,
  },
  urgencyPill: {
    borderRadius: "999px",
    padding: "6px 9px",
    fontSize: "12px",
    fontWeight: 800,
  },
  cardTitleRow: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: "12px",
  },
  cardTitle: {
    margin: 0,
    fontSize: "21px",
    lineHeight: 1.08,
    letterSpacing: "-0.035em",
  },
  cardTitleDominant: {
    margin: 0,
    fontSize: "31px",
    lineHeight: 1.02,
    letterSpacing: "-0.05em",
  },
  cardRelationship: {
    marginTop: "5px",
    color: palette.textSecondary,
    fontSize: "13px",
    fontWeight: 650,
  },
  actionChip: {
    flexShrink: 0,
    color: palette.blue,
    background: palette.bluePale,
    border: `1px solid ${palette.blueBorder}`,
    borderRadius: "999px",
    padding: "8px 10px",
    fontSize: "12px",
    fontWeight: 820,
  },
  reasonList: {
    display: "grid",
    gap: "8px",
    marginTop: "16px",
  },
  reasonItem: {
    display: "flex",
    alignItems: "flex-start",
    gap: "9px",
    color: palette.textSecondary,
    fontSize: "14px",
    lineHeight: 1.35,
  },
  reasonDot: {
    width: "6px",
    height: "6px",
    marginTop: "7px",
    borderRadius: "999px",
    background: palette.blue,
    flexShrink: 0,
  },
  beforeDot: {
    width: "6px",
    height: "6px",
    marginTop: "7px",
    borderRadius: "999px",
    background: palette.textDim,
    flexShrink: 0,
  },
  nextStep: {
    marginTop: "15px",
    padding: "12px 13px",
    borderRadius: "16px",
    background: palette.surfaceHover,
    color: palette.textPrimary,
    fontSize: "14px",
    fontWeight: 720,
  },
  contactRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: "7px",
    marginTop: "12px",
    color: palette.textTertiary,
    fontSize: "12px",
    fontWeight: 700,
  },
  contactDivider: {
    color: palette.textDim,
  },
  showcaseStoryStrip: {
    display: "flex",
    justifyContent: "space-between",
    gap: "14px",
    alignItems: "center",
    marginBottom: "14px",
    padding: "14px 16px",
    border: `1px solid ${palette.orangeBorder}`,
    borderRadius: "24px",
    background: "rgba(255,255,255,0.72)",
    boxShadow: "0 18px 54px rgba(15,23,42,0.07)",
    backdropFilter: "blur(16px)",
  },
  showcaseStoryPrimary: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    minWidth: 0,
  },
  showcaseAccentDot: {
    width: "12px",
    height: "12px",
    borderRadius: "999px",
    background: `linear-gradient(135deg, ${palette.orange}, ${palette.blue})`,
    boxShadow: `0 0 0 7px ${palette.orangeGlow}`,
    flexShrink: 0,
  },
  showcaseStoryPills: {
    display: "flex",
    flexWrap: "wrap",
    justifyContent: "flex-end",
    gap: "7px",
  },
  showcaseStoryPill: {
    border: `1px solid ${palette.borderLight}`,
    borderRadius: "999px",
    background: "rgba(255,255,255,0.78)",
    color: palette.textSecondary,
    padding: "7px 9px",
    fontSize: "11px",
    fontWeight: 800,
    whiteSpace: "nowrap",
  },
  showcaseFocusGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
    gap: "10px",
    marginTop: "16px",
  },
  focusItem: {
    display: "grid",
    gap: "6px",
    minHeight: "96px",
    alignContent: "start",
    padding: "13px",
    border: `1px solid ${palette.orangeBorder}`,
    borderRadius: "18px",
    background: "rgba(255,255,255,0.72)",
  },
  focusLabel: {
    color: palette.orange,
    fontSize: "10px",
    fontWeight: 900,
    letterSpacing: "0.1em",
    textTransform: "uppercase",
  },
  focusValue: {
    color: palette.textPrimary,
    fontSize: "13px",
    lineHeight: 1.35,
  },
  beforeAfterGrid: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) auto minmax(0, 1fr)",
    gap: "12px",
    alignItems: "stretch",
  },
  beforeAfterPanel: {
    padding: "22px",
    border: `1px solid ${palette.orangeBorder}`,
    borderRadius: "28px",
    background:
      "linear-gradient(145deg, rgba(255,255,255,0.96), rgba(255,247,237,0.72))",
    boxShadow: "0 22px 58px rgba(15,23,42,0.08)",
  },
  beforeAfterPanelMuted: {
    borderColor: palette.border,
    background: "linear-gradient(145deg, rgba(255,255,255,0.78), rgba(248,250,252,0.82))",
  },
  beforeAfterArrow: {
    display: "grid",
    placeItems: "center",
    color: palette.orange,
    fontSize: "24px",
    fontWeight: 900,
  },
  beforeAfterTitle: {
    margin: "8px 0 14px",
    fontSize: "28px",
    lineHeight: 1,
    letterSpacing: "-0.045em",
  },
  beforeAfterList: {
    display: "grid",
    gap: "10px",
  },
  contextPanel: {
    position: "sticky",
    top: "18px",
    display: "grid",
    gap: "14px",
    padding: "18px",
    border: `1px solid ${palette.border}`,
    borderRadius: "30px",
    background: "rgba(255,255,255,0.86)",
    boxShadow: "0 22px 58px rgba(15,23,42,0.09)",
    backdropFilter: "blur(18px)",
  },
  contextHeader: {
    display: "flex",
    justifyContent: "space-between",
    gap: "16px",
  },
  contextTitle: {
    margin: "5px 0",
    fontSize: "25px",
    lineHeight: 1.06,
    letterSpacing: "-0.04em",
  },
  contextSubtitle: {
    margin: 0,
    color: palette.textSecondary,
    fontSize: "14px",
    lineHeight: 1.45,
  },
  contextActions: {
    display: "flex",
    flexWrap: "wrap",
    gap: "8px",
  },
  actionButton: {
    border: `1px solid ${palette.border}`,
    borderRadius: "999px",
    background: palette.surface,
    color: palette.textPrimary,
    padding: "10px 12px",
    fontSize: "13px",
    fontWeight: 780,
    cursor: "pointer",
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.9)",
  },
  actionButtonPrimary: {
    color: "#FFFFFF",
    background: `linear-gradient(135deg, ${palette.blue}, ${palette.blueLight})`,
    borderColor: "transparent",
    boxShadow: "0 12px 26px rgba(37,99,235,0.22)",
  },
  contextBlock: {
    paddingTop: "2px",
  },
  contextBlockTitle: {
    margin: "0 0 8px",
    color: palette.textPrimary,
    fontSize: "13px",
    fontWeight: 820,
  },
  contextBlockBody: {
    display: "grid",
    gap: "8px",
  },
  contactCard: {
    display: "grid",
    gap: "10px",
    padding: "13px",
    borderRadius: "18px",
    background: palette.surfaceHover,
  },
  contactMethods: {
    display: "flex",
    flexWrap: "wrap",
    gap: "7px",
  },
  methodPill: {
    color: palette.textSecondary,
    background: palette.surface,
    border: `1px solid ${palette.borderLight}`,
    borderRadius: "999px",
    padding: "7px 9px",
    fontSize: "12px",
    fontWeight: 720,
  },
  signalRow: {
    padding: "10px 12px",
    borderRadius: "14px",
    background: palette.bluePale,
    color: palette.blue,
    fontSize: "13px",
    fontWeight: 760,
  },
  timelineItem: {
    padding: "10px 0 10px 12px",
    borderLeft: `2px solid ${palette.border}`,
    color: palette.textSecondary,
    fontSize: "13px",
    lineHeight: 1.4,
  },
  promptButton: {
    width: "100%",
    textAlign: "left",
    padding: "11px 12px",
    border: `1px solid ${palette.border}`,
    borderRadius: "15px",
    background: palette.surface,
    color: palette.textPrimary,
    cursor: "pointer",
    fontSize: "13px",
    fontWeight: 700,
  },
  compressionBox: {
    display: "grid",
    gap: "8px",
    padding: "14px",
    borderRadius: "20px",
    background: "linear-gradient(180deg, #F8FAFC, #FFFFFF)",
    border: `1px solid ${palette.borderLight}`,
  },
  compressionNote: {
    color: palette.textSecondary,
    fontSize: "12px",
    lineHeight: 1.4,
  },
  emptyState: {
    padding: "22px",
    border: `1px dashed ${palette.border}`,
    borderRadius: "22px",
    background: palette.surfaceGlass,
    color: palette.textSecondary,
    fontSize: "14px",
  },
  specialLane: {
    display: "grid",
    gap: "12px",
  },
  specialLaneHero: {
    padding: "24px",
    border: `1px solid ${palette.border}`,
    borderRadius: "26px",
    background: "linear-gradient(135deg, #FFFFFF, #F8FAFC)",
    boxShadow: palette.shadow,
  },
  assistantHero: {
    padding: "24px",
    border: `1px solid ${palette.blueBorder}`,
    borderRadius: "26px",
    background: "linear-gradient(135deg, rgba(239,246,255,0.95), #FFFFFF)",
    boxShadow: "0 22px 58px rgba(37,99,235,0.10)",
  },
  specialLaneTitle: {
    margin: "8px 0 8px",
    fontSize: "28px",
    lineHeight: 1.05,
    letterSpacing: "-0.045em",
  },
  specialLaneCopy: {
    margin: 0,
    maxWidth: "620px",
    color: palette.textSecondary,
    fontSize: "14px",
    lineHeight: 1.45,
  },
  outcomeCard: {
    display: "flex",
    gap: "12px",
    alignItems: "flex-start",
    padding: "17px",
    border: `1px solid ${palette.border}`,
    borderRadius: "22px",
    background: palette.surfaceGlass,
    boxShadow: palette.shadow,
  },
  outcomeIcon: {
    display: "grid",
    placeItems: "center",
    width: "32px",
    height: "32px",
    borderRadius: "12px",
    background: palette.successBg,
    color: palette.success,
    fontSize: "11px",
    fontWeight: 900,
    flexShrink: 0,
  },
  assistantPromptCard: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    width: "100%",
    padding: "18px",
    border: `1px solid ${palette.blueBorder}`,
    borderRadius: "22px",
    background: palette.surface,
    color: palette.textPrimary,
    boxShadow: palette.shadow,
    cursor: "pointer",
    fontSize: "15px",
    fontWeight: 760,
    textAlign: "left",
  },
  assistantSpark: {
    display: "grid",
    placeItems: "center",
    width: "30px",
    height: "30px",
    borderRadius: "12px",
    background: palette.bluePale,
    color: palette.blue,
    fontSize: "16px",
    fontWeight: 900,
    flexShrink: 0,
  },
};
