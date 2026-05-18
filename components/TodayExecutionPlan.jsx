"use client";

// Meridian — Today's Command Queue.
//
// Routing layer for the calendar workflow. Lists every lead scheduled
// for today; each row is a tight summary (pain tag · confidence ·
// one-line insight) with a primary "Open Lead" button that opens the
// standard operator panel in the current queue context.
// Display only — never touches scoring, scheduling, or AI.

import { useEffect, useState } from "react";
import { palette } from "../lib/theme";
import { getLaborTechServiceFit } from "../lib/scan/serviceFit";
import {
  EXECUTION_OUTCOME_CHANGED_EVENT,
  loadAllExecutionOutcomes,
  resolveExecutionOutcome,
} from "../lib/execution/executionOutcome";
import { trackEvent } from "../lib/tracking/clientTracker";
import { resolveLeadQualityDisplay } from "../lib/display/leadQuality";
import {
  buildContactTrustDisplay,
} from "../lib/display/trustVisibility";
import { getDialablePhone } from "../lib/leads/phone";
import { formatTelHref } from "../lib/leads/leadActions";
import { taskAnchorIso } from "../lib/calendar/tasks";
import { getBusinessTodayIso, toBusinessDateIso } from "../lib/dates/businessDate";

// Today is the PRIORITY layer — rank, confidence, urgency only.
// Pain framing lives in the Operator. Tactical "how" lives in the
// Intelligence Panel. We do not repeat either here.
function priorityBadge(quality) {
  const score = quality?.value;
  if (quality?.isUnknown) return { label: "SCAN LIMITED", icon: "·",  fg: "#475569", bg: "#F1F5F9", border: "#E2E8F0" };
  if (typeof score !== "number") return { label: "QUEUED",    icon: "·",  fg: "#475569", bg: "#F1F5F9", border: "#E2E8F0" };
  if (score >= 80)               return { label: "CALL FIRST", icon: "🔥", fg: "#1D4ED8", bg: "#EEF4FF", border: "rgba(37,99,235,0.45)" };
  if (score >= 60)               return { label: "STRONG",    icon: "▲",  fg: "#15803D", bg: "#F0FDF4", border: "#BBF7D0" };
  return null;
}

function qualitySourceLabel(source) {
  if (source === "marketFit.calibrated") return "market-fit display score";
  if (source === "laborTechScan.closeability.score") return "LaborTech scan closeability";
  if (source === "closeProbability100") return "sales strategy close probability";
  if (source === "salesStrategy.closeProbability") return "sales strategy close probability";
  if (source === "closeProbability") return "task probability fallback";
  if (source === "laborTechScan.incomplete") return "incomplete LaborTech scan";
  return "unknown source";
}

function trustChipToneStyle(tone) {
  if (tone === "good") return { color: palette.success, background: palette.successBg, borderColor: "#BBF7D0" };
  if (tone === "watch") return { color: palette.warning, background: palette.warningBg, borderColor: "#FDE68A" };
  if (tone === "danger") return { color: palette.danger, background: palette.dangerBg, borderColor: "#FECACA" };
  return { color: palette.textSecondary, background: palette.surfaceHover, borderColor: palette.borderLight };
}

function TrustChips({ items }) {
  if (!Array.isArray(items) || items.length === 0) return null;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "4px", flexWrap: "wrap" }}>
      {items.map((item) => (
        <span
          key={item.label}
          title={item.title}
          style={{
            display: "inline-flex",
            alignItems: "center",
            minHeight: "18px",
            padding: "1px 7px",
            borderRadius: "999px",
            border: `1px solid ${palette.borderLight}`,
            background: palette.surfaceHover,
            color: palette.textSecondary,
            fontSize: "10px",
            fontWeight: 650,
            letterSpacing: "0.01em",
            whiteSpace: "nowrap",
            ...trustChipToneStyle(item.tone),
          }}
        >
          {item.label}
        </span>
      ))}
    </span>
  );
}

function primaryActionabilityChips(task, phone, phoneTrust) {
  if (phone) return [{ label: "Trusted phone", tone: "good", title: "Dialable phone passed contact trust checks" }];
  if (task?.verifiedEmail || (task?.email && String(task?.emailConfidence ?? "").toLowerCase() === "high")) {
    return [{ label: "Verified email", tone: "good", title: "Verified non-phone contact path" }];
  }
  if (task?.email) return [{ label: "Email fallback", tone: "watch", title: "Verify phone before dialing" }];
  const trust = Array.isArray(phoneTrust?.chips)
    ? phoneTrust.chips.find((chip) => chip?.tone === "danger" || chip?.tone === "watch")
    : null;
  return [trust ?? { label: "Verify contact", tone: "watch", title: "No trusted dialable phone on file" }];
}

export default function TodayExecutionPlan({
  tasks,
  onSelectTask,
  // Primary routing handler — selects the lead and opens the standard
  // operator panel without forcing the lower calendar queue into view.
  onOpenLead,
  // Optional skip handler — advances to the next lead in the queue.
  onSkipTask,
  leadByKey,
  serverExecutionOutcomeMap = {},
  readOnly = false,
}) {
  // Brief "just routed" state on the queue row itself — mirrors the
  // calendar card's pulse so the eye reads the launch as one motion.
  const [routingTaskId, setRoutingTaskId] = useState(null);
  // Read execution outcomes once on mount; refresh on storage events
  // so cross-tab edits surface in the queue. Keyed by task.id.
  const [outcomeMap, setOutcomeMap] = useState({});
  useEffect(() => {
    setOutcomeMap({ ...loadAllExecutionOutcomes(), ...(serverExecutionOutcomeMap ?? {}) });
    if (typeof window === "undefined") return undefined;
    const onStorage = (e) => {
      if (e.key && e.key !== "meridian.executionOutcomes.v1") return;
      setOutcomeMap({ ...loadAllExecutionOutcomes(), ...(serverExecutionOutcomeMap ?? {}) });
    };
    window.addEventListener("storage", onStorage);
    const onOutcomeChanged = () => setOutcomeMap({ ...loadAllExecutionOutcomes(), ...(serverExecutionOutcomeMap ?? {}) });
    window.addEventListener(EXECUTION_OUTCOME_CHANGED_EVENT, onOutcomeChanged);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(EXECUTION_OUTCOME_CHANGED_EVENT, onOutcomeChanged);
    };
  }, [serverExecutionOutcomeMap]);
  // Focused vs full view. Default is the top 6 ranked leads; the
  // user expands to see the rest of the day.
  const [expanded, setExpanded] = useState(false);
  const TOP_LIMIT = 6;
  const openLeadEnabled = typeof onOpenLead === "function";

  if (!Array.isArray(tasks) || tasks.length === 0) return null;

  const businessTodayKey = getBusinessTodayIso();
  const todayTasks = tasks.filter((task) => {
    const anchor = taskAnchorIso(task);
    return anchor ? toBusinessDateIso(anchor) === businessTodayKey : false;
  });
  if (todayTasks.length === 0) return null;

  const totalCount = todayTasks.length;
  const visibleTasks = expanded ? todayTasks : todayTasks.slice(0, TOP_LIMIT);
  const hasOverflow = totalCount > TOP_LIMIT;

  const handlePrimary = (task) => {
    if (!task) return;
    setRoutingTaskId(task.id);
    if (!expanded && hasOverflow) setExpanded(true);
    if (typeof window !== "undefined") {
      window.setTimeout(() => {
        setRoutingTaskId((current) => (current === task.id ? null : current));
      }, 900);
    }
    trackEvent({
      eventType: "today_open_lead",
      taskId: task.id ?? null,
      leadId: task.linkedLeadId ?? null,
      companyName: task.linkedCompany ?? null,
      tradeId: task.tradeId ?? null,
      serviceBucketId: task?.laborTechScan?.primaryService ?? null,
      metadata: { source: "today_queue" },
    });
    if (openLeadEnabled) {
      onOpenLead(task);
      return;
    }
    if (typeof onSelectTask === "function") onSelectTask(task);
  };

  return (
    <section
      role="region"
      aria-label="Today's command queue"
      style={{
        background: "linear-gradient(180deg, rgba(37,99,235,0.05) 0%, rgba(37,99,235,0.01) 100%)",
        border: "1px solid rgba(37,99,235,0.20)",
        borderRadius: "12px",
        padding: "14px 16px",
        marginBottom: "12px",
        display: "flex",
        flexDirection: "column",
        gap: "10px",
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "12px", flexWrap: "wrap" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{
            fontSize: "10px", fontWeight: 800, letterSpacing: "0.12em",
            color: palette.blue, textTransform: "uppercase",
          }}>
            Today&apos;s Command Queue
          </div>
          <div style={{
            fontSize: "15px", fontWeight: 700, color: palette.textPrimary,
            marginTop: "3px", lineHeight: 1.25,
          }}>
            {totalCount} {totalCount === 1 ? "lead" : "leads"} scheduled for today
          </div>
          <div style={{
            fontSize: "11.5px",
            color: palette.textSecondary,
            marginTop: "4px",
            lineHeight: 1.45,
          }}>
            Opens the calendar, Operator, and Intelligence Panel in one step.
          </div>
        </div>
        <div style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-end",
          gap: "6px",
          flexShrink: 0,
        }}>
          {hasOverflow ? (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              aria-expanded={expanded}
              aria-controls="meridian-today-queue"
              style={{
                fontSize: "11px",
                fontWeight: 800,
                letterSpacing: "0.04em",
                color: palette.blue,
                background: palette.bluePale,
                border: `1px solid ${palette.blueBorder}`,
                borderRadius: "999px",
                padding: "5px 12px",
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              {expanded ? "Collapse" : "View full queue →"}
            </button>
          ) : null}
          <div style={{
            fontSize: "10px",
            fontWeight: 700,
            color: palette.textTertiary,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            fontVariantNumeric: "tabular-nums",
          }}>
            {hasOverflow
              ? `Showing ${visibleTasks.length} of ${totalCount} leads`
              : `Showing ${totalCount} ${totalCount === 1 ? "lead" : "leads"}`}
          </div>
        </div>
      </div>

      <ol
        id="meridian-today-queue"
        style={{
          margin: 0,
          padding: 0,
          listStyle: "none",
          display: "flex",
          flexDirection: "column",
          gap: "8px",
        }}
      >
        {visibleTasks.map((task, i) => {
          const linkedKey = task.linkedLeadId;
          const lead = (linkedKey && leadByKey && leadByKey.get) ? leadByKey.get(linkedKey) : null;
          const phone = getDialablePhone(lead) ?? (task.phoneAuthority === "dialable" ? task.phone : null);
          const tel = formatTelHref(phone);
          const phoneTrust = buildContactTrustDisplay(lead, "phone", task);
          const quality = resolveLeadQualityDisplay(task);
          const baseBadge = priorityBadge(quality);
          const badge = phone
            ? baseBadge
            : { label: "VERIFY CONTACT", icon: "", fg: "#9A3412", bg: "#FFFBEB", border: "#FDE68A" };
          const confidencePct = typeof quality.value === "number" && !quality.isUnknown ? `${Math.round(quality.value)}%` : null;
          const urgency = phone ? (task.laborTechScan?.urgency?.label ?? null) : null;
          const isHotUrgency = urgency === "Critical" || urgency === "High";
          const company = task.linkedCompany ?? "Unknown lead";
          const fit = getLaborTechServiceFit(task);
          const fitLabel = fit?.primaryServiceLabel ?? null;
          const outcome = resolveExecutionOutcome(
            outcomeMap,
            task.id,
            [task.companyKey, task.crmKey, task.linkedLeadId],
          );
          const outcomeStatus = outcome && outcome.status !== "Not Contacted" ? outcome.status : null;
          const outcomeTone = (() => {
            if (!outcomeStatus) return null;
            if (outcomeStatus === "Closed Won")  return { fg: "#15803D",      bg: "#F0FDF4",        border: "#BBF7D0" };
            if (outcomeStatus === "Closed Lost") return { fg: palette.danger, bg: palette.dangerBg, border: "#FECACA" };
            if (outcomeStatus === "Interested" || outcomeStatus === "Qualified" || outcomeStatus === "Proposal Sent") {
              return { fg: palette.success, bg: palette.successBg, border: "#BBF7D0" };
            }
            return { fg: palette.blue, bg: palette.bluePale, border: palette.blueBorder };
          })();

          const isRouting = routingTaskId === task.id;
          return (
            <li
              key={task.id ?? i}
              style={{
                display: "grid",
                gridTemplateColumns: "24px minmax(0, 1fr) auto",
                alignItems: "center",
                gap: "12px",
                padding: "10px 12px",
                background: isRouting ? palette.bluePale : palette.surface,
                border: `1px solid ${isRouting ? palette.blue : palette.borderLight}`,
                borderRadius: "10px",
                boxShadow: isRouting
                  ? "0 0 0 1px rgba(37,99,235,0.55), 0 1px 2px rgba(37,99,235,0.10), 0 8px 22px -10px rgba(37,99,235,0.30)"
                  : "none",
                transition: "border-color 200ms ease, box-shadow 200ms ease, background 200ms ease",
              }}
            >
              {/* Rank */}
              <span style={{
                fontSize: "13px", fontWeight: 800,
                color: palette.blue, textAlign: "center",
                fontVariantNumeric: "tabular-nums",
              }}>
                {i + 1}
              </span>

              {/* PRIORITY layer ONLY — rank, company, confidence,
                  urgency. No pain tag (Operator's job). No insight
                  line (Operator + Intelligence Panel cover it). */}
              <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: "5px" }}>
                <div style={{
                  fontSize: "13px",
                  fontWeight: 700,
                  color: palette.textPrimary,
                  lineHeight: 1.2,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  maxWidth: "100%",
                }}>
                  {company}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
                  {badge ? (
                    <span style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "5px",
                      fontSize: "10px",
                      fontWeight: 900,
                      letterSpacing: "0.10em",
                      padding: "2px 9px",
                      borderRadius: "999px",
                      color: badge.fg,
                      background: badge.bg,
                      border: `1px solid ${badge.border}`,
                      whiteSpace: "nowrap",
                    }}>
                      <span aria-hidden="true">{badge.icon}</span>
                      <span>{badge.label}</span>
                    </span>
                  ) : null}
                  {confidencePct ? (
                    <span
                      title={`Fit source: ${qualitySourceLabel(quality.source)}`}
                      style={{
                        fontSize: "10px",
                        fontWeight: 700,
                        letterSpacing: "0.04em",
                        color: palette.textSecondary,
                        whiteSpace: "nowrap",
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {confidencePct} fit
                    </span>
                  ) : null}
                  {urgency ? (
                    <span style={{
                      fontSize: "10px",
                      fontWeight: 700,
                      letterSpacing: "0.06em",
                      padding: "2px 8px",
                      borderRadius: "999px",
                      color: isHotUrgency ? palette.danger : palette.textSecondary,
                      background: isHotUrgency ? palette.dangerBg : palette.surfaceHover,
                      border: `1px solid ${isHotUrgency ? "#FECACA" : palette.borderLight}`,
                      whiteSpace: "nowrap",
                      textTransform: "uppercase",
                    }}>
                      {urgency} urgency
                    </span>
                  ) : null}
                  {fitLabel ? (
                    <span
                      title={`LaborTech service fit: ${fitLabel}`}
                      style={{
                        fontSize: "10px",
                        fontWeight: 800,
                        letterSpacing: "0.06em",
                        padding: "2px 9px",
                        borderRadius: "999px",
                        color: palette.blue,
                        background: palette.bluePale,
                        border: `1px solid ${palette.blueBorder}`,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {fitLabel}
                    </span>
                  ) : null}
                  {outcomeStatus && outcomeTone ? (
                    <span
                      title="Execution outcome — tracked through Meridian"
                      style={{
                        fontSize: "10px",
                        fontWeight: 800,
                        letterSpacing: "0.06em",
                        padding: "2px 9px",
                        borderRadius: "999px",
                        color: outcomeTone.fg,
                        background: outcomeTone.bg,
                        border: `1px solid ${outcomeTone.border}`,
                        whiteSpace: "nowrap",
                        textTransform: "uppercase",
                      }}
                    >
                      {outcomeStatus}
                    </span>
                  ) : null}
                </div>
                <TrustChips items={primaryActionabilityChips(task, phone, phoneTrust)} />
              </div>

              {/* Actions: primary open · Call Direct · Skip. Order stays fixed
                  across workspace AI policy. */}
              <div style={{ display: "inline-flex", gap: "8px", alignItems: "center", flexShrink: 0 }}>
                <button
                  type="button"
                  onClick={() => handlePrimary(task)}
                  title={`Open lead for ${company}`}
                  style={{
                    fontSize: "11px", fontWeight: 800,
                    color: "#fff",
                    background: palette.blue,
                    border: `1px solid ${palette.blue}`,
                    borderRadius: "999px",
                    padding: "6px 14px",
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                    letterSpacing: "0.02em",
                    boxShadow: "0 1px 2px rgba(37,99,235,0.20), 0 6px 14px -8px rgba(37,99,235,0.45)",
                  }}
                >
                  Open Lead →
                </button>
                {tel ? (
                  <a
                    href={readOnly ? undefined : tel}
                    title={readOnly ? "Demo mode is read-only; calling is disabled." : `Call ${phone}`}
                    aria-disabled={readOnly}
                    onClick={(e) => {
                      if (readOnly) { e.preventDefault(); return; }
                      trackEvent({
                        eventType: "today_call_direct",
                        taskId: task.id ?? null,
                        leadId: task.linkedLeadId ?? null,
                        companyName: task.linkedCompany ?? null,
                        tradeId: task.tradeId ?? null,
                        metadata: { phone: phone ? "present" : "missing" },
                      });
                    }}
                    style={{
                      fontSize: "11px", fontWeight: 700,
                      color: readOnly ? palette.textTertiary : palette.blue,
                      background: readOnly ? palette.surfaceHover : palette.bluePale,
                      border: `1px solid ${readOnly ? palette.borderLight : palette.blueBorder}`,
                      borderRadius: "999px",
                      padding: "5px 11px",
                      textDecoration: "none",
                      whiteSpace: "nowrap",
                      cursor: readOnly ? "not-allowed" : "pointer",
                    }}
                  >
                    {readOnly ? "Call disabled in demo" : "Call Direct"}
                  </a>
                ) : null}
                {typeof onSkipTask === "function" ? (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onSkipTask(task); }}
                    disabled={readOnly}
                    title="Skip — advance to the next lead"
                    style={{
                      fontSize: "11px", fontWeight: 600,
                      color: palette.textSecondary,
                      background: "transparent",
                      border: `1px solid ${palette.borderLight}`,
                      borderRadius: "999px",
                      padding: "5px 11px",
                      cursor: readOnly ? "not-allowed" : "pointer",
                      opacity: readOnly ? 0.65 : 1,
                      whiteSpace: "nowrap",
                    }}
                  >
                    Skip
                  </button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
