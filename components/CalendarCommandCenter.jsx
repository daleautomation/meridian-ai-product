"use client";

// Meridian AI — Calendar Command Center.
//
// Weekly execution surface. Reads TaskItem[] (defaults to mock seed) and
// renders a Today Focus rail + a 7-day grid grouped by category. The
// scoring + types live in lib/calendar/tasks so this file can stay
// presentational and the data layer can be swapped in for Google
// Calendar / Gmail / Airtable / CRM without touching the UI.

import { useEffect, useMemo, useRef, useState } from "react";
import { palette } from "../lib/theme";
import {
  TASK_CATEGORIES,
  CATEGORY_ORDER,
  rankTasks,
  isOverdue,
  taskAnchorIso,
  getMockTasks,
} from "../lib/calendar/tasks";
import {
  getExecuteNowDecision,
  rankCapitalAllocation,
} from "../lib/calendar/executeNow";
import { compareLeadTasks } from "../lib/calendar/leadScore";
import {
  LAUNCH_DAY_ISO,
  isLaunchDayOrBefore,
  getWeekStartIso,
  formatWeekStartLabel,
} from "../lib/dates/businessDate";
import { getLaborTechServiceFit, buildServiceFitBreakdown } from "../lib/scan/serviceFit";
import {
  EXECUTION_OUTCOME_STATUSES,
  getDefaultExecutionOutcome,
  loadExecutionOutcome,
  saveExecutionOutcome,
  updateExecutionOutcome,
} from "../lib/execution/executionOutcome";
import { trackEvent } from "../lib/tracking/clientTracker";
import { resolveLeadQualityDisplay } from "../lib/display/leadQuality";
import { explainTaskAction, explainTaskPriority } from "../lib/calendar/taskExplain";
import LeadContextStrip from "./LeadContextStrip";
import LeadEmailAction from "./LeadEmailAction";
import ContactStrategyPanel from "./ContactStrategyPanel";
import TodayExecutionPlan from "./TodayExecutionPlan";
import {
  WORKFLOW,
  SHELL_GRID,
  panelBlueBorder,
  panelBlueBorderSoft,
  panelBlueGlow,
} from "./workflowLayout";
import LeadWorkflowDrawer from "./LeadWorkflowDrawer";

// Debug-log gate. Per-render console.log calls flood the main thread
// when the calendar renders ~200 cards × N re-renders. Enable via
// NEXT_PUBLIC_DEBUG_MERIDIAN=1 during local debugging only.
const DEBUG_UI =
  typeof process !== "undefined"
  && typeof process.env !== "undefined"
  && process.env.NEXT_PUBLIC_DEBUG_MERIDIAN === "1";

const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_FULL  = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// ── Design tokens ──────────────────────────────────────────────────────
// 4-step radius scale + 3-tier shadow ladder. Every surface in this
// file routes through these. Premium products feel premium because
// their primitives are consistent.
const R = { xs: 4, sm: 8, md: 12, lg: 16 };
// Three-tier ladder, all warm-cool neutral, soft falloff. Tuned to read
// elevated without ever feeling heavy. Larger spreads at lower alphas
// produce the calm "lifted out of the page" feel.
const SH = {
  sm: "0 1px 2px rgba(15,23,42,0.03)",
  md: "0 1px 2px rgba(15,23,42,0.04), 0 6px 18px -6px rgba(15,23,42,0.06)",
  lg: "0 1px 2px rgba(15,23,42,0.04), 0 14px 40px -10px rgba(15,23,42,0.10)",
};
// Standard ease for state transitions across the rail. Subtle, calm.
const EASE = "all 180ms cubic-bezier(0.4, 0, 0.2, 1)";

// Shared focus-ring handlers — applied via onFocus/onBlur so we don't
// need a CSS-in-JS dependency for :focus-visible. Calm blue outline,
// 2px, with a 2px offset so it never crowds the control.
const FOCUS_RING = "2px solid rgba(37,99,235,0.30)";
function applyFocusRing(e) {
  e.currentTarget.style.outline = FOCUS_RING;
  e.currentTarget.style.outlineOffset = "2px";
}
function clearFocusRing(e) {
  e.currentTarget.style.outline = "none";
  e.currentTarget.style.outlineOffset = "0";
}

// Module-level dedupe key for the development [ExecuteNow] debug log so a
// re-render with identical decisions does not spam the console.
let lastDevLogKey = "";

// Compact bucket-portfolio panel. Shows up to 6 service angles for
// the selected trade with their lead count + readiness. Reads as a
// portfolio summary, not a dashboard.
function ServiceAnglesPanel({ tradeLabel, bucketPortfolio, prioritizedAngles, hasTradeLeads, onImport, importState, selectedServiceAngleId, onSelectServiceAngle, onClearServiceAngle }) {
  // Prefer the prioritized list when available — it carries
  // Focus Now / Build Next / Monitor labels in the right order.
  const sourceList = (Array.isArray(prioritizedAngles) && prioritizedAngles.length > 0)
    ? prioritizedAngles.map((a) => ({
        bucketId: a.bucketId,
        bucketLabel: a.bucketLabel,
        johnServiceAngle: a.johnServiceAngle,
        count: a.count,
        highConfidenceCount: a.highConfidenceCount,
        priorityLabel: a.priorityLabel,
        status: a.count > 0 ? "ready" : "needs_source",
      }))
    : Array.isArray(bucketPortfolio)
      ? [...bucketPortfolio].sort((a, b) => {
          if (b.count !== a.count) return b.count - a.count;
          if (b.highConfidenceCount !== a.highConfidenceCount) return b.highConfidenceCount - a.highConfidenceCount;
          return 0;
        })
      : [];
  if (sourceList.length === 0) return null;
  const visible = hasTradeLeads
    ? sourceList.filter((b) => b.count > 0).slice(0, 4)
    : sourceList.slice(0, 6);
  if (visible.length === 0) return null;
  return (
    <div style={{
      padding: "14px 14px 12px",
      borderRadius: R.md,
      background: palette.surface,
      borderTop: `1px solid ${palette.borderLight}`,
      borderRight: `1px solid ${palette.borderLight}`,
      borderBottom: `1px solid ${palette.borderLight}`,
      borderLeft: `1px solid ${palette.borderLight}`,
      boxShadow: SH.sm,
      display: "flex",
      flexDirection: "column",
      gap: "8px",
    }}>
      <div style={{
        fontSize: "10px", fontWeight: 700, letterSpacing: "0.10em",
        color: palette.textTertiary, textTransform: "uppercase",
      }}>
        Service Angles · {tradeLabel ?? "Trade"}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
        {visible.map((b) => {
          const ready = b.status === "ready";
          const isActive = selectedServiceAngleId === b.bucketId;
          const handleClick = () => {
            if (typeof onSelectServiceAngle === "function") onSelectServiceAngle(b.bucketId);
          };
          const clickable = typeof onSelectServiceAngle === "function";
          return (
            <button
              key={b.bucketId}
              type="button"
              onClick={clickable ? handleClick : undefined}
              aria-pressed={isActive}
              disabled={!clickable}
              onFocus={clickable ? applyFocusRing : undefined}
              onBlur={clickable ? clearFocusRing : undefined}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "2px",
                padding: "8px 10px",
                borderRadius: R.sm,
                background: isActive ? palette.bluePale : "transparent",
                borderTop: `1px solid ${isActive ? palette.blueBorder : "transparent"}`,
                borderRight: `1px solid ${isActive ? palette.blueBorder : "transparent"}`,
                borderBottom: `1px solid ${isActive ? palette.blueBorder : palette.borderLight}`,
                borderLeft: `1px solid ${isActive ? palette.blueBorder : "transparent"}`,
                cursor: clickable ? "pointer" : "default",
                transition: EASE,
                textAlign: "left",
                width: "100%",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: "8px", alignItems: "baseline" }}>
                <span style={{ fontSize: "12px", fontWeight: 600, color: palette.textPrimary, lineHeight: 1.3 }}>
                  {b.bucketLabel}
                </span>
                <span style={{
                  fontSize: "10px", fontWeight: 600, letterSpacing: "0.04em",
                  color: ready ? palette.success : palette.textTertiary,
                  whiteSpace: "nowrap",
                }}>
                  {ready ? `${b.count} lead${b.count === 1 ? "" : "s"}` : "No data yet"}
                </span>
              </div>
              {b.priorityLabel && (
                <div style={{
                  fontSize: "10px", fontWeight: 600, letterSpacing: "0.04em",
                  color:
                    b.priorityLabel === "Focus Now" ? palette.blue
                    : b.priorityLabel === "Build Next" ? "#6D28D9"
                    : palette.textTertiary,
                  textTransform: "uppercase",
                }}>
                  {b.priorityLabel}
                  {isActive ? " · Selected" : ""}
                </div>
              )}
              <div style={{ fontSize: "11px", color: palette.textSecondary, lineHeight: 1.4 }}>
                {b.johnServiceAngle}
              </div>
            </button>
          );
        })}
      </div>
      {selectedServiceAngleId && onClearServiceAngle && (
        <button
          type="button"
          onClick={onClearServiceAngle}
          onFocus={applyFocusRing}
          onBlur={clearFocusRing}
          style={{
            alignSelf: "flex-start",
            fontSize: "11px",
            fontWeight: 600,
            color: palette.blue,
            background: "transparent",
            border: "none",
            padding: "4px 0",
            cursor: "pointer",
          }}
        >
          ← Show all angles
        </button>
      )}
      {!hasTradeLeads && onImport && (
        <>
          <button
            type="button"
            onClick={onImport}
            disabled={importState?.loading}
            onFocus={applyFocusRing}
            onBlur={clearFocusRing}
            style={{
              fontSize: "11px",
              fontWeight: 600,
              color: palette.blue,
              background: palette.bluePale,
              borderTop: `1px solid ${palette.blueBorder}`,
              borderRight: `1px solid ${palette.blueBorder}`,
              borderBottom: `1px solid ${palette.blueBorder}`,
              borderLeft: `1px solid ${palette.blueBorder}`,
              borderRadius: R.xs + 2,
              padding: "6px 10px",
              cursor: importState?.loading ? "default" : "pointer",
              opacity: importState?.loading ? 0.7 : 1,
              alignSelf: "flex-start",
              marginTop: "2px",
              transition: EASE,
            }}
          >
            {importState?.loading
              ? `Importing ${tradeLabel ?? "trade"}…`
              : `Import ${tradeLabel ?? "trade"} leads`}
          </button>
          {importState?.message && (
            <div style={{
              fontSize: "11px",
              color: importState.kind === "error" ? palette.danger : palette.success,
              marginTop: "2px",
              lineHeight: 1.45,
            }}>
              {importState.message}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// Compact segmented control for Day / Week / Month. Reads as one
// quiet pill cluster, never competes with Mark Done.
// Layout-mode toggle: Calendar (time-based) vs Operator (priority-based).
// Operator collapses the grid down to a top-5 priority queue across every
// lead, regardless of when the task is scheduled. Useful when the
// operator wants to drive the highest-value action right now.
function ModeSegmented({ value, onChange }) {
  const opts = [
    { id: "calendar", label: "Calendar" },
    { id: "operator", label: "Priority" },
  ];
  return (
    <div role="group" aria-label="Layout mode" style={{
      display: "inline-flex",
      padding: "2px",
      borderRadius: R.sm,
      background: palette.surfaceHover,
      borderTop: `1px solid ${palette.borderLight}`,
      borderRight: `1px solid ${palette.borderLight}`,
      borderBottom: `1px solid ${palette.borderLight}`,
      borderLeft: `1px solid ${palette.borderLight}`,
      gap: "2px",
    }}>
      {opts.map((o) => {
        const active = o.id === value;
        return (
          <button
            key={o.id}
            type="button"
            onClick={() => onChange(o.id)}
            aria-pressed={active}
            onFocus={applyFocusRing}
            onBlur={clearFocusRing}
            style={{
              fontSize: "12px",
              fontWeight: active ? 700 : 500,
              padding: "4px 10px",
              borderRadius: R.xs + 2,
              cursor: "pointer",
              color: active ? palette.blue : palette.textSecondary,
              background: active ? palette.surface : "transparent",
              border: "none",
              boxShadow: active ? SH.sm : "none",
              letterSpacing: "0.02em",
              transition: EASE,
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function ViewSegmented({ value, onChange }) {
  const opts = [
    { id: "day",   label: "Day" },
    { id: "week",  label: "Week" },
    { id: "month", label: "Month" },
  ];
  return (
    <div role="group" aria-label="Calendar view" style={{
      display: "inline-flex",
      padding: "2px",
      borderRadius: R.sm,
      background: palette.surfaceHover,
      borderTop: `1px solid ${palette.borderLight}`,
      borderRight: `1px solid ${palette.borderLight}`,
      borderBottom: `1px solid ${palette.borderLight}`,
      borderLeft: `1px solid ${palette.borderLight}`,
      gap: "2px",
    }}>
      {opts.map((o) => {
        const active = o.id === value;
        return (
          <button
            key={o.id}
            type="button"
            onClick={() => onChange(o.id)}
            aria-pressed={active}
            onFocus={applyFocusRing}
            onBlur={clearFocusRing}
            style={{
              fontSize: "12px",
              fontWeight: active ? 600 : 500,
              padding: "4px 10px",
              borderRadius: R.xs + 2,
              cursor: "pointer",
              color: active ? palette.textPrimary : palette.textSecondary,
              background: active ? palette.surface : "transparent",
              border: "none",
              boxShadow: active ? SH.sm : "none",
              transition: EASE,
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function startOfWeek(d) {
  const day = d.getDay();
  const start = new Date(d);
  start.setDate(d.getDate() - day);
  start.setHours(0, 0, 0, 0);
  return start;
}

function dayKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ── DEMO ANCHOR ──────────────────────────────────────────────────────
// Presentational-only anchor for the LaborTech demo. Pins the calendar's
// initial visible week to the week containing this date, and forces the
// "Day 1 · Start here" emphasis to land on this column when present in
// the visible week. NO scheduling, task creation, or backend logic is
// touched — this only biases the default UI state.
//
// To remove for production:
//   1. Set LABORTECH_DEMO_ANCHOR_ENABLED to false (or delete this block),
//   2. revert the `useState` initializer in the parent to `useState(0)`,
//   3. revert firstActiveDayKey to use earliest-active-day logic.
const LABORTECH_DEMO_ANCHOR_ENABLED = true;
// Optional explicit override. Leave null to roll forward dynamically
// to the next Thursday — keeps the demo copy honest no matter when
// the system is opened. Format: "YYYY-MM-DD".
const LABORTECH_DEMO_ANCHOR_OVERRIDE = null;

function laborTechDemoAnchorDate() {
  // Explicit override path — production-style config wins.
  if (typeof LABORTECH_DEMO_ANCHOR_OVERRIDE === "string" && LABORTECH_DEMO_ANCHOR_OVERRIDE.length > 0) {
    const [y, m, d] = LABORTECH_DEMO_ANCHOR_OVERRIDE.split("-").map((s) => Number(s));
    const out = new Date(y, (m || 1) - 1, d || 1);
    out.setHours(0, 0, 0, 0);
    return out;
  }
  // Pinned to the immutable historical launch day (LAUNCH_DAY_ISO).
  // Previously this rolled forward to "next Thursday from today,"
  // which after launch-day caused the calendar header to advertise
  // "Day 1 starts Thursday <future date>" forever. Now the anchor is
  // the actual launch Friday (May 8 2026); the header copy is gated
  // separately on isLaunchDayOrBefore() so post-launch the calendar
  // shows "This week's call plan · Week of {date}" instead.
  const [y, m, d] = LAUNCH_DAY_ISO.split("-").map((s) => Number(s));
  const out = new Date(y, (m || 1) - 1, d || 1);
  out.setHours(0, 0, 0, 0);
  return out;
}

// Anchor key — derived from laborTechDemoAnchorDate() so every
// reference (week-offset math, isFirstActive, header copy, demo
// scheduler) reads the same source of truth.
function laborTechDemoAnchorKey() {
  const a = laborTechDemoAnchorDate();
  return dayKey(a);
}

// Friendly display strings derived from the anchor. Used in headers
// so "Day 1 starts Thursday, <date>" stays accurate.
function laborTechDemoAnchorLabel() {
  try {
    return laborTechDemoAnchorDate().toLocaleDateString(undefined, {
      weekday: "long",
      month: "short",
      day: "numeric",
    });
  } catch {
    return "Thursday";
  }
}

// Whole-week offset from `baseStart` (a Sunday) to the Sunday of the
// week containing the demo anchor. Returns 0 when the anchor is already
// in the visible week or when the anchor is disabled.
function laborTechDemoWeekOffset(baseStart) {
  if (!LABORTECH_DEMO_ANCHOR_ENABLED) return 0;
  try {
    const anchor = laborTechDemoAnchorDate();
    const anchorWeekStart = startOfWeek(anchor);
    const ms = anchorWeekStart.getTime() - baseStart.getTime();
    if (!Number.isFinite(ms)) return 0;
    return Math.round(ms / (7 * 24 * 60 * 60 * 1000));
  } catch {
    return 0;
  }
}

function fmtTime(iso) {
  const d = new Date(iso);
  let h = d.getHours();
  const m = d.getMinutes();
  const ampm = h >= 12 ? "p" : "a";
  h = h % 12 || 12;
  return m === 0 ? `${h}${ampm}` : `${h}:${String(m).padStart(2, "0")}${ampm}`;
}

function fmtMoney(n) {
  if (!n || n <= 0) return null;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${n}`;
}

function priorityTone(p) {
  if (p === "critical") return { color: "#9F1239", bg: "#FFF1F2", border: "#FECDD3" };
  if (p === "high")     return { color: "#B45309", bg: "#FFFBEB", border: "#FDE68A" };
  if (p === "medium")   return { color: "#1E40AF", bg: "#EFF6FF", border: "#BFDBFE" };
  return { color: "#475569", bg: "#F8FAFC", border: "#E2E8F0" };
}

// Single source of truth for closeability presentation. Valid scan-backed
// scores keep the scan range; incomplete scans render as incomplete instead
// of turning fallback floors into precise percentages.
function formatCloseability(taskOrScan) {
  const quality = resolveLeadQualityDisplay(taskOrScan);
  if (quality.source === "none") return null;
  return {
    ...quality,
    pct: quality.value,
    tier: quality.isUnknown
      ? "Incomplete"
      : quality.value >= 80 ? "High" : quality.value >= 50 ? "Medium" : "Lower",
  };
}

// Closeability chip tone — single blue accent across every surface
// (calendar card, operator panel, Deep Report).
const CLOSEABILITY_CHIP_STYLE = {
  fontSize: "9px",
  fontWeight: 800,
  letterSpacing: "0.06em",
  padding: "2px 8px",
  borderRadius: "999px",
  whiteSpace: "nowrap",
  textTransform: "uppercase",
  color: "#2563EB",
  background: "rgba(59,130,246,0.10)",
  border: "1px solid rgba(59,130,246,0.25)",
};

// Operator tier tone (CLOSE_NOW / STRONG / TEST). Drives both the
// per-card chip and the day-column summary.
function tierTone(tier) {
  if (tier === "CLOSE_NOW") {
    return { label: "Close Now", fg: "#FFFFFF", bg: "#2563EB", border: "#2563EB" };
  }
  if (tier === "STRONG") {
    return { label: "Strong", fg: "#1E40AF", bg: "#EFF6FF", border: "#BFDBFE" };
  }
  if (tier === "TEST") {
    return { label: "Test", fg: "#475569", bg: "#F8FAFC", border: "#E2E8F0" };
  }
  return { label: "—", fg: "#94A3B8", bg: "#F8FAFC", border: "#E2E8F0" };
}

function isHighlight(task) {
  return task.priority === "critical" || (task.revenueImpact ?? 0) >= 25_000;
}

// ── Execution-state helpers ────────────────────────────────────────────
// Blocked when the task is the explicit "find missing contact info"
// step or carries a notes/nextAction string saying the lead has no
// phone/email on file. We only check fields already on TaskItem — no
// fabrication.
function isTaskBlocked(task) {
  if (!task) return false;
  if (typeof task.id === "string" && task.id.endsWith("-contact")) return true;
  const title = typeof task.title === "string" ? task.title.toLowerCase() : "";
  if (task.category === "admin" && title.includes("missing contact")) return true;
  const notes = typeof task.notes === "string" ? task.notes.toLowerCase() : "";
  if (notes.includes("no primary phone") || notes.includes("no primary email")) return true;
  return false;
}

// CALL NOW reserved for the rail's executeNow target OR a critical-
// priority call task. Used to paint the strongest visual treatment.
function isCallNowTask(task) {
  if (!task) return false;
  if (task.priority === "critical") return true;
  if (typeof task.id === "string" && task.id.endsWith("-call") && task.priority === "high") return true;
  return false;
}

function executionStatusFor(task) {
  if (!task) return null;
  if (isTaskBlocked(task)) return { id: "blocked", label: "BLOCKED", color: palette.danger, bg: palette.dangerBg, border: "#FECACA" };
  if (isCallNowTask(task)) return { id: "call_now", label: "CALL NOW", color: palette.blue, bg: palette.bluePale, border: palette.blueBorder };
  return { id: "prep", label: "PREP", color: palette.textSecondary, bg: palette.surfaceHover, border: palette.borderLight };
}

// ── TaskCard ───────────────────────────────────────────────────────────

function TaskCard({ task, compact = false, now, isExecuteNow = false, onTaskFeedback, isSelected = false, onSelect, onOpen, pipelineLinkedCount = 0, viewMode = "single" }) {
  const cat = TASK_CATEGORIES[task.category] ?? TASK_CATEGORIES.priority;
  const pri = priorityTone(task.priority);
  const overdue = isOverdue(task, now);
  const highlight = isHighlight(task);
  const blocked = isTaskBlocked(task);
  const callNow = isCallNowTask(task) || isExecuteNow;
  const lowPriority = !callNow && !overdue && (task.priority === "low" || task.priority === "medium" && !highlight);
  const time = task.startTime
    ? `${fmtTime(task.startTime)}${task.endTime ? `–${fmtTime(task.endTime)}` : ""}`
    : null;
  const money = fmtMoney(task.revenueImpact);

  const handleClick = () => {
    if (typeof onSelect === "function") onSelect(task);
  };
  const handleDoubleClick = () => {
    if (typeof onOpen === "function") onOpen(task);
  };

  // Priority visual ladder. CALL NOW (executeNow target or critical
  // priority) gets a soft blue glow + scale; today/medium = neutral
  // surface; low priority dims via opacity. Selection paints a clean
  // blue ring without changing geometry.
  const serviceColor = task?.serviceColor || null;
  const serviceAccent = task?.serviceAccent || null;
  const serviceShortLabel = task?.serviceShortLabel || null;
  // Trade chip — stamped separately by OperatorConsole when in All
  // Trades mode. Never reads from serviceShortLabel so the service
  // field stays accurate to its original module.
  const tradeShortLabel = task?.tradeShortLabel || null;
  const tradeColor = task?.tradeColor || null;
  const tradeAccent = task?.tradeAccent || null;
  // Service color overrides the default tint when present, but never
  // overrides the "blocked" red — missing-contact still wins the
  // visual lane. Call-now keeps its blue glow via cardShadow below.
  const leftBorder = blocked
    ? palette.danger
    : serviceColor
      ? serviceColor
      : callNow
        ? palette.blue
        : cat.tint;
  // Active state uses the same soft-glow language as the All-Leads
  // list and the workflow drawer panels — one visual system for
  // "this is the lead you're working." Outer 1px blue + soft drop
  // shadow + the inset 1px highlight applied via the style block
  // below. No hard 2px ring (read as a focus ring, not an
  // operational selection).
  const cardShadow = isSelected
    ? "0 0 0 1px rgba(37,99,235,0.55), 0 1px 2px rgba(37,99,235,0.10), 0 8px 22px -10px rgba(37,99,235,0.30)"
    : compact
      ? callNow
        ? "0 1px 2px rgba(37,99,235,0.20), 0 8px 22px -8px rgba(37,99,235,0.45)"
        : SH.sm
      : isExecuteNow
        ? SH.lg
        : highlight
          ? SH.md
          : SH.sm;
  const cardOpacity = lowPriority ? 0.78 : 1;
  // Hover lift — only for compact grid cards where the user is
  // scanning. Full cards already use their own shadow ladder.
  const hoverShadow = isSelected
    ? cardShadow
    : compact
      ? "0 1px 2px rgba(15,23,42,0.05), 0 12px 28px -10px rgba(15,23,42,0.16)"
      : cardShadow;

  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={isSelected}
      data-task-id={task.id ?? undefined}
      title={
        (() => {
          const opener = task?.salesStrategy?.callPlan?.opener || task?.callScript || null;
          const cpFmt = formatCloseability(task);
          const cp = cpFmt ? cpFmt.label : null;
          const base = callNow
            ? `Call now · ${task.priority}${money ? ` · ${money}` : ""}`
            : blocked
              ? `Blocked: missing contact info`
              : `${task.priority}${money ? ` · ${money}` : ""}`;
          return [base, cp, opener].filter(Boolean).join(" · ");
        })()
      }
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleClick();
        }
      }}
      onMouseEnter={(e) => {
        // Calm shadow-only hover. Removed the translateY(-1px) lift
        // because it caused micro-jitter when the user scrolled the
        // calendar grid quickly — premium feel demands stillness on
        // hover, not motion. Active cards keep their existing glow.
        e.currentTarget.style.boxShadow = hoverShadow;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.boxShadow = cardShadow;
      }}
      onFocus={applyFocusRing}
      onBlur={clearFocusRing}
      style={{
      padding: compact ? "8px 10px" : "10px 12px",
      borderRadius: R.sm,
      background: isSelected ? "rgba(37,99,235,0.04)" : palette.surface,
      borderTop: `1px solid ${blocked ? "#FECACA" : overdue ? "#FECACA" : palette.border}`,
      borderRight: `1px solid ${blocked ? "#FECACA" : overdue ? "#FECACA" : palette.border}`,
      borderBottom: `1px solid ${blocked ? "#FECACA" : overdue ? "#FECACA" : palette.border}`,
      borderLeft: `${callNow ? 3 : 2}px solid ${leftBorder}`,
      display: "flex",
      flexDirection: "column",
      gap: "4px",
      boxShadow: cardShadow,
      transition: EASE,
      cursor: "pointer",
      opacity: cardOpacity,
      outline: "none",
    }}>
      {/* ── Row 1: top-right badge stack ────────────────────────
         A single right-aligned vertical stack:
           • PRIORITY (top) — full label "<level> PRIORITY"
           • TRADE       — only in All Trades view
           • SERVICE     — original LaborTech bucket, catalog color
         Source rules:
           • service label = serviceShortLabel (catalog-driven color)
             → fallback laborTechScan.primaryService → serviceBucketLabel.
           • trade label   = tradeShortLabel → task.tradeLabel → tradeId.
         The standalone left priority pill has been removed; the row's
         left side stays empty so the company-name row reads cleanly. */}
      {(() => {
        const isAll = viewMode === "all";
        const priorityKey = typeof task.priority === "string" ? task.priority : "";
        const priorityText = priorityKey ? `${priorityKey.toUpperCase()} PRIORITY` : null;
        const serviceText =
          (typeof serviceShortLabel === "string" && serviceShortLabel.trim()) ||
          (typeof task?.serviceBucketLabel === "string" && task.serviceBucketLabel.trim()) ||
          (typeof task?.laborTechScan?.primaryService === "string" && task.laborTechScan.primaryService.trim()) ||
          null;
        const tradeText = isAll
          ? (
              (typeof tradeShortLabel === "string" && tradeShortLabel.trim()) ||
              (typeof task?.tradeLabel === "string" && task.tradeLabel.trim()) ||
              (typeof task?.tradeId === "string" && task.tradeId.trim()) ||
              null
            )
          : null;

        if (DEBUG_UI && typeof console !== "undefined") {
          // eslint-disable-next-line no-console
          console.log(
            `[label-audit] lead="${task?.linkedCompany ?? task?.id ?? "?"}" ` +
            `view="${isAll ? "all" : "single"}" ` +
            `trade="${tradeText ?? ""}" service="${serviceText ?? ""}"`,
          );
          if (isAll && !serviceText) {
            // eslint-disable-next-line no-console
            console.log(
              `[label-audit-warning] lead="${task?.linkedCompany ?? task?.id ?? "?"}" ` +
              `issue="missing service bucket in all trades"`,
            );
          }
          if (
            typeof serviceText === "string" &&
            serviceText.toLowerCase().startsWith("trade:")
          ) {
            // eslint-disable-next-line no-console
            console.log(
              `[label-audit-warning] lead="${task?.linkedCompany ?? task?.id ?? "?"}" ` +
              `issue="service overwritten by trade label"`,
            );
          }
        }

        const serviceUsesColor = !!(serviceText && serviceColor);
        const serviceFg = serviceUsesColor ? serviceColor : palette.textSecondary;
        const serviceBg = serviceUsesColor ? (serviceAccent || "transparent") : palette.surfaceHover;
        const serviceBorder = serviceUsesColor ? `${serviceColor}33` : palette.borderLight;

        const tradeUsesColor = !!(tradeText && tradeColor);
        const tradeFg = tradeUsesColor ? tradeColor : palette.textSecondary;
        const tradeBg = tradeUsesColor ? (tradeAccent || "transparent") : palette.surfaceHover;
        const tradeBorder = tradeUsesColor ? `${tradeColor}33` : palette.borderLight;

        const chipBase = {
          fontSize: "9px",
          fontWeight: 700,
          letterSpacing: "0.06em",
          padding: "2px 8px",
          borderRadius: "999px",
          whiteSpace: "nowrap",
          maxWidth: "180px",
          overflow: "hidden",
          textOverflow: "ellipsis",
          textTransform: "uppercase",
        };

        const closeFit = formatCloseability(task);

        return (
          <div style={{
            display: "flex",
            justifyContent: "flex-end",
            alignItems: "flex-start",
            minHeight: "20px",
          }}>
            <span style={{
              display: "inline-flex",
              flexDirection: "column",
              alignItems: "flex-end",
              gap: "3px",
              minWidth: 0,
              maxWidth: "100%",
            }}>
              {priorityText ? (
                <span
                  title={`Priority: ${priorityText}`}
                  style={{
                    ...chipBase,
                    fontWeight: 800,
                    color: pri.color,
                    background: pri.bg,
                    border: `1px solid ${pri.border}`,
                  }}
                >
                  {priorityText}
                </span>
              ) : null}
              {blocked ? (
                <span style={{
                  ...chipBase,
                  fontWeight: 800,
                  letterSpacing: "0.08em",
                  color: palette.danger,
                  background: palette.dangerBg,
                  border: "1px solid #FECACA",
                }}>
                  Blocked
                </span>
              ) : null}
              {closeFit ? (
                <span
                  title={typeof closeFit.pct === "number" ? `Closeability: ${closeFit.pct}%` : "Closeability incomplete"}
                  style={CLOSEABILITY_CHIP_STYLE}
                >
                  {closeFit.label}
                </span>
              ) : null}
              {tradeText ? (
                <span
                  title={`Trade: ${tradeText}`}
                  style={{
                    ...chipBase,
                    fontWeight: 700,
                    color: tradeFg,
                    background: tradeBg,
                    border: `1px solid ${tradeBorder}`,
                  }}
                >
                  {tradeText}
                </span>
              ) : null}
              {serviceText ? (
                <span
                  title={`Service: ${serviceText}`}
                  style={{
                    ...chipBase,
                    fontWeight: 700,
                    color: serviceFg,
                    background: serviceBg,
                    border: `1px solid ${serviceBorder}`,
                  }}
                >
                  {serviceText}
                </span>
              ) : null}
              {pipelineLinkedCount > 1 ? (
                <span
                  title={`${pipelineLinkedCount} steps in this lead's pipeline`}
                  style={{
                    fontSize: "9px", fontWeight: 700, letterSpacing: "0.04em",
                    padding: "1px 6px", borderRadius: R.xs,
                    color: palette.textSecondary, background: palette.surfaceHover,
                    border: `1px solid ${palette.borderLight}`,
                    whiteSpace: "nowrap",
                    marginTop: "2px",
                  }}
                >
                  ↻ {pipelineLinkedCount}
                </span>
              ) : null}
            </span>
          </div>
        );
      })()}

      {/* ── Row 2: company name ── */}
      {task.linkedCompany ? (
        <div style={{
          fontSize: compact ? "12px" : "13px",
          fontWeight: 700,
          color: palette.textPrimary,
          lineHeight: 1.3,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}>
          {task.linkedCompany}
        </div>
      ) : null}

      {/* ── Row 3: location (lighter) ── */}
      {task.linkedLocation ? (
        <div style={{
          fontSize: "11px",
          color: palette.textTertiary,
          lineHeight: 1.3,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}>
          {task.linkedLocation}
        </div>
      ) : null}

      {/* ── TIER-1 SCAN LAYER: emotional pain · metrics · one-line insight ──
          Trigger language, not explanation. Goal: card readable in
          under 2 seconds, with the pain reframed as what the buyer
          is losing — not what the seller is missing technically. */}
      {(() => {
        const scan = task?.laborTechScan ?? null;
        const painSource =
          (typeof scan?.primaryPain === "string" && scan.primaryPain.trim())
          || (typeof scan?.headline === "string" && scan.headline.trim())
          || null;
        // Map scan-language to emotional trigger language.
        const painTag = (() => {
          if (!painSource) return null;
          const t = painSource.toLowerCase();
          if (/no website|missing website|website down|no site|invisible/.test(t)) return "INVISIBLE ONLINE";
          if (/review|rating|star/.test(t))                                          return "LOSING TRUST";
          if (/shortlist|visibility|seo|search|rank|discover/.test(t))               return "NOT MAKING SHORTLIST";
          if (/conversion|funnel|lead capture|leads/.test(t))                        return "LOSING DEALS";
          if (/photo|portfolio|gallery|content|brand/.test(t))                       return "LOOKING AMATEUR";
          if (/response|slow|reply|inbound/.test(t))                                 return "MISSING WARM LEADS";
          if (/competitor/.test(t))                                                  return "OUTRANKED BY COMPETITORS";
          // Fallback: first 3 words uppercased, with punctuation
          // trimmed, so cards never render an empty pain slot when a
          // scan exists but doesn't match a category.
          const words = painSource.split(/\s+/).slice(0, 3).join(" ")
            .toUpperCase().replace(/[.,;:]+$/g, "");
          return words.length > 28 ? words.slice(0, 26) + "…" : (words || null);
        })();

        // 1–2 metrics: closeability + (urgency or money).
        const metrics = [];
        const close = formatCloseability(task);
        if (close?.isUnknown) metrics.push("Close incomplete");
        else if (typeof close?.pct === "number") metrics.push(`Close ${close.pct}%`);
        if (scan?.urgency?.label) {
          metrics.push(scan.urgency.label);
        } else if (money) {
          metrics.push(money);
        }
        if (overdue) metrics.push("OVERDUE");

        // Insight line — one short sentence; never a paragraph.
        const businessImpact = Array.isArray(scan?.businessImpact) ? scan.businessImpact : [];
        const impact0 = typeof businessImpact[0] === "string"
          ? businessImpact[0]
          : (businessImpact[0]?.statement ?? businessImpact[0]?.text ?? null);
        const insightSource =
          (typeof impact0 === "string" && impact0.trim())
          || (typeof task.nextAction === "string" && task.nextAction.trim())
          || null;
        const insight = insightSource
          ? (insightSource.length > 70 ? insightSource.slice(0, 68).trim() + "…" : insightSource)
          : null;

        if (!painTag && metrics.length === 0 && !insight && !time) return null;

        return (
          <>
            {painTag ? (
              <div style={{
                marginTop: "2px",
                display: "inline-flex",
                alignItems: "center",
                alignSelf: "flex-start",
                fontSize: "10px",
                fontWeight: 800,
                letterSpacing: "0.08em",
                color: palette.blue,
                background: palette.bluePale,
                border: `1px solid ${palette.blueBorder}`,
                borderRadius: "999px",
                padding: "2px 9px",
                whiteSpace: "nowrap",
              }}>
                {painTag}
              </div>
            ) : null}

            {(metrics.length > 0 || time) ? (
              <div style={{
                display: "flex",
                gap: "8px",
                flexWrap: "wrap",
                fontSize: "11px",
                color: palette.textTertiary,
                fontVariantNumeric: "tabular-nums",
                marginTop: painTag ? "2px" : 0,
              }}>
                {time ? <span>{time}</span> : null}
                {metrics.map((m, i) => {
                  const isOverdueChip = m === "OVERDUE";
                  const isMoney = typeof m === "string" && m.startsWith("$");
                  return (
                    <span
                      key={`m-${i}`}
                      style={{
                        color: isOverdueChip
                          ? palette.danger
                          : isMoney
                            ? palette.success
                            : palette.textSecondary,
                        fontWeight: isOverdueChip || isMoney ? 700 : 600,
                        letterSpacing: isOverdueChip ? "0.04em" : "normal",
                      }}
                    >
                      {m}
                    </span>
                  );
                })}
              </div>
            ) : null}

            {insight ? (
              <div style={{
                fontSize: compact ? "12px" : "12.5px",
                fontWeight: 500,
                color: palette.textSecondary,
                lineHeight: 1.4,
                marginTop: "2px",
              }}>
                {insight}
              </div>
            ) : null}
          </>
        );
      })()}

      {/* Bottom serviceBucketLabel removed — the right-side cluster
          already shows the canonical service label, and rendering the
          same string twice produced the "Reviews · Reviews" duplicate. */}

      {(task.workflowAdjusted || task.feedbackApplied) && (
        <div style={{ fontSize: "10px", color: palette.textTertiary, fontStyle: "italic" }}>
          Tuned by recent activity
        </div>
      )}

      {onTaskFeedback && task.status !== "done" && (
        <FeedbackControls task={task} onTaskFeedback={onTaskFeedback} />
      )}
    </div>
  );
}

function FeedbackControls({ task, onTaskFeedback }) {
  const showAcceptOverride = task.workflowAdjusted && !task.feedbackApplied;
  const handle = (type) => (e) => {
    e.stopPropagation();
    onTaskFeedback(task, type);
  };
  const stop = (e) => e.stopPropagation();
  const phone = task?.phone || null;
  // The shared LeadEmailAction renders Email / Email ✓ from these
  // fields. Find Email is suppressed on the small card row to keep
  // cards from growing taller — the SelectedLeadPanel surfaces it
  // when the user clicks in.
  const taskEmail = task?.email || null;
  const taskVerifiedEmail = task?.verifiedEmail || null;
  const phoneDigits = phone ? String(phone).replace(/\D/g, "") : "";
  const telHref = phoneDigits.length === 10
    ? `tel:+1${phoneDigits}`
    : phoneDigits.length === 11 && phoneDigits.startsWith("1")
      ? `tel:+${phoneDigits}`
      : phoneDigits ? `tel:${phoneDigits}` : null;
  if (DEBUG_UI && typeof console !== "undefined" && task?.linkedCompany) {
    // eslint-disable-next-line no-console
    console.log(
      `[card-actions] lead="${task.linkedCompany}" actions=` +
      [phone ? "call" : null, phone ? "text" : null, (taskEmail || taskVerifiedEmail) ? "email" : null].filter(Boolean).join(",") || "none",
    );
  }
  return (
    <div style={{
      display: "flex",
      gap: "6px",
      flexWrap: "wrap",
      marginTop: "2px",
    }}>
      {showAcceptOverride && (
        <>
          <FeedbackButton onClick={handle("accept_adjustment")}>Accept</FeedbackButton>
          <FeedbackButton onClick={handle("override_adjustment")}>Override</FeedbackButton>
        </>
      )}
      {telHref ? (
        <a
          href={telHref}
          onClick={stop}
          style={{
            fontSize: "10px",
            fontWeight: 700,
            letterSpacing: "0.04em",
            padding: "3px 9px",
            borderRadius: "999px",
            color: palette.blue,
            background: palette.bluePale,
            border: `1px solid ${palette.blueBorder}`,
            textDecoration: "none",
          }}
        >
          Call Now
        </a>
      ) : null}
      {telHref ? (
        <a
          href={`sms:${phoneDigits.length === 10 ? "+1" + phoneDigits : phoneDigits}`}
          onClick={stop}
          style={{
            fontSize: "10px",
            fontWeight: 700,
            letterSpacing: "0.04em",
            padding: "3px 9px",
            borderRadius: "999px",
            color: palette.textPrimary,
            background: palette.surfaceHover,
            border: `1px solid ${palette.border}`,
            textDecoration: "none",
          }}
        >
          Text
        </a>
      ) : null}
      <LeadEmailAction
        email={taskEmail}
        verifiedEmail={taskVerifiedEmail}
        emailSource={task?.emailSource ?? null}
        emailConfidence={task?.emailConfidence ?? null}
        companyName={task?.linkedCompany ?? null}
        hunterAvailable={false}
        allowFindEmail={false}
        size="sm"
      />
      {!telHref && !taskEmail && !taskVerifiedEmail ? (
        <span style={{ fontSize: "10px", color: palette.textTertiary, fontWeight: 600 }}>
          Missing contact info
        </span>
      ) : null}
    </div>
  );
}

function FeedbackButton({ onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = palette.surfaceHover;
        e.currentTarget.style.color = palette.textPrimary;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
        e.currentTarget.style.color = palette.textSecondary;
      }}
      onFocus={applyFocusRing}
      onBlur={clearFocusRing}
      style={{
        fontSize: "10px",
        fontWeight: 500,
        letterSpacing: "0.02em",
        color: palette.textSecondary,
        background: "transparent",
        borderTop: `1px solid ${palette.borderLight}`,
        borderRight: `1px solid ${palette.borderLight}`,
        borderBottom: `1px solid ${palette.borderLight}`,
        borderLeft: `1px solid ${palette.borderLight}`,
        borderRadius: R.xs,
        padding: "3px 8px",
        cursor: "pointer",
        transition: EASE,
      }}
    >
      {children}
    </button>
  );
}

// ── Operator guidance ──────────────────────────────────────────────────
// Two layers: tiny inline hints under each rail section, and a small
// "How to use" overlay launched from the Calendar header. Calm, premium,
// non-distracting. No new pages, no help center.

const GUIDANCE_DISMISS_KEY = "meridian.calendar.operatorGuidanceDismissed.v1";
const CALL_NOTES_KEY = "meridian.calls.notesByTaskId.v1";

function MicroHint({ children }) {
  return (
    <div style={{
      fontSize: "10px",
      color: palette.textTertiary,
      fontStyle: "italic",
      lineHeight: 1.45,
      marginTop: "-4px",
    }}>
      {children}
    </div>
  );
}

function HowToUseOverlay({ open, onClose }) {
  useEffect(() => {
    if (!open) return undefined;
    const handler = (e) => { if (e.key === "Escape") onClose(); };
    if (typeof window !== "undefined") {
      window.addEventListener("keydown", handler);
      return () => window.removeEventListener("keydown", handler);
    }
    return undefined;
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15,23,42,0.32)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
        padding: "20px",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        style={{
          width: "100%",
          maxWidth: "440px",
          background: palette.surface,
          borderRadius: R.lg,
          padding: "24px",
          boxShadow: SH.lg,
          borderTop: `1px solid ${palette.border}`,
          borderRight: `1px solid ${palette.border}`,
          borderBottom: `1px solid ${palette.border}`,
          borderLeft: `1px solid ${palette.border}`,
          display: "flex",
          flexDirection: "column",
          gap: "14px",
          transition: EASE,
        }}
      >
        <div>
          <div style={{
            fontSize: "10px", fontWeight: 700, letterSpacing: "0.10em",
            color: palette.blue, textTransform: "uppercase",
          }}>
            Priority Mode
          </div>
          <div style={{ fontSize: "18px", fontWeight: 700, color: palette.textPrimary, marginTop: "4px" }}>
            How to work the priority queue
          </div>
        </div>

        <ol style={{
          margin: 0,
          padding: 0,
          listStyle: "none",
          display: "flex",
          flexDirection: "column",
          gap: "12px",
        }}>
          {[
            { title: "Start with RIGHT NOW", body: "This is the highest-value action the system sees." },
            { title: "Work NEXT MOVES",      body: "Complete the next three actions in order." },
            { title: "Read TODAY'S EDGE",    body: "Use this to adjust your approach for the day." },
            { title: "Ignore HOLDING AREA until ready", body: "It keeps lower-priority items available without distracting you." },
            { title: "Use feedback controls", body: "Mark as Call Today, Schedule Later, Follow Up, Needs Review, or Not Ready so the system learns your priorities." },
          ].map((step, i) => (
            <li key={step.title} style={{ display: "flex", gap: "10px", alignItems: "flex-start" }}>
              <span style={{
                flexShrink: 0,
                width: "20px", height: "20px",
                borderRadius: "50%",
                background: palette.bluePale,
                color: palette.blue,
                fontSize: "11px", fontWeight: 700,
                display: "flex", alignItems: "center", justifyContent: "center",
                marginTop: "1px",
              }}>
                {i + 1}
              </span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: "13px", fontWeight: 600, color: palette.textPrimary, lineHeight: 1.3 }}>
                  {step.title}
                </div>
                <div style={{ fontSize: "12px", color: palette.textSecondary, lineHeight: 1.45, marginTop: "2px" }}>
                  {step.body}
                </div>
              </div>
            </li>
          ))}
        </ol>

        <div style={{
          fontSize: "11px",
          fontStyle: "italic",
          color: palette.textTertiary,
          paddingTop: "4px",
          borderTop: `1px solid ${palette.borderLight}`,
        }}>
          Follow the sequence. Do not browse.
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              fontSize: "12px",
              fontWeight: 600,
              color: "#fff",
              background: palette.blue,
              border: "none",
              borderRadius: R.sm,
              padding: "8px 16px",
              cursor: "pointer",
              boxShadow: SH.sm,
              transition: EASE,
            }}
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Premium left rail · Right Now / Up Next / Momentum ────────────────
// Replaces the old Right Now + Next Moves stack with the operator-grade
// "next best action" workflow. Click a queue card to promote it into
// Right Now; Mark Done advances the queue and ticks the momentum footer.

// Spec palette — kept inline (not added to lib/theme) so this rail can
// run a slightly lighter accent without affecting other surfaces.
const RAIL = {
  pageBg:        "#F8FAFC",
  cardBg:        "#FFFFFF",
  border:        "#E2E8F0",
  borderSoft:    "#F1F5F9",
  textPrimary:   "#0F172A",
  textSecondary: "#475569",
  muted:         "#94A3B8",
  blue:          "#3B82F6",
  blueRing:      "rgba(59,130,246,0.08)",
  blueShadow:    "rgba(59,130,246,0.25)",
  liftShadow:    "0 1px 2px rgba(15,23,42,0.04), 0 10px 30px rgba(15,23,42,0.06)",
  hoverShadow:   "0 1px 2px rgba(15,23,42,0.04), 0 8px 20px rgba(15,23,42,0.08)",
};
const PROMOTE_EASING =
  "transform 420ms cubic-bezier(0.16, 1, 0.3, 1), " +
  "opacity 320ms ease, " +
  "box-shadow 320ms ease, " +
  "filter 320ms ease";
const BUTTON_EASING = "transform 160ms ease, box-shadow 160ms ease, background 160ms ease";

function usePrefersReducedMotion() {
  const [prefers, setPrefers] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setPrefers(!!mql.matches);
    onChange();
    if (mql.addEventListener) mql.addEventListener("change", onChange);
    else mql.addListener(onChange);
    return () => {
      if (mql.removeEventListener) mql.removeEventListener("change", onChange);
      else mql.removeListener(onChange);
    };
  }, []);
  return prefers;
}

// One-line operator-grade insight. The premium LaborTech scan is the
// canonical source — its primaryPain / reportSummary feed the headline
// directly. Falls back to signal-driven copy only when no scan stamped.
function operatorInsightLine(task) {
  if (!task) return "";
  const scan = task.laborTechScan ?? null;
  if (scan?.primaryPain) {
    // Scan-derived shorthand: "<pain> → <impact head>". Pulls the first
    // half of the impact line so the rep sees pain + consequence in
    // a single sentence.
    const impact = Array.isArray(scan.businessImpact) && scan.businessImpact.length > 0
      ? String(scan.businessImpact[0]).split(/[—.]/)[0]?.trim()
      : null;
    if (impact && impact.length > 4) return `${scan.primaryPain} → ${impact.toLowerCase()}`;
    return scan.primaryPain;
  }
  if (scan?.reportSummary) {
    const sum = String(scan.reportSummary);
    return sum.length > 110 ? sum.slice(0, 108).trim() + "…" : sum;
  }
  if (!task.phone && !task.email) return "Missing phone & email — enrich before outreach";
  if (!task.phone) return "No phone on file — enrich before outreach";
  if (task.riskIfMissed === "high") return "High risk if missed — don’t let this slip";
  if (task.category === "followup") return "Follow-up due — keep the call sequence moving";
  if (task.category === "scan") return "No verified website — call path is unclear";
  if (task.category === "priority") return "High-intent lead — call before competitors do";
  // Last resort: the existing whyItMatters, trimmed to one short line.
  const why = explainTaskAction(task)?.whyItMatters ?? "";
  if (why) return why.length > 90 ? why.slice(0, 88).trim() + "…" : why;
  return "Ready to contact";
}

function metaLineFor(task) {
  if (!task) return "";
  const parts = [];
  if (task.riskIfMissed === "high") parts.push("HIGH");
  else if (task.category === "priority") parts.push("PRIORITY");
  else if (task.category === "followup") parts.push("FOLLOW-UP");
  if (task.tradeLabel) parts.push(task.tradeLabel);
  const close = formatCloseability(task);
  if (close) {
    parts.push(close.label);
  } else if (task.serviceBucketLabel) {
    parts.push(task.serviceBucketLabel);
  }
  return parts.join(" · ");
}

function telHrefFor(task) {
  const phone = task?.phone || null;
  const digits = phone ? String(phone).replace(/\D/g, "") : "";
  if (digits.length === 10) return `tel:+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `tel:+${digits}`;
  return digits ? `tel:${digits}` : null;
}
function smsHrefFor(task) {
  const phone = task?.phone || null;
  const digits = phone ? String(phone).replace(/\D/g, "") : "";
  if (digits.length === 10) return `sms:+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `sms:+${digits}`;
  return digits ? `sms:${digits}` : null;
}
function formatPhoneDisplay(task) {
  const phone = task?.phone || null;
  if (!phone) return null;
  const d = String(phone).replace(/\D/g, "");
  if (d.length === 10) return `(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6)}`;
  if (d.length === 11 && d.startsWith("1")) return `+1 (${d.slice(1,4)}) ${d.slice(4,7)}-${d.slice(7)}`;
  return phone;
}

function RightNowCommand({ task, exiting, enterKey, onMarkDone, onOpenScan, reducedMotion }) {
  const tel = telHrefFor(task);
  const sms = smsHrefFor(task);
  const phoneDisplay = formatPhoneDisplay(task);
  const action = task ? explainTaskAction(task) : null;
  const insight = operatorInsightLine(task);
  const meta = metaLineFor(task);

  if (!task) {
    return (
      <div style={{
        background: RAIL.cardBg,
        border: `1px solid ${RAIL.border}`,
        borderRadius: "16px",
        padding: "16px",
        boxShadow: RAIL.liftShadow,
        display: "flex",
        flexDirection: "column",
        gap: "6px",
      }}>
        <div style={{
          fontSize: "11px", fontWeight: 800, letterSpacing: "0.14em",
          color: RAIL.muted, textTransform: "uppercase",
        }}>
          Right Now
        </div>
        <div style={{ fontSize: "15px", fontWeight: 700, color: RAIL.textPrimary, lineHeight: 1.3 }}>
          You’re clear.
        </div>
        <div style={{ fontSize: "12px", color: RAIL.textSecondary, lineHeight: 1.45 }}>
          No live tasks for this trade. Import or verify leads to stage the next move.
        </div>
      </div>
    );
  }

  const hoverIn = (e) => {
    if (reducedMotion) return;
    e.currentTarget.style.transform = "translateY(-1px)";
    e.currentTarget.style.boxShadow =
      "0 0 0 1px rgba(59,130,246,0.10), 0 14px 36px rgba(15,23,42,0.08)";
  };
  const hoverOut = (e) => {
    e.currentTarget.style.transform = "";
    e.currentTarget.style.boxShadow =
      "0 0 0 1px " + RAIL.blueRing + ", " + RAIL.liftShadow;
  };

  return (
    <div
      key={enterKey}
      onMouseEnter={hoverIn}
      onMouseLeave={hoverOut}
      style={{
        background: RAIL.cardBg,
        border: `1px solid ${RAIL.border}`,
        borderRadius: "16px",
        padding: "16px",
        boxShadow: "0 0 0 1px " + RAIL.blueRing + ", " + RAIL.liftShadow,
        display: "flex",
        flexDirection: "column",
        gap: "6px",
        opacity: exiting ? 0 : 1,
        transform: exiting ? "translateY(8px) scale(0.98)" : "translateY(0) scale(1)",
        transition: reducedMotion ? "opacity 200ms ease" : PROMOTE_EASING,
        animation:
          reducedMotion || exiting ? "none" : "meridian-rightnow-enter 420ms cubic-bezier(0.16, 1, 0.3, 1)",
      }}
    >
      <div style={{
        fontSize: "11px", fontWeight: 800, letterSpacing: "0.14em",
        color: RAIL.blue, textTransform: "uppercase",
      }}>
        Right Now
      </div>
      <div style={{
        fontSize: "16px", fontWeight: 700, color: RAIL.textPrimary, lineHeight: 1.25,
      }}>
        {action?.actionLabel ?? task.title}
      </div>
      {insight ? (
        <div style={{
          fontSize: "13px", color: RAIL.textSecondary, lineHeight: 1.45, marginTop: "6px",
        }}>
          {insight}
        </div>
      ) : null}
      {meta ? (
        <div style={{
          fontSize: "11px", color: RAIL.muted, marginTop: "8px",
          letterSpacing: "0.02em",
        }}>
          {meta}
        </div>
      ) : null}

      <div style={{
        height: "1px", background: RAIL.borderSoft, margin: "12px 0",
      }} />

      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        gap: "10px", flexWrap: "wrap",
      }}>
        <div style={{
          fontSize: "15px", fontWeight: 700, color: RAIL.textPrimary,
          letterSpacing: "0.04em",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontVariantNumeric: "tabular-nums",
        }}>
          {phoneDisplay ?? "No phone"}
        </div>
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          {tel ? (
            <a
              href={tel}
              onMouseEnter={(e) => { if (!reducedMotion) e.currentTarget.style.transform = "scale(1.03)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.transform = ""; }}
              onMouseDown={(e) => { if (!reducedMotion) e.currentTarget.style.transform = "scale(0.98)"; }}
              onMouseUp={(e) => { e.currentTarget.style.transform = ""; }}
              style={{
                background: RAIL.blue,
                color: "#fff",
                padding: "8px 14px",
                borderRadius: "10px",
                fontSize: "13px",
                fontWeight: 700,
                boxShadow: "0 4px 12px " + RAIL.blueShadow,
                textDecoration: "none",
                letterSpacing: "0.02em",
                transition: BUTTON_EASING,
              }}
            >
              Call Now
            </a>
          ) : null}
          {sms ? (
            <a
              href={sms}
              onMouseEnter={(e) => { if (!reducedMotion) e.currentTarget.style.transform = "scale(1.03)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.transform = ""; }}
              onMouseDown={(e) => { if (!reducedMotion) e.currentTarget.style.transform = "scale(0.98)"; }}
              onMouseUp={(e) => { e.currentTarget.style.transform = ""; }}
              style={{
                background: RAIL.borderSoft,
                color: "#334155",
                padding: "8px 12px",
                borderRadius: "10px",
                fontSize: "13px",
                fontWeight: 650,
                border: `1px solid ${RAIL.border}`,
                textDecoration: "none",
                letterSpacing: "0.02em",
                transition: BUTTON_EASING,
              }}
            >
              Send Text
            </a>
          ) : null}
        </div>
      </div>

      <div style={{
        fontSize: "11px", color: RAIL.muted, fontStyle: "italic", marginTop: "10px",
      }}>
        Start here. Complete this before moving on.
      </div>

      {(onMarkDone || onOpenScan) ? (
        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          gap: "8px", marginTop: "8px", flexWrap: "wrap",
        }}>
          {onOpenScan && task?.laborTechScan?.qualified ? (
            <button
              type="button"
              onClick={() => onOpenScan(task)}
              onMouseEnter={(e) => { if (!reducedMotion) e.currentTarget.style.transform = "scale(1.03)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.transform = ""; }}
              onMouseDown={(e) => { if (!reducedMotion) e.currentTarget.style.transform = "scale(0.98)"; }}
              onMouseUp={(e) => { e.currentTarget.style.transform = ""; }}
              style={{
                background: RAIL.cardBg,
                color: RAIL.blue,
                border: `1px solid rgba(59,130,246,0.30)`,
                borderRadius: "10px",
                padding: "6px 12px",
                fontSize: "12px",
                fontWeight: 700,
                cursor: "pointer",
                transition: BUTTON_EASING,
                letterSpacing: "0.02em",
              }}
            >
              View Scan
            </button>
          ) : <span />}
          {onMarkDone ? (
            <button
              type="button"
              onClick={onMarkDone}
              onMouseEnter={(e) => { if (!reducedMotion) e.currentTarget.style.transform = "scale(1.03)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.transform = ""; }}
              onMouseDown={(e) => { if (!reducedMotion) e.currentTarget.style.transform = "scale(0.98)"; }}
              onMouseUp={(e) => { e.currentTarget.style.transform = ""; }}
              style={{
                background: "transparent",
                color: RAIL.textSecondary,
                border: `1px solid ${RAIL.border}`,
                borderRadius: "10px",
                padding: "6px 12px",
                fontSize: "12px",
                fontWeight: 650,
                cursor: "pointer",
                transition: BUTTON_EASING,
                letterSpacing: "0.02em",
              }}
            >
              Mark done
            </button>
          ) : null}
        </div>
      ) : null}

      <style jsx>{`
        @keyframes meridian-rightnow-enter {
          0%   { transform: translateY(-6px) scale(0.985); opacity: 0; }
          60%  { opacity: 1; }
          100% { transform: translateY(0) scale(1); opacity: 1; }
        }
        @media (prefers-reduced-motion: reduce) {
          [data-meridian-rail] * { animation: none !important; transition: opacity 200ms ease !important; }
        }
      `}</style>
    </div>
  );
}

function UpNextItem({ task, onPromote, onOpenScan, reducedMotion }) {
  const action = explainTaskAction(task);
  const meta = metaLineFor(task);
  const insight = operatorInsightLine(task);
  const handleKey = (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onPromote?.();
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onPromote}
      onKeyDown={handleKey}
      onMouseEnter={(e) => {
        if (reducedMotion) return;
        e.currentTarget.style.transform = "translateY(-2px)";
        e.currentTarget.style.boxShadow = RAIL.hoverShadow;
        e.currentTarget.style.borderColor = "rgba(59,130,246,0.35)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = "";
        e.currentTarget.style.boxShadow = "none";
        e.currentTarget.style.borderColor = RAIL.border;
      }}
      onFocus={applyFocusRing}
      onBlur={clearFocusRing}
      style={{
        position: "relative",
        textAlign: "left",
        background: RAIL.cardBg,
        border: `1px solid ${RAIL.border}`,
        borderRadius: "12px",
        padding: "12px 12px 12px 15px",
        marginBottom: "10px",
        cursor: "pointer",
        display: "flex",
        flexDirection: "column",
        gap: "4px",
        transition: PROMOTE_EASING,
        width: "100%",
        boxSizing: "border-box",
      }}
    >
      <span aria-hidden="true" style={{
        position: "absolute",
        top: 10,
        bottom: 10,
        left: 0,
        width: "3px",
        borderRadius: "999px",
        background: RAIL.blue,
        opacity: 0.7,
      }} />
      <div style={{
        fontSize: "13px", fontWeight: 700, color: RAIL.textPrimary, lineHeight: 1.3,
        paddingRight: onOpenScan && task?.laborTechScan?.qualified ? "70px" : 0,
      }}>
        {action?.actionLabel ?? task.title}
      </div>
      <div style={{
        fontSize: "12px", color: RAIL.textSecondary, lineHeight: 1.4,
        overflow: "hidden", textOverflow: "ellipsis",
        display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
      }}>
        {insight}
      </div>
      {meta ? (
        <div style={{
          fontSize: "10px", fontWeight: 700, color: RAIL.muted,
          letterSpacing: "0.08em", textTransform: "uppercase",
          marginTop: "2px",
        }}>
          {meta}
        </div>
      ) : null}
      {onOpenScan && task?.laborTechScan?.qualified ? (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onOpenScan(task); }}
          aria-label={`View scan for ${task.linkedCompany ?? task.title}`}
          style={{
            position: "absolute",
            top: "10px",
            right: "10px",
            fontSize: "10px",
            fontWeight: 700,
            color: RAIL.blue,
            background: "rgba(59,130,246,0.08)",
            border: "1px solid rgba(59,130,246,0.30)",
            borderRadius: "999px",
            padding: "2px 9px",
            cursor: "pointer",
            letterSpacing: "0.06em",
            textTransform: "uppercase",
          }}
        >
          Scan
        </button>
      ) : null}
    </div>
  );
}

function UpNextQueue({ tasks, onPromote, onOpenScan, reducedMotion }) {
  if (!tasks || tasks.length === 0) return null;
  return (
    <div>
      <div style={{
        fontSize: "11px", fontWeight: 800, letterSpacing: "0.12em",
        color: RAIL.textSecondary, textTransform: "uppercase", marginBottom: "8px",
      }}>
        Up Next
      </div>
      <div>
        {tasks.map((t) => (
          <UpNextItem
            key={t.id}
            task={t}
            onPromote={() => onPromote(t.id)}
            onOpenScan={onOpenScan}
            reducedMotion={reducedMotion}
          />
        ))}
      </div>
    </div>
  );
}

function MomentumFooter({ completed, goal = 10 }) {
  const pct = goal > 0 ? Math.min(100, Math.round((completed / goal) * 100)) : 0;
  return (
    <div style={{
      display: "flex", flexDirection: "column", gap: "6px",
      paddingTop: "8px", borderTop: `1px solid ${RAIL.borderSoft}`,
    }}>
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "baseline",
        fontSize: "12px", color: RAIL.textSecondary,
      }}>
        <span>Today: {completed} call{completed === 1 ? "" : "s"} completed</span>
        <span style={{ color: RAIL.muted, fontVariantNumeric: "tabular-nums" }}>
          {completed} / {goal}
        </span>
      </div>
      <div style={{
        height: "4px",
        background: RAIL.border,
        borderRadius: "999px",
        overflow: "hidden",
      }}>
        <div style={{
          width: `${pct}%`,
          height: "100%",
          background: RAIL.blue,
          transition: "width 320ms cubic-bezier(0.16, 1, 0.3, 1)",
        }} />
      </div>
    </div>
  );
}

// ── Today Focus rail ───────────────────────────────────────────────────

function PanelSection({ title, children }) {
  return (
    <div>
      <div style={{
        fontSize: "10px", fontWeight: 700, letterSpacing: "0.08em",
        color: palette.textSecondary, textTransform: "uppercase",
        marginBottom: "8px",
      }}>
        {title}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
        {children}
      </div>
    </div>
  );
}


// ── Right Now / Next Moves / Today's Edge / Holding Area ───────────────
// Operator-grade rail. ONE primary decision (RightNowCard), then a small
// supporting stack. Replaces the previous 6-section rail (Execute Now,
// Capital Allocation, Operator Insights, Top 3, Overdue, Follow-Ups,
// Revenue Actions, Risk Flags) with a calmer hierarchy. Underlying
// scoring + intelligence are unchanged.

function RightNowCard({ decision, onTaskFeedback, tradeLabel, hasTradeLeads = true, tradeReadiness, selectedServiceAngleLabel, onClearServiceAngle }) {
  const t = decision?.task ?? null;

  // Local "marked done" tracking. When the operator hits Mark done we
  // visually flip the card to a calm terminal state for ~250ms while
  // the parent re-derives. The set is keyed by task id so a fresh
  // decision (different task) shows the live card again automatically.
  const [markedDoneIds, setMarkedDoneIds] = useState(() => new Set());
  // Collapsible "Approach" section keeps the card calm by default.
  const [approachOpen, setApproachOpen] = useState(false);
  const isMarkedDone = !!(t && markedDoneIds.has(t.id));

  // Auto-clear the local "marked done" entry once the parent moves to
  // a different task. Keeps the set bounded and self-healing.
  useEffect(() => {
    if (!t) return;
    if (!isMarkedDone) return;
    const id = t.id;
    const handle = setTimeout(() => {
      setMarkedDoneIds((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }, 1200);
    return () => clearTimeout(handle);
  }, [t, isMarkedDone]);

  if (!t) {
    return (
      <div style={{
        padding: "18px 18px 16px",
        borderRadius: R.md,
        background: palette.surfaceHover,
        borderTop: `1px solid ${palette.border}`,
        borderRight: `1px solid ${palette.border}`,
        borderBottom: `1px solid ${palette.border}`,
        borderLeft: `2px solid ${palette.textTertiary}`,
        display: "flex",
        flexDirection: "column",
        gap: "8px",
        boxShadow: SH.sm,
        transition: EASE,
      }}>
        <div style={{
          fontSize: "12px", fontWeight: 800, letterSpacing: "0.16em",
          color: palette.textTertiary, textTransform: "uppercase",
        }}>
          Right Now
        </div>
        <div style={{ fontSize: "14px", fontWeight: 600, color: palette.textPrimary }}>
          {selectedServiceAngleLabel
            ? `No action ready for ${selectedServiceAngleLabel}.`
            : hasTradeLeads
              ? "No action ready."
              : `No ${tradeLabel ?? "trade"} action ready.`}
        </div>
        <div style={{ fontSize: "12px", color: palette.textSecondary, lineHeight: 1.5 }}>
          {selectedServiceAngleLabel
            ? "Import or verify leads in this angle to stage the next move."
            : hasTradeLeads
              ? "Verify contact details or complete a scan to stage the next move."
              : `Connect ${tradeLabel ?? "trade"} lead sources or import ${tradeLabel ?? "trade"} companies to stage the next move.`}
        </div>
        {selectedServiceAngleLabel && onClearServiceAngle && (
          <button
            type="button"
            onClick={onClearServiceAngle}
            style={{
              alignSelf: "flex-start",
              fontSize: "11px",
              fontWeight: 600,
              color: palette.blue,
              background: "transparent",
              border: "none",
              padding: "2px 0",
              cursor: "pointer",
            }}
          >
            ← View all {tradeLabel ?? "trade"} angles
          </button>
        )}
        {!hasTradeLeads && tradeReadiness?.missingEnvVars?.length ? (
          <div style={{ fontSize: "11px", color: palette.textTertiary, lineHeight: 1.5, marginTop: "4px" }}>
            Missing source{tradeReadiness.missingEnvVars.length === 1 ? "" : "s"}: {tradeReadiness.missingEnvVars.join(", ")}.
          </div>
        ) : null}
      </div>
    );
  }

  const isExecute = decision.label === "EXECUTE NOW";
  const accent = isExecute ? palette.blue : "#6D28D9";
  const accentBg = isExecute
    ? "linear-gradient(180deg, rgba(37,99,235,0.06), rgba(37,99,235,0.015))"
    : "linear-gradient(180deg, rgba(124,58,237,0.045), rgba(124,58,237,0.01))";
  const accentBorder = isExecute ? palette.blueBorder : "rgba(124,58,237,0.20)";

  const ev = t.expectedValue;
  const upside = decision.expectedUpside ?? t.revenueImpact;
  const probPct = typeof t.closeProbability === "number"
    ? Math.round(t.closeProbability * 100)
    : null;

  // Pre-format display strings outside JSX so server + client render
  // produces the exact same markup. fmtMoney / probPct are pure on
  // these inputs, but pre-computing keeps the render path deterministic
  // and prevents accidental hydration drift if any consumer changes
  // their behavior in the future.
  const displayEv = useMemo(() => fmtMoney(ev), [ev]);
  const displayUpside = useMemo(() => fmtMoney(upside), [upside]);
  const displayProb = useMemo(
    () => (probPct !== null ? `${probPct}%` : null),
    [probPct],
  );

  // Pre-build the stat-line parts as a stable array (with stable keys)
  // before JSX ever runs. Each entry is `{ key, kind, node }` so the
  // map can render with no inline computation.
  const statLineParts = useMemo(() => {
    const out = [];
    if (displayEv) {
      out.push({
        key: "p-headline-ev",
        node: (
          <span style={{ color: palette.success, fontWeight: 700 }}>
            ~{displayEv} opportunity
          </span>
        ),
      });
    } else if (displayUpside) {
      out.push({
        key: "p-headline-upside",
        node: (
          <span style={{ color: palette.success, fontWeight: 700 }}>
            ~{displayUpside} upside
          </span>
        ),
      });
    }
    if (displayEv && displayUpside) {
      out.push({
        key: "p-secondary-upside",
        node: <span>{displayUpside} upside</span>,
      });
    }
    if (displayProb) {
      out.push({
        key: "p-prob",
        node: <span>{displayProb} chance</span>,
      });
    }
    return out;
  }, [displayEv, displayUpside, displayProb]);

  const handleMarkDone = () => {
    if (!onTaskFeedback) return;
    onTaskFeedback(t, "accept_adjustment", "Operator completed the recommended action");
    setMarkedDoneIds((prev) => {
      const next = new Set(prev);
      next.add(t.id);
      return next;
    });
  };

  // ── Done-state surface ──
  if (isMarkedDone) {
    return (
      <div style={{
        padding: "16px 16px 14px",
        borderRadius: R.md,
        background: palette.successBg,
        borderTop: `1px solid ${palette.successBg}`,
        borderRight: `1px solid ${palette.successBg}`,
        borderBottom: `1px solid ${palette.successBg}`,
        borderLeft: `2px solid ${palette.success}`,
        boxShadow: SH.sm,
        display: "flex",
        flexDirection: "column",
        gap: "6px",
        opacity: 1,
        transition: EASE,
      }}>
        <div style={{
          fontSize: "12px", fontWeight: 800, letterSpacing: "0.16em",
          color: palette.success, textTransform: "uppercase",
        }}>
          Done · next move loading
        </div>
        <div style={{
          fontSize: "14px",
          fontWeight: 500,
          color: palette.textSecondary,
          textDecoration: "line-through",
          lineHeight: 1.3,
        }}>
          ✓ {t.title}
        </div>
      </div>
    );
  }

  return (
    <div style={{
      padding: "18px 18px 16px",
      borderRadius: R.md,
      background: accentBg,
      borderTop: `1px solid ${accentBorder}`,
      borderRight: `1px solid ${accentBorder}`,
      borderBottom: `1px solid ${accentBorder}`,
      // Slightly thinner accent rail — feels more refined than 3px slab.
      borderLeft: `2px solid ${accent}`,
      // Right Now is the hero: lift it with SH.md regardless of label so
      // it always reads elevated against the rail surface.
      boxShadow: isExecute ? SH.lg : SH.md,
      display: "flex",
      flexDirection: "column",
      gap: "12px",
      transition: EASE,
    }}>
      <div style={{
        fontSize: "12px", fontWeight: 800, letterSpacing: "0.16em",
        color: accent, textTransform: "uppercase",
      }}>
        Right Now
      </div>

      {(() => {
        const action = explainTaskAction(t);
        const prio = explainTaskPriority(t);
        return (
          <>
            <div style={{ fontSize: "15px", fontWeight: 700, color: palette.textPrimary, lineHeight: 1.3 }}>
              {action.actionLabel}
            </div>
            <div style={{ fontSize: "11px", color: palette.textSecondary, lineHeight: 1.45 }}>
              <span style={{ fontWeight: 600, color: palette.textPrimary }}>Why: </span>
              {action.whyItMatters}
            </div>
            <div style={{ fontSize: "11px", color: palette.textTertiary, lineHeight: 1.45 }}>
              <span style={{ fontWeight: 600 }}>Priority: </span>
              {prio.label} — {prio.reason}
            </div>
          </>
        );
      })()}

      {decision.linkedCompany && decision.linkedCompany !== t.title && (
        <div style={{ fontSize: "11px", color: palette.textSecondary }}>
          {decision.linkedCompany}
        </div>
      )}

      {(t.tradeLabel || t.serviceBucketLabel) && (
        <div style={{
          fontSize: "10px", fontWeight: 700, letterSpacing: "0.06em",
          color: palette.textTertiary, textTransform: "uppercase",
        }}>
          {t.tradeLabel ?? "Trade"}
          {t.serviceBucketLabel ? ` · Angle · ${t.serviceBucketLabel}` : ""}
        </div>
      )}

      {/* One compact stat line — operator phrasing. Parts are
          precomputed (see statLineParts) so the render is deterministic
          and matches between server and client. */}
      {statLineParts.length > 0 && (
        <div style={{ fontSize: "12px", color: palette.textTertiary, display: "flex", flexWrap: "wrap", gap: "8px" }}>
          {statLineParts.map((p, i) => (
            <span key={`p-${i}-${p.key}`}>
              {i > 0 ? <span style={{ color: palette.textTertiary, marginRight: "8px" }}>·</span> : null}
              {p.node}
            </span>
          ))}
        </div>
      )}

      {/* Operator brief — primary line is the next move (bold), secondary is the reason. */}
      <div style={{ fontSize: "14px", fontWeight: 600, color: palette.textPrimary, lineHeight: 1.4 }}>
        {decision.nextMove}
      </div>
      <div style={{ fontSize: "12px", color: palette.textSecondary, lineHeight: 1.45 }}>
        {decision.reason}
      </div>

      {/* Risk only surfaces when it's actually high. */}
      {t.riskIfMissed === "high" && decision.riskSummary && (
        <div style={{ fontSize: "12px", color: palette.danger, fontStyle: "italic", lineHeight: 1.45 }}>
          Don&rsquo;t delay — {decision.riskSummary}
        </div>
      )}

      {(t.suggestedOpeningLine || t.johnServiceAngle) && (
        <div style={{ marginTop: "4px" }}>
          <button
            type="button"
            onClick={() => setApproachOpen((v) => !v)}
            aria-expanded={approachOpen}
            onFocus={(e) => {
              e.currentTarget.style.outline = FOCUS_RING;
              e.currentTarget.style.outlineOffset = "2px";
            }}
            onBlur={(e) => {
              e.currentTarget.style.outline = "none";
              e.currentTarget.style.outlineOffset = "0";
            }}
            style={{
              fontSize: "12px",
              fontWeight: 500,
              color: palette.textSecondary,
              background: "transparent",
              border: "none",
              padding: "4px 6px",
              marginLeft: "-6px",
              borderRadius: R.xs,
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              transition: EASE,
            }}
          >
            <span aria-hidden="true" style={{
              display: "inline-block",
              transition: EASE,
              transform: approachOpen ? "rotate(90deg)" : "rotate(0deg)",
              fontSize: "12px",
              lineHeight: 1,
              color: palette.textTertiary,
            }}>
              ›
            </span>
            {approachOpen ? "Hide script" : "Call script"}
          </button>
          {approachOpen && (
            <div style={{ display: "flex", flexDirection: "column", gap: "4px", marginTop: "6px" }}>
              {t.suggestedOpeningLine && (
                <div style={{ fontSize: "12px", color: palette.textSecondary, lineHeight: 1.45 }}>
                  <span style={{ fontWeight: 600, color: palette.textPrimary }}>Open with: </span>
                  {t.suggestedOpeningLine}
                </div>
              )}
              {t.johnServiceAngle && (
                <div style={{ fontSize: "12px", color: palette.textSecondary, lineHeight: 1.45 }}>
                  <span style={{ fontWeight: 600, color: palette.textPrimary }}>Sell angle: </span>
                  {t.johnServiceAngle}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {onTaskFeedback && t.status !== "done" && (
        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginTop: "4px" }}>
          <button
            type="button"
            onClick={handleMarkDone}
            onMouseEnter={(e) => { e.currentTarget.style.filter = "brightness(0.95)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.filter = "brightness(1)"; }}
            onFocus={(e) => {
              e.currentTarget.style.outline = FOCUS_RING;
              e.currentTarget.style.outlineOffset = "2px";
            }}
            onBlur={(e) => {
              e.currentTarget.style.outline = "none";
              e.currentTarget.style.outlineOffset = "0";
            }}
            style={{
              fontSize: "12px",
              fontWeight: 600,
              letterSpacing: "0.02em",
              color: "#fff",
              background: accent,
              border: "none",
              borderRadius: R.xs + 2,
              padding: "7px 14px",
              cursor: "pointer",
              boxShadow: SH.sm,
              transition: EASE,
            }}
          >
            Mark done
          </button>
          <FeedbackControls task={t} onTaskFeedback={onTaskFeedback} />
        </div>
      )}
    </div>
  );
}

function NextMovesList({ tasks, rightNowTaskId, now }) {
  const ordered = useMemo(() => {
    const filtered = (tasks ?? []).filter(
      (t) => t && t.status !== "done" && t.id !== rightNowTaskId,
    );
    const indexed = filtered.map((t, i) => ({ t, i }));
    indexed.sort((a, b) => {
      const c = compareLeadTasks(a.t, b.t, { now });
      if (c !== 0) return c;
      return a.i - b.i;
    });
    return indexed.slice(0, 3).map((p) => p.t);
  }, [tasks, rightNowTaskId, now]);

  if (ordered.length === 0) return null;

  return (
    <PanelSection title="Next Moves">
      {ordered.map((t) => {
        const cat = TASK_CATEGORIES[t.category] ?? TASK_CATEGORIES.priority;
        const ev = fmtMoney(t.expectedValue ?? t.revenueImpact);
        const overdue = isOverdue(t, now);
        const anchor = t.startTime ?? t.dueDate ?? null;
        const dueLine = overdue
          ? "Overdue"
          : anchor
            ? new Date(anchor).getTime() - now.getTime() <= 24 * 3_600_000
              ? "Due today"
              : null
            : null;
        return (
          <div
            key={t.id}
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "3px",
              padding: "9px 11px",
              borderRadius: R.sm,
              background: palette.surface,
              borderTop: `1px solid ${palette.borderLight}`,
              borderRight: `1px solid ${palette.borderLight}`,
              borderBottom: `1px solid ${palette.borderLight}`,
              borderLeft: `2px solid ${cat.tint}`,
              boxShadow: SH.sm,
              transition: EASE,
            }}
          >
            <div style={{
              display: "flex",
              justifyContent: "space-between",
              gap: "8px",
              alignItems: "baseline",
            }}>
              <span style={{
                fontSize: "9px", fontWeight: 700, letterSpacing: "0.06em",
                color: cat.tint, textTransform: "uppercase",
              }}>
                {cat.label}
                {t.tradeLabel || t.serviceBucketLabel ? (
                  <span style={{ color: palette.textTertiary, fontWeight: 600 }}>
                    {" · "}{t.tradeLabel ?? "Trade"}
                    {t.serviceBucketLabel ? ` · ${t.serviceBucketLabel}` : ""}
                  </span>
                ) : null}
              </span>
              {ev && (
                <span style={{ fontSize: "11px", color: palette.success, fontWeight: 600 }}>
                  {ev}
                </span>
              )}
            </div>
            <div style={{
              fontSize: "12px", fontWeight: 600, color: palette.textPrimary, lineHeight: 1.3,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
              {t.title}
            </div>
            {(dueLine || t.nextAction) && (
              <div style={{ fontSize: "11px", color: palette.textSecondary, lineHeight: 1.35 }}>
                {dueLine ? <>{dueLine}{t.nextAction ? " · " : ""}</> : null}
                {t.nextAction ? <span style={{ fontStyle: "italic" }}>→ {t.nextAction}</span> : null}
              </div>
            )}
          </div>
        );
      })}
    </PanelSection>
  );
}

function TodaysEdge({ insights }) {
  if (!Array.isArray(insights) || insights.length === 0) return null;
  const top = insights[0];
  if (!top) return null;
  return (
    <PanelSection title="Today's Edge">
      <div style={{
        padding: "10px 12px",
        borderRadius: R.sm,
        background: palette.surface,
        borderTop: `1px solid ${palette.borderLight}`,
        borderRight: `1px solid ${palette.borderLight}`,
        borderBottom: `1px solid ${palette.borderLight}`,
        borderLeft: `2px solid ${palette.blue}`,
        boxShadow: SH.sm,
        display: "flex",
        flexDirection: "column",
        gap: "3px",
        transition: EASE,
      }}>
        <div style={{ fontSize: "12px", fontWeight: 600, color: palette.textPrimary, lineHeight: 1.3 }}>
          {top.title}
        </div>
        <div style={{ fontSize: "11px", color: palette.textSecondary, lineHeight: 1.4 }}>
          {top.message}
        </div>
        {top.nextMove && (
          <div style={{ fontSize: "11px", color: palette.textSecondary, fontStyle: "italic" }}>
            → {top.nextMove}
          </div>
        )}
        <div style={{ fontSize: "10px", color: palette.textTertiary }}>
          {top.evidenceCount} signal{top.evidenceCount === 1 ? "" : "s"}
        </div>
      </div>
    </PanelSection>
  );
}

function HoldingArea({ tasks, now, onTaskFeedback }) {
  const overdue = tasks.filter((t) => isOverdue(t, now));
  const followUpsDue = tasks.filter((t) => {
    if (t.category !== "followup" || t.status === "done") return false;
    if (!t.dueDate) return false;
    return new Date(t.dueDate).getTime() <= now.getTime() + 24 * 3_600_000;
  });
  const revenueActions = tasks
    .filter((t) => (t.revenueImpact ?? 0) > 0 && t.status !== "done")
    .sort((a, b) => (b.revenueImpact ?? 0) - (a.revenueImpact ?? 0))
    .slice(0, 2);
  const riskFlags = tasks.filter((t) => t.riskIfMissed === "high" && t.status !== "done");

  const [open, setOpen] = useState(false);
  const counts = {
    overdue: overdue.length,
    followUps: followUpsDue.length,
    revenue: revenueActions.length,
    risks: riskFlags.length,
  };
  const total = counts.overdue + counts.followUps + counts.revenue + counts.risks;
  if (total === 0) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "6px", opacity: 0.92 }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        onMouseEnter={(e) => { e.currentTarget.style.background = palette.surfaceHover; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
        onFocus={applyFocusRing}
        onBlur={clearFocusRing}
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          width: "100%",
          padding: "9px 12px",
          background: "transparent",
          borderTop: `1px solid ${palette.borderLight}`,
          borderRight: `1px solid ${palette.borderLight}`,
          borderBottom: `1px solid ${palette.borderLight}`,
          borderLeft: `1px solid ${palette.borderLight}`,
          borderRadius: R.sm,
          cursor: "pointer",
          color: palette.textSecondary,
          fontSize: "10px",
          fontWeight: 700,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          transition: EASE,
        }}
      >
        <span>Later</span>
        <span style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "8px",
          color: palette.textTertiary,
          fontWeight: 500,
        }}>
          <span>{`${counts.overdue}o · ${counts.followUps}f · ${counts.revenue}r · ${counts.risks}!`}</span>
          <span aria-hidden="true" style={{
            display: "inline-block",
            transition: EASE,
            transform: open ? "rotate(90deg)" : "rotate(0deg)",
            color: palette.textTertiary,
            fontSize: "12px",
            lineHeight: 1,
          }}>
            ›
          </span>
        </span>
      </button>

      {open && (
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          {counts.overdue > 0 && (
            <PanelSection title={`Overdue (${counts.overdue})`}>
              {overdue.slice(0, 2).map((t) => (
                <TaskCard key={t.id} task={t} compact now={now} onTaskFeedback={onTaskFeedback} />
              ))}
            </PanelSection>
          )}
          {counts.followUps > 0 && (
            <PanelSection title={`Follow-Ups Due (${counts.followUps})`}>
              {followUpsDue.slice(0, 2).map((t) => (
                <TaskCard key={t.id} task={t} compact now={now} onTaskFeedback={onTaskFeedback} />
              ))}
            </PanelSection>
          )}
          {counts.revenue > 0 && (
            <PanelSection title="Revenue Actions">
              {revenueActions.map((t) => (
                <div key={t.id} style={{
                  display: "flex", justifyContent: "space-between", gap: "8px",
                  fontSize: "12px", padding: "6px 0",
                  borderBottom: `1px solid ${palette.borderLight}`,
                }}>
                  <span style={{
                    color: palette.textPrimary,
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>
                    {t.title}
                  </span>
                  <span style={{ color: palette.success, fontWeight: 600, flexShrink: 0 }}>
                    {fmtMoney(t.revenueImpact)}
                  </span>
                </div>
              ))}
            </PanelSection>
          )}
          {counts.risks > 0 && (
            <PanelSection title={`Risk Flags (${counts.risks})`}>
              {riskFlags.slice(0, 2).map((t) => (
                <div key={t.id} style={{ fontSize: "12px", color: palette.danger, padding: "4px 0" }}>
                  ▲ {t.title}
                </div>
              ))}
            </PanelSection>
          )}
        </div>
      )}
    </div>
  );
}

// ServiceFitOperatorSection — compact LaborTech service-fit pills
// rendered inside SelectedLeadPanel. Top 5 visible by default; the
// rest are gated behind a "View all" toggle. The "Break Down Services
// Needed →" button forwards to the same Assist Mode opener used
// everywhere else (onOpenDeepReport) and then scrolls the Intelligence
// Panel to the Services Needed section via a data-section selector.
function ServiceFitOperatorSection({ task, onOpenDeepReport }) {
  const [expanded, setExpanded] = useState(false);
  // Pull every scored service so the rep can see the full ranking
  // when expanded. The Operator surface shows score only — no why,
  // no evidence, no pitch, no objection risk. All explanatory copy
  // lives in Assist Mode (Break Down Services Needed → button).
  const breakdown = useMemo(() => buildServiceFitBreakdown(task, { minScore: 0 }), [task]);
  if (breakdown.length === 0) return null;

  // Default: top 5 by score regardless of tier — the previous min-40
  // gate could collapse the list down to 1 entry when only one
  // service crossed that floor. Collapsed = first 5; expanded = all
  // relevant services.
  const TOP_LIMIT = 5;
  const visible = expanded ? breakdown : breakdown.slice(0, TOP_LIMIT);
  const hasOverflow = breakdown.length > TOP_LIMIT;

  const toneFor = (score) =>
    score >= 80 ? { fg: palette.success, bg: palette.successBg, border: "#BBF7D0" }
    : score >= 60 ? { fg: palette.blue, bg: palette.bluePale, border: palette.blueBorder }
    : score >= 40 ? { fg: palette.textSecondary, bg: palette.surfaceHover, border: palette.borderLight }
    : { fg: palette.textTertiary, bg: palette.surfaceHover, border: palette.borderLight };

  const handleBreakDown = () => {
    // Open Assist Mode (no-op if already open). Routing is unchanged.
    if (typeof onOpenDeepReport === "function") onOpenDeepReport(task);
    if (typeof window === "undefined") return;
    // Wait two frames: one for React to commit the new deepReportOpen
    // state, one for the IntelligencePanel + AssistantSection effects
    // to register their listeners. Then dispatch the populate event
    // and scroll to the Services Needed section.
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        try {
          window.dispatchEvent(new CustomEvent("meridian:populate-services-needed", {
            detail: { taskId: task?.id ?? null },
          }));
        } catch { /* ignore — older browsers without CustomEvent ctor */ }
        const el = document.querySelector('[data-section="services-needed"]');
        if (el && typeof el.scrollIntoView === "function") {
          el.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      });
    });
  };

  // Self-test guard: when collapsed, if the breakdown contains ≥ 5
  // entries, `visible.length` MUST equal 5. If it doesn't, something
  // downstream is mutating the array — render an in-page warning so
  // the regression is impossible to miss in the browser.
  const expectedFiveBug =
    !expanded && breakdown.length >= 5 && visible.length !== 5;

  return (
    <section data-debug="operator-service-fit-live">
      <div style={{
        display: "flex",
        alignItems: "baseline",
        justifyContent: "space-between",
        gap: "8px",
        marginBottom: "5px",
        flexWrap: "wrap",
      }}>
        <div style={SECTION_EYEBROW}>LaborTech service fit</div>
        <div style={{
          fontSize: "10px",
          fontWeight: 700,
          letterSpacing: "0.06em",
          color: palette.textTertiary,
          textTransform: "uppercase",
          fontVariantNumeric: "tabular-nums",
        }}>
          Showing {visible.length} of {breakdown.length}
        </div>
      </div>
      {expectedFiveBug ? (
        <div
          role="alert"
          style={{
            fontSize: "11px",
            fontWeight: 800,
            color: palette.danger,
            background: palette.dangerBg,
            border: `1px solid #FECACA`,
            borderRadius: "8px",
            padding: "6px 10px",
            marginBottom: "8px",
          }}
        >
          Service fit display bug: expected 5, showing {visible.length}
        </div>
      ) : null}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
        {visible.map((entry) => {
          const tone = toneFor(entry.score);
          return (
            <span
              key={entry.serviceId}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                fontSize: "11px",
                fontWeight: 700,
                letterSpacing: "0.02em",
                padding: "4px 10px",
                borderRadius: "999px",
                color: tone.fg,
                background: tone.bg,
                border: `1px solid ${tone.border}`,
                whiteSpace: "nowrap",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              <span>{entry.label}</span>
              <span style={{ fontWeight: 800 }}>{Math.round(entry.score)}</span>
            </span>
          );
        })}
      </div>
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "8px",
        marginTop: "10px",
        flexWrap: "wrap",
      }}>
        {hasOverflow ? (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            style={{
              fontSize: "11px",
              fontWeight: 700,
              color: palette.blue,
              background: "transparent",
              border: "none",
              padding: 0,
              cursor: "pointer",
              letterSpacing: "0.02em",
            }}
          >
            {expanded ? "Show top 5 only" : `View all ${breakdown.length} service fits →`}
          </button>
        ) : <span aria-hidden="true" />}
        <button
          type="button"
          onClick={handleBreakDown}
          // Secondary pill — quiet by design. Call Now is the ONE
          // saturated execute CTA in the action zone; this is the
          // analytical companion. Border-only + blue text keeps the
          // surface uncluttered and lets the eye land on Call Now.
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "#EEF4FF";
            e.currentTarget.style.borderColor = "rgba(37,99,235,0.55)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "transparent";
            e.currentTarget.style.borderColor = "rgba(37,99,235,0.30)";
          }}
          style={{
            fontSize: "11px",
            fontWeight: 700,
            letterSpacing: "0.02em",
            color: palette.blue,
            background: "transparent",
            border: `1px solid rgba(37,99,235,0.30)`,
            borderRadius: "999px",
            padding: "6px 12px",
            cursor: "pointer",
            whiteSpace: "nowrap",
            transition: "background 200ms cubic-bezier(0.22, 1, 0.36, 1), border-color 200ms ease",
          }}
        >
          Break Down Services Needed →
        </button>
      </div>
    </section>
  );
}

// ── Field-test diagnostics panel (dev-only) ─────────────────────────
//
// Renders only in development; compares expected 20/day vs actual
// counts for the 6 field-test days. Pure read-only over tasksByDay.
// Removes itself in production builds via NODE_ENV check.
function FieldTestDiagnosticsPanel({ tasksByDay, dataTotal }) {
  // Client-only render to avoid SSR hydration mismatch. The panel
  // depends on runtime calendar task data + dev-only flags; rendering
  // it on the server would inevitably diverge from the client paint.
  // After mount we honor the production guard, then render normally.
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  if (!mounted) return null;
  if (typeof process !== "undefined" && process.env && process.env.NODE_ENV === "production") {
    return null;
  }
  const EXPECTED = [
    { day: "2026-05-07", label: "Thu May 7" },
    { day: "2026-05-08", label: "Fri May 8" },
    { day: "2026-05-11", label: "Mon May 11" },
    { day: "2026-05-12", label: "Tue May 12" },
    { day: "2026-05-13", label: "Wed May 13" },
    { day: "2026-05-14", label: "Thu May 14" },
  ];
  const callsFor = (k) => {
    const list = tasksByDay?.[k] ?? [];
    return list.filter((t) => {
      const id = t?.id ?? ""; const title = t?.title ?? "";
      return id.endsWith("-call") || title.startsWith("Call ");
    }).length;
  };
  const totalCalls = EXPECTED.reduce((sum, e) => sum + callsFor(e.day), 0);
  return (
    <section
      data-debug="field-test-diagnostics"
      style={{
        background: "#FFFBEB",
        border: "1px solid #FDE68A",
        borderRadius: "10px",
        padding: "10px 14px",
        marginBottom: "12px",
        fontSize: "11px",
        color: "#92400E",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      }}
    >
      <div style={{
        fontSize: "9px", fontWeight: 800, letterSpacing: "0.12em",
        color: "#B45309", textTransform: "uppercase", marginBottom: "6px",
      }}>
        Field-test diagnostics (dev-only)
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(6, minmax(0, 1fr))", gap: "8px" }}>
        {EXPECTED.map((e) => {
          const actual = callsFor(e.day);
          const ok = actual === 20;
          return (
            <div key={e.day} style={{
              padding: "6px 8px",
              borderRadius: "6px",
              background: ok ? "#DCFCE7" : actual > 0 ? "#FEF3C7" : "#FEE2E2",
              border: `1px solid ${ok ? "#BBF7D0" : actual > 0 ? "#FDE68A" : "#FECACA"}`,
              color: ok ? "#15803D" : actual > 0 ? "#92400E" : "#991B1B",
            }}>
              <div style={{ fontSize: "9px", fontWeight: 700, opacity: 0.75 }}>{e.label}</div>
              <div style={{ fontSize: "13px", fontWeight: 800, letterSpacing: "0.02em" }}>
                {actual} <span style={{ opacity: 0.5, fontWeight: 600 }}>/ 20</span>
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ fontSize: "10px", marginTop: "6px", opacity: 0.85 }}>
        data total = {dataTotal} · calls in field-test window = {totalCalls} of 120 expected ·
        {totalCalls < 120 ? ` LEAD POOL SHORTAGE: only ${totalCalls} call tasks reached the calendar.` : " full window populated."}
      </div>
    </section>
  );
}

// ── Execution Outcome panel ─────────────────────────────────────────
//
// Lightweight operator memory rendered inside SelectedLeadPanel. NOT
// a CRM — six controls, one localStorage map. Captures what happened
// after the lead was worked so the field-test data + commission
// attribution conversation have real evidence.
function ExecutionOutcomePanel({ taskId }) {
  const [outcome, setOutcome] = useState(() => getDefaultExecutionOutcome());

  // Load on mount + whenever the operator switches leads.
  useEffect(() => {
    if (!taskId) {
      setOutcome(getDefaultExecutionOutcome());
      return;
    }
    const loaded = loadExecutionOutcome(taskId);
    setOutcome(loaded ?? getDefaultExecutionOutcome());
  }, [taskId]);

  if (!taskId) return null;

  const apply = (patch) => {
    const next = updateExecutionOutcome(outcome, patch);
    setOutcome(next);
    saveExecutionOutcome(taskId, next);
    trackEvent({
      eventType: "outcome_save",
      taskId: taskId,
      metadata: {
        status: next.status,
        hasNotes: (next.notes ?? "").length > 0,
        estimatedValue: next.estimatedValue ?? null,
        nextFollowupDate: next.nextFollowupDate ?? null,
        patchKeys: Object.keys(patch ?? {}),
      },
    });
  };

  const QUICK_BUTTONS = [
    { label: "Called",        status: "Called",        tone: { fg: palette.blue,    bg: palette.bluePale,    border: palette.blueBorder } },
    { label: "Interested",    status: "Interested",    tone: { fg: palette.success, bg: palette.successBg,   border: "#BBF7D0" } },
    { label: "Follow Up",     status: "Follow Up",     tone: { fg: palette.blue,    bg: palette.bluePale,    border: palette.blueBorder } },
    { label: "Proposal Sent", status: "Proposal Sent", tone: { fg: palette.blue,    bg: palette.bluePale,    border: palette.blueBorder } },
    { label: "Won",           status: "Closed Won",    tone: { fg: "#15803D",       bg: "#F0FDF4",           border: "#BBF7D0" } },
    { label: "Lost",          status: "Closed Lost",   tone: { fg: palette.danger,  bg: palette.dangerBg,    border: "#FECACA" } },
  ];

  const lastActionRel = (() => {
    if (!outcome.lastActionAt) return null;
    const d = new Date(outcome.lastActionAt);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  })();

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
      <div style={{
        display: "flex",
        alignItems: "baseline",
        justifyContent: "space-between",
        gap: "8px",
      }}>
        <div style={SECTION_EYEBROW}>Execution outcome</div>
        <div style={{
          fontSize: "10px",
          fontWeight: 700,
          letterSpacing: "0.06em",
          color: palette.blue,
          textTransform: "uppercase",
        }}>
          Tracked through Meridian
        </div>
      </div>

      {/* Status pill row */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "5px" }}>
        {EXECUTION_OUTCOME_STATUSES.map((s) => {
          const isActive = outcome.status === s;
          return (
            <button
              key={s}
              type="button"
              onClick={() => apply({ status: s })}
              style={{
                fontSize: "10px",
                fontWeight: 700,
                letterSpacing: "0.04em",
                color: isActive ? "#fff" : palette.textSecondary,
                background: isActive ? palette.blue : palette.surfaceHover,
                border: `1px solid ${isActive ? palette.blue : palette.borderLight}`,
                borderRadius: "999px",
                padding: "3px 9px",
                cursor: "pointer",
                whiteSpace: "nowrap",
                transition: "background 200ms cubic-bezier(0.22, 1, 0.36, 1)",
              }}
            >
              {s}
            </button>
          );
        })}
      </div>

      {/* Quick buttons row */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "5px" }}>
        {QUICK_BUTTONS.map((b) => (
          <button
            key={b.label}
            type="button"
            onClick={() => apply({ status: b.status })}
            style={{
              fontSize: "11px",
              fontWeight: 800,
              letterSpacing: "0.02em",
              color: b.tone.fg,
              background: b.tone.bg,
              border: `1px solid ${b.tone.border}`,
              borderRadius: "8px",
              padding: "5px 10px",
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            {b.label}
          </button>
        ))}
      </div>

      {/* Notes */}
      <textarea
        rows={2}
        value={outcome.notes}
        onChange={(e) => setOutcome((prev) => ({ ...prev, notes: e.target.value }))}
        onBlur={() => apply({ notes: outcome.notes })}
        placeholder="Notes from this call…"
        style={{
          fontSize: "12px",
          fontFamily: "inherit",
          color: palette.textPrimary,
          background: palette.surface,
          border: `1px solid ${palette.borderLight}`,
          borderRadius: "8px",
          padding: "8px 10px",
          outline: "none",
          resize: "vertical",
          lineHeight: 1.45,
        }}
      />

      {/* Estimated value + Next follow-up */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
        <label style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
          <span style={{ fontSize: "9px", fontWeight: 700, letterSpacing: "0.06em", color: palette.textTertiary, textTransform: "uppercase" }}>
            Estimated value
          </span>
          <input
            type="number"
            min={0}
            step={100}
            value={outcome.estimatedValue ?? ""}
            onChange={(e) => {
              const v = e.target.value === "" ? null : Number(e.target.value);
              setOutcome((prev) => ({ ...prev, estimatedValue: Number.isFinite(v) ? v : null }));
            }}
            onBlur={() => apply({ estimatedValue: outcome.estimatedValue })}
            placeholder="$"
            style={{
              fontSize: "12px",
              fontFamily: "inherit",
              color: palette.textPrimary,
              background: palette.surface,
              border: `1px solid ${palette.borderLight}`,
              borderRadius: "8px",
              padding: "6px 9px",
              outline: "none",
              fontVariantNumeric: "tabular-nums",
            }}
          />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
          <span style={{ fontSize: "9px", fontWeight: 700, letterSpacing: "0.06em", color: palette.textTertiary, textTransform: "uppercase" }}>
            Next follow-up
          </span>
          <input
            type="date"
            value={outcome.nextFollowupDate ?? ""}
            onChange={(e) => apply({ nextFollowupDate: e.target.value || null })}
            style={{
              fontSize: "12px",
              fontFamily: "inherit",
              color: palette.textPrimary,
              background: palette.surface,
              border: `1px solid ${palette.borderLight}`,
              borderRadius: "8px",
              padding: "6px 9px",
              outline: "none",
            }}
          />
        </label>
      </div>

      {/* Saved timestamp */}
      {lastActionRel ? (
        <div style={{
          fontSize: "10px",
          color: palette.textTertiary,
          letterSpacing: "0.02em",
        }}>
          Saved {lastActionRel} · {outcome.attributionSource}
        </div>
      ) : null}
    </section>
  );
}

// SelectedLeadPanel — replaces Today Focus when an operator clicks a
// task on the calendar. Reads only fields already on TaskItem; never
// fabricates phone numbers, scripts, or revenue. Action buttons mutate
// status through the parent's handleTaskMutation handler.
export function SelectedLeadPanel({
  task,
  now,
  tradeLabel,
  onClose,
  onMutate,
  onOpen,
  callMode = "idle",
  onEnterCallMode,
  onExitCallMode,
  onRecordOutcome,
  callsCompletedToday = 0,
  queueRemaining = 0,
  currentNote = "",
  onChangeNote,
  onSwitchTab, // optional — when supplied, the LeadContextStrip renders cross-tab links
  selectedLead, // optional — full lead object for LeadEmailAction's Find Email mode
  onLeadUpdate, // optional — refresh hook fired after Hunter writes verifiedEmail
  hunterAvailable = false, // whether HUNTER_API_KEY is server-configured
  // Deep Report trigger — required. The drawer owns the layered Deep
  // Report panel; this prop must always be supplied by the parent.
  onOpenDeepReport,
}) {
  // Popover state removed — Call Now now fires tel: directly. No
  // intermediate confirmation step on a desktop operator workflow.
  const status = executionStatusFor(task);
  const action = explainTaskAction(task);
  const overdue = isOverdue(task, now);
  const money = fmtMoney(task.revenueImpact);
  const company = task.linkedCompany ?? action.actionLabel;
  const scan = task?.laborTechScan ?? null;
  const scanQualified = !!(scan && scan.qualified);
  // handleOpenScan removed — Assist Mode is now opened automatically
  // from the calendar card click (handleSelectTask → handleOpenAssist)
  // and from Today's Command Queue (Open Assist Mode button). The
  // Operator panel no longer surfaces a manual trigger.
  useEffect(() => {
    if (!DEBUG_UI) return;
    if (!task?.id) return;
    // eslint-disable-next-line no-console
    console.log(
      `[deep-report-button] company="${company}" hasScan=${scanQualified ? "true" : "false"}`,
    );
    const calendarService = task?.serviceShortLabel ?? task?.serviceBucketLabel ?? task?.laborTechScan?.primaryService ?? null;
    const panelService = task?.laborTechScan?.primaryService ?? task?.primaryServiceLabel ?? task?.serviceShortLabel ?? task?.serviceBucketLabel ?? null;
    const reportService = task?.laborTechScan?.primaryService ?? null;
    // eslint-disable-next-line no-console
    console.log(
      `[lead-context-audit] company="${company}" ` +
      `calendarService="${calendarService ?? ""}" ` +
      `panelService="${panelService ?? ""}" ` +
      `reportService="${reportService ?? ""}"`,
    );
  }, [task?.id, company, scanQualified, task?.serviceShortLabel, task?.serviceBucketLabel, task?.primaryServiceLabel, task?.laborTechScan?.primaryService]);

  const blocked = status?.id === "blocked";
  const due = task.dueDate ? new Date(task.dueDate) : null;
  const dueLabel = due
    ? due.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })
    : null;
  const tradeBadge = task.tradeLabel ?? tradeLabel ?? null;
  const address = task?.linkedLocation ?? null;
  const pri = priorityTone(task.priority);

  // Mirror the calendar card's middle pill copy resolution.
  const serviceLabel =
    scan?.primaryService
    || task?.primaryServiceLabel
    || task?.serviceShortLabel
    || (task?.serviceBucketLabel ?? null);
  const isService = !!scan?.primaryService;

  // Primary angle copy. Prefer the scan; fall back to the calendar
  // card's existing nextAction → whyItMatters chain.
  const primaryAngleHeadline =
    scan?.primaryPain
    || (typeof task.nextAction === "string" && task.nextAction.trim().length > 0
      ? task.nextAction.trim()
      : action.whyItMatters);
  const primaryAngleMeaning =
    Array.isArray(scan?.businessImpact) && scan.businessImpact.length > 0
      ? String(scan.businessImpact[0])
      : action.whyItMatters;
  const recommendedAction = scan?.recommendedAction ?? null;

  // Tel / SMS — same logic as FeedbackControls so the calendar and
  // operator panel dial through identical normalization.
  const phone = task?.phone || null;
  const phoneDigits = phone ? String(phone).replace(/\D/g, "") : "";
  const telHref = phoneDigits.length === 10
    ? `tel:+1${phoneDigits}`
    : phoneDigits.length === 11 && phoneDigits.startsWith("1")
      ? `tel:+${phoneDigits}`
      : phoneDigits ? `tel:${phoneDigits}` : null;
  const smsHref = phoneDigits.length === 10
    ? `sms:+1${phoneDigits}`
    : phoneDigits.length === 11 && phoneDigits.startsWith("1")
      ? `sms:+${phoneDigits}`
      : phoneDigits ? `sms:${phoneDigits}` : null;
  const phoneDisplay = phoneDigits.length === 10
    ? `(${phoneDigits.slice(0,3)}) ${phoneDigits.slice(3,6)}-${phoneDigits.slice(6)}`
    : phoneDigits.length === 11 && phoneDigits.startsWith("1")
      ? `+1 (${phoneDigits.slice(1,4)}) ${phoneDigits.slice(4,7)}-${phoneDigits.slice(7)}`
      : (phone || null);
  const callable = !!telHref && !blocked;
  const handlePrimaryCall = (e) => {
    if (!callable) { if (e?.preventDefault) e.preventDefault(); return; }
    if (typeof onMutate === "function") onMutate(task.id, { status: "in_progress" });
    if (typeof onOpen === "function") onOpen(task);
  };

  const ev = typeof task.expectedValue === "number" && task.expectedValue > 0 ? task.expectedValue : null;
  const probPct = typeof task.closeProbability === "number"
    ? Math.round(Math.max(0, Math.min(1, task.closeProbability)) * 100)
    : (typeof task.closeProbability100 === "number"
      ? Math.round(task.closeProbability100)
      : null);
  const closeLabel = scan?.closeability?.label ?? null;
  const closeScore = typeof scan?.closeability?.score === "number" ? scan.closeability.score : null;
  const closeReason = scan?.closeability?.reason ?? null;
  const closeTone = closeLabel === "High-Intent" || closeLabel === "Strong"
    ? { fg: palette.success, bg: palette.successBg, border: "#BBF7D0" }
    : closeLabel === "Weak"
      ? { fg: palette.textTertiary, bg: palette.surfaceHover, border: palette.borderLight }
      : { fg: palette.blue, bg: palette.bluePale, border: palette.blueBorder };

  const evidence = Array.isArray(scan?.evidence) ? scan.evidence : [];
  const businessImpact = Array.isArray(scan?.businessImpact) ? scan.businessImpact : [];
  const risks = Array.isArray(scan?.risks) ? scan.risks : [];
  const opener = scan?.salesAngle?.opener ?? task?.suggestedOpeningLine ?? null;
  const objection = scan?.salesAngle?.objection ?? null;
  const rebuttal = scan?.salesAngle?.rebuttal ?? null;

  return (
    <>
    {/* Modal scrim removed — Call Mode is an execution state, not a
        modal interruption. The action zone itself now gains a calm
        blue highlight via the panel boxShadow ladder below when
        callMode === "active". */}
    <aside style={{
      width: "360px",
      flexShrink: 0,
      padding: "16px 14px",
      paddingBottom: "24px",
      background: "rgba(255,255,255,0.96)",
      // Selected-blue panel border — soft 1.5px on three sides plus
      // a stronger 2px blue rail on the left. Matches the Assistant
      // and Deep Report panels so the workflow reads as one system.
      // Danger override stays for blocked leads.
      borderTop: blocked ? `1px solid ${palette.danger}` : panelBlueBorderSoft,
      borderRight: blocked ? `1px solid ${palette.danger}` : panelBlueBorderSoft,
      borderBottom: blocked ? `1px solid ${palette.danger}` : panelBlueBorderSoft,
      borderLeft: blocked ? `2px solid ${palette.danger}` : panelBlueBorder,
      ...(callMode === "active" ? {
        position: "relative",
        zIndex: 40,
        boxShadow: "0 0 0 2px rgba(37,99,235,0.45), 0 1px 2px rgba(15,23,42,0.04), 0 18px 50px -12px rgba(15,23,42,0.30)",
      } : {
        boxShadow: panelBlueGlow,
      }),
      borderRadius: "18px",
      display: "flex",
      flexDirection: "column",
      gap: "18px",
      alignSelf: "stretch",
      // Operator panel — fills its drawer cell and scrolls
      // internally for tall content. The drawer's Operator cell
      // wrapper enforces the actual cap (full panelMaxHeight in
      // closed state, the flex-allocated remainder in deep state).
      height: "100%",
      overflowY: "auto",
      overscrollBehavior: "contain",
    }}>
      {/* ── Top row: priority · LaborTech bucket · trade ── (mirrors TaskCard) */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "auto 1fr auto",
        gap: "6px",
        alignItems: "center",
      }}>
        <span style={{
          justifySelf: "start",
          fontSize: "9px", fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase",
          padding: "1px 6px", borderRadius: R.xs,
          color: pri.color, background: pri.bg,
          border: `1px solid ${pri.border}`,
          whiteSpace: "nowrap",
        }}>
          {task.priority}
        </span>
        {serviceLabel ? (
          <span
            title={serviceLabel}
            style={{
              justifySelf: "center",
              maxWidth: "180px",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              fontSize: "10px",
              fontWeight: 800,
              letterSpacing: "0.06em",
              padding: "2px 9px",
              borderRadius: "999px",
              textTransform: "uppercase",
              ...(isService
                ? { color: "#2563EB", background: "rgba(59,130,246,0.08)", border: "1px solid rgba(59,130,246,0.18)" }
                : { color: palette.textSecondary, background: palette.surfaceHover, border: `1px solid ${palette.borderLight}` }),
            }}
          >
            {serviceLabel}
          </span>
        ) : <span aria-hidden="true" />}
        <span style={{ justifySelf: "end", display: "inline-flex", alignItems: "center", gap: "6px" }}>
          {tradeBadge ? (
            <span style={{
              fontSize: "9px", fontWeight: 700, letterSpacing: "0.05em",
              padding: "1px 7px", borderRadius: "999px",
              color: palette.textSecondary, background: palette.surfaceHover,
              border: `1px solid ${palette.borderLight}`,
              whiteSpace: "nowrap",
              textTransform: "uppercase",
            }}>
              {tradeBadge}
            </span>
          ) : null}
          {callsCompletedToday > 0 ? (
            <span
              title={`${callsCompletedToday} calls completed today`}
              style={{
                fontSize: "10px", fontWeight: 800, letterSpacing: "0.06em",
                padding: "2px 8px", borderRadius: "999px",
                color: palette.success, background: palette.successBg,
                border: "1px solid #BBF7D0",
                whiteSpace: "nowrap",
                textTransform: "uppercase",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {callsCompletedToday} today
            </span>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close selected lead"
            onFocus={applyFocusRing}
            onBlur={clearFocusRing}
            style={{
              fontSize: "16px",
              color: palette.textTertiary,
              background: "transparent",
              border: "none",
              cursor: "pointer",
              padding: "0 4px",
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </span>
      </div>

      {/* Cross-tab context strip — identical visual identity in
          Today, All Leads, and History so the user reads them as
          one system, not three views. */}
      <LeadContextStrip
        companyName={company}
        trade={tradeBadge}
        location={address}
        sourceTab="today"
        statusInput={task}
        onSwitchTab={onSwitchTab}
      />

      {/* Manual email action — single shared component. Picks the
          right mode for this lead: Email ✓ if Hunter-verified, plain
          Email if regular, Find Email if neither and Hunter is
          connected. Click-only; never auto-fires. */}
      {selectedLead ? (
        <>
          <LeadEmailAction
            email={selectedLead.contacts?.primaryEmail ?? selectedLead.email ?? null}
            verifiedEmail={selectedLead.verifiedEmail ?? null}
            emailSource={selectedLead.emailSource ?? null}
            emailConfidence={selectedLead.emailConfidence ?? null}
            companyName={selectedLead.name ?? company}
            hunterAvailable={hunterAvailable}
            lead={selectedLead}
            onUpdate={onLeadUpdate}
            size="md"
          />
          <ContactStrategyPanel lead={selectedLead} compact />
        </>
      ) : null}

      {/* Company name + address (calendar-card identity row, expanded) */}
      <div>
        <div style={{
          fontSize: "18px", fontWeight: 700, color: palette.textPrimary,
          lineHeight: 1.2, letterSpacing: "-0.005em",
        }}>
          {company}
        </div>
        {address ? (
          <div style={{ fontSize: "12px", color: palette.textTertiary, marginTop: "3px" }}>
            {address}
          </div>
        ) : null}
        {(dueLabel || overdue) ? (
          <div style={{
            fontSize: "11px",
            color: overdue ? palette.danger : palette.textTertiary,
            fontWeight: overdue ? 700 : 500,
            letterSpacing: overdue ? "0.04em" : "normal",
            marginTop: "4px",
          }}>
            {overdue ? "OVERDUE · " : "Due "}{dueLabel}
          </div>
        ) : null}
      </div>

      <Divider />

      {/* ── TIER-2 OPERATOR: SERVICE-FIT EXECUTION PANEL ────────
          Best LaborTech offer · Why this company needs it · Evidence ·
          Opening angle · Next move. The full service map (every
          service scored, secondary offers, pitch path) lives in the
          Intelligence Panel — this surface picks the ONE offer the
          rep should lead with. */}
      {(() => {
        const fit = getLaborTechServiceFit(task);

        // BEST LABORTECH OFFER — primary service from the fit engine.
        const offerLabel = fit?.recommendedOffer ?? null;
        const offerConfidence = fit?.confidence ?? null;
        const offerScore = fit?.scores?.[fit?.primaryService ?? ""] ?? null;
        const offerEvidence = fit?.evidenceByService?.[fit?.primaryService ?? ""] ?? [];
        const offerWhyNow = fit?.whyNow ?? null;
        const offerOpener = fit?.openingAngle ?? null;

        // Fallback opener — if no fit (e.g. no scan), reach back to
        // the legacy salesAngle + recommendedAction so we never blank
        // the Operator on legacy leads.
        const fallbackOpener =
          (typeof opener === "string" && opener.trim())
          || (typeof recommendedAction === "string" && recommendedAction.trim())
          || null;

        return (
          <>
            {offerLabel ? (
              <section>
                <div style={SECTION_EYEBROW}>Best LaborTech offer</div>
                <div style={{
                  display: "flex",
                  alignItems: "center",
                  flexWrap: "wrap",
                  gap: "8px",
                  marginBottom: "6px",
                }}>
                  <span style={{
                    fontSize: "14px",
                    fontWeight: 800,
                    color: palette.textPrimary,
                    letterSpacing: "0.01em",
                  }}>
                    {offerLabel}
                  </span>
                  {offerConfidence ? (
                    <span style={{
                      fontSize: "10px", fontWeight: 800, letterSpacing: "0.06em",
                      padding: "2px 8px", borderRadius: "999px",
                      color: offerConfidence === "High" ? palette.success : offerConfidence === "Medium" ? palette.blue : palette.textSecondary,
                      background: offerConfidence === "High" ? palette.successBg : offerConfidence === "Medium" ? palette.bluePale : palette.surfaceHover,
                      border: `1px solid ${offerConfidence === "High" ? "#BBF7D0" : offerConfidence === "Medium" ? palette.blueBorder : palette.borderLight}`,
                      whiteSpace: "nowrap",
                      textTransform: "uppercase",
                      fontVariantNumeric: "tabular-nums",
                    }}>
                      {offerConfidence}{typeof offerScore === "number" ? ` · ${Math.round(offerScore)}%` : ""} fit
                    </span>
                  ) : null}
                </div>
              </section>
            ) : null}

            {offerWhyNow ? (
              <section>
                <div style={SECTION_EYEBROW}>Why this company needs it</div>
                <div style={{
                  fontSize: "12.5px",
                  color: palette.textSecondary,
                  lineHeight: 1.5,
                }}>
                  {offerWhyNow}
                </div>
              </section>
            ) : null}

            {offerEvidence.length > 0 ? (
              <section>
                <div style={SECTION_EYEBROW}>Evidence</div>
                <ul style={{
                  margin: 0, paddingLeft: "16px",
                  fontSize: "12px", color: palette.textPrimary, lineHeight: 1.5,
                }}>
                  {offerEvidence.slice(0, 3).map((e, i) => (
                    <li key={`fit-ev-${i}`} style={{ marginBottom: "3px" }}>{e}</li>
                  ))}
                </ul>
              </section>
            ) : null}

            {(offerOpener || fallbackOpener) ? (
              <section>
                <div style={SECTION_EYEBROW}>Opening angle</div>
                <div style={{
                  fontSize: "13px",
                  fontWeight: 600,
                  color: palette.textPrimary,
                  lineHeight: 1.5,
                  padding: "10px 12px",
                  background: palette.bluePale,
                  border: `1px solid ${palette.blueBorder}`,
                  borderRadius: "10px",
                }}>
                  “{offerOpener ?? fallbackOpener}”
                </div>
              </section>
            ) : null}

            {/* NEXT MOVE — clear instruction, 1–2 lines. Synthesised
                from urgency + contact readiness so the rep always
                sees ONE decisive next step. */}
            {(() => {
              const urgency = scan?.urgency?.label ?? null;
              const isHotUrgency = urgency === "Critical" || urgency === "High";
              const hasPhone = !!phoneDigits;
              const hasEmail = (() => {
                const e = selectedLead?.verifiedEmail
                  ?? selectedLead?.contacts?.primaryEmail
                  ?? selectedLead?.email
                  ?? task?.verifiedEmail
                  ?? task?.email
                  ?? null;
                return typeof e === "string" && e.trim().length > 0;
              })();
              const move = (() => {
                if (hasPhone && isHotUrgency) return "Call now — urgency is high. Lead with the opening angle.";
                if (hasPhone)                  return "Call today and lead with the opening angle above.";
                if (hasEmail)                  return "Send the opening angle via email today.";
                return "Find a phone or verified email before reaching out.";
              })();
              return (
                <section>
                  <div style={SECTION_EYEBROW}>Next move</div>
                  <div style={{
                    fontSize: "13px",
                    fontWeight: 700,
                    color: palette.textPrimary,
                    lineHeight: 1.45,
                    padding: "10px 12px",
                    background: "#FFFFFF",
                    border: `1.5px solid ${palette.blue}`,
                    borderRadius: "10px",
                    boxShadow: "0 1px 2px rgba(37,99,235,0.10)",
                  }}>
                    {move}
                  </div>
                </section>
              );
            })()}
          </>
        );
      })()}

      {/* LABORTECH SERVICE FIT — compact pills sorted high-to-low.
          Top 5 by default; "View all service fits" expands to the
          full list. Below 40 = always hidden unless expanded. The
          full per-service breakdown lives in Assist Mode and is
          opened by the button below. */}
      <ServiceFitOperatorSection task={task} onOpenDeepReport={onOpenDeepReport} />

      <Divider />

      {/* Action zone. Phone number stays hidden until Call Now is
          clicked — the popover is the only place it surfaces. Send
          Text removed from this panel per spec. */}
      <div style={{ display: "flex", flexDirection: "column", gap: "10px", position: "relative" }}>
        {/* "Open Assist Mode →" button intentionally removed — both
            Today's Command Queue and a normal calendar card click
            now route through handleEnterAssistMode, so by the time
            the operator sees this panel the Intelligence Panel is
            already open. A redundant button here just slowed the
            flow. Call Now / Mark Contacted / Move to Follow Up /
            Kill Lead are unchanged. */}
        {/* Call Now — direct execution. Click fires tel: immediately
            (no popover gate), enters Call Mode, marks the lead
            in_progress, and stamps the Execution Outcome status to
            "Called" so the persistent outcome map matches reality.
            The phone number renders inline below for visibility on
            desktop softphone setups. Single click, single intent. */}
        <a
          href={telHref ?? undefined}
          onClick={(e) => {
            if (!telHref) { e.preventDefault(); return; }
            if (callMode !== "active" && typeof onEnterCallMode === "function") {
              onEnterCallMode(task);
            }
            if (typeof onMutate === "function") onMutate(task.id, { status: "in_progress" });
            if (typeof onOpen === "function") onOpen(task);
            if (task?.id) {
              try {
                const next = updateExecutionOutcome(loadExecutionOutcome(task.id), { status: "Called" });
                saveExecutionOutcome(task.id, next);
              } catch { /* fail silent */ }
            }
            trackEvent({
              eventType: "call_now_clicked",
              taskId: task?.id ?? null,
              leadId: task?.linkedLeadId ?? null,
              companyName: company,
              tradeId: task?.tradeId ?? null,
              serviceBucketId: task?.laborTechScan?.primaryService ?? null,
            });
          }}
          aria-label={telHref ? `Call ${company} now` : "Call unavailable"}
          aria-disabled={!telHref}
          onFocus={applyFocusRing}
          onBlur={clearFocusRing}
          style={{
            width: "100%",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "8px",
            fontSize: "13px",
            fontWeight: 800,
            color: telHref ? "#FFFFFF" : palette.textTertiary,
            background: telHref ? palette.blue : palette.surfaceHover,
            border: telHref ? `1px solid ${palette.blue}` : `1px solid ${palette.borderLight}`,
            borderRadius: "10px",
            padding: "11px 12px",
            cursor: telHref ? "pointer" : "not-allowed",
            transition: "background 200ms cubic-bezier(0.22, 1, 0.36, 1), box-shadow 200ms ease",
            letterSpacing: "0.02em",
            boxShadow: telHref ? "0 1px 2px rgba(37,99,235,0.20), 0 8px 22px -8px rgba(37,99,235,0.45)" : "none",
            textDecoration: "none",
            pointerEvents: telHref ? "auto" : "none",
          }}
        >
          <span>{telHref ? "Call Now" : "Call unavailable"}</span>
          {telHref && phoneDisplay ? (
            <span style={{
              fontSize: "12px",
              fontWeight: 700,
              opacity: 0.9,
              fontVariantNumeric: "tabular-nums",
              letterSpacing: "0.04em",
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            }}>
              · {phoneDisplay}
            </span>
          ) : null}
        </a>
        {/* Call Mode outcome capture. Only renders while a call is
            in progress. Outcome buttons mutate the task + auto-load
            the next lead via onRecordOutcome. */}
        {callMode === "active" ? (
          <div style={{
            marginTop: "4px",
            padding: "12px 14px",
            background: palette.bluePale,
            border: `1px solid ${palette.blueBorder}`,
            borderRadius: "12px",
            display: "flex",
            flexDirection: "column",
            gap: "10px",
            boxShadow: "0 0 0 1px rgba(37,99,235,0.10), 0 6px 18px -8px rgba(37,99,235,0.30)",
          }}>
            <div style={{
              display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px",
            }}>
              <div style={{
                fontSize: "10px", fontWeight: 800, letterSpacing: "0.14em",
                color: palette.blue, textTransform: "uppercase",
              }}>
                Call Mode
              </div>
              <div style={{
                fontSize: "11px", fontWeight: 700,
                color: palette.textSecondary,
                fontVariantNumeric: "tabular-nums",
              }}>
                {callsCompletedToday} done · {Math.max(0, queueRemaining - 1)} left
              </div>
            </div>
            <div style={{
              fontSize: "10px", fontWeight: 700, letterSpacing: "0.10em",
              color: palette.textTertiary, textTransform: "uppercase",
            }}>
              Outcome
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px" }}>
              {[
                { id: "connected_interested",     label: "Connected — Interested",      tone: "success" },
                { id: "connected_not_interested", label: "Connected — Not Interested",  tone: "neutral" },
                { id: "no_answer",                label: "No Answer",                   tone: "neutral" },
                { id: "wrong_number",             label: "Wrong Number",                tone: "danger" },
                { id: "callback_needed",          label: "Callback Needed",             tone: "blue" },
              ].map((o) => {
                const tone =
                  o.tone === "success" ? { fg: "#fff", bg: palette.success, border: palette.success }
                  : o.tone === "danger"  ? { fg: palette.danger, bg: palette.dangerBg, border: "#FECACA" }
                  : o.tone === "blue"    ? { fg: palette.blue, bg: "#FFFFFF", border: "rgba(37,99,235,0.30)" }
                  : { fg: palette.textPrimary, bg: "#FFFFFF", border: palette.borderLight };
                return (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => onRecordOutcome?.(o.id)}
                    style={{
                      fontSize: "12px",
                      fontWeight: 700,
                      color: tone.fg,
                      background: tone.bg,
                      border: `1px solid ${tone.border}`,
                      borderRadius: "10px",
                      padding: "8px 10px",
                      cursor: "pointer",
                      letterSpacing: "0.02em",
                      textAlign: "center",
                    }}
                    onFocus={applyFocusRing}
                    onBlur={clearFocusRing}
                  >
                    {o.label}
                  </button>
                );
              })}
            </div>
            <div>
              <div style={{
                fontSize: "10px", fontWeight: 700, letterSpacing: "0.10em",
                color: palette.textTertiary, textTransform: "uppercase",
                marginBottom: "4px",
              }}>
                Notes
              </div>
              <textarea
                value={currentNote}
                onChange={(e) => onChangeNote?.(e.target.value)}
                placeholder="What happened on the call?"
                rows={3}
                style={{
                  width: "100%",
                  fontSize: "12px",
                  lineHeight: 1.5,
                  color: palette.textPrimary,
                  background: "#FFFFFF",
                  border: `1px solid ${palette.borderLight}`,
                  borderRadius: "10px",
                  padding: "8px 10px",
                  outline: "none",
                  resize: "vertical",
                  fontFamily: "inherit",
                }}
              />
            </div>
            <button
              type="button"
              onClick={onExitCallMode}
              style={{
                alignSelf: "flex-end",
                fontSize: "11px",
                fontWeight: 600,
                color: palette.textSecondary,
                background: "transparent",
                border: `1px solid ${palette.borderLight}`,
                borderRadius: "10px",
                padding: "6px 12px",
                cursor: "pointer",
              }}
            >
              Exit Call Mode
            </button>
          </div>
        ) : null}
        <div style={{
          display: "flex", gap: "6px", flexWrap: "wrap",
          opacity: callMode === "active" ? 0.45 : 1,
          pointerEvents: callMode === "active" ? "none" : "auto",
        }}>
          <button
            type="button"
            onClick={() => onMutate?.(task.id, { status: "done", feedbackApplied: true, feedbackReason: "Marked contacted" })}
            style={SECONDARY_BUTTON}
            onFocus={applyFocusRing}
            onBlur={clearFocusRing}
          >
            Mark Contacted
          </button>
          <button
            type="button"
            onClick={() => onMutate?.(task.id, { category: "followup", priority: "medium", feedbackApplied: true, feedbackReason: "Moved to follow up" })}
            style={SECONDARY_BUTTON}
            onFocus={applyFocusRing}
            onBlur={clearFocusRing}
          >
            Move to Follow Up
          </button>
          <button
            type="button"
            onClick={() => onMutate?.(task.id, { status: "done", priority: "low", feedbackApplied: true, feedbackReason: "Killed" })}
            style={{ ...SECONDARY_BUTTON, color: palette.danger, borderColor: "#FECACA", background: palette.dangerBg }}
            onFocus={applyFocusRing}
            onBlur={clearFocusRing}
          >
            Kill Lead
          </button>
        </div>
      </div>

      <Divider />

      <ExecutionOutcomePanel taskId={task.id} />

    </aside>
    </>
  );
}

// Empty-state operator panel. Renders when no calendar card is
// selected. Intentionally minimal — no Today Focus, no Right Now,
// no Up Next, no auto-selected lead. The calendar already shows
// the day's leads; this surface only activates after a click.
function OperatorEmptyPanel() {
  return (
    <aside style={{
      width: "360px",
      flexShrink: 0,
      padding: "24px 20px",
      background: palette.surface,
      borderTop: `1px solid ${palette.border}`,
      borderRight: `1px solid ${palette.border}`,
      borderBottom: `1px solid ${palette.border}`,
      borderLeft: `1px solid ${palette.border}`,
      borderRadius: R.md,
      alignSelf: "stretch",
      height: "100%",
      overflowY: "auto",
      overscrollBehavior: "contain",
      boxShadow: SH.sm,
      transition: EASE,
      display: "flex",
      flexDirection: "column",
      alignItems: "flex-start",
      gap: "10px",
    }}>
      <span aria-hidden="true" style={{
        width: "32px",
        height: "32px",
        borderRadius: "999px",
        background: palette.bluePale,
        border: `1px solid ${palette.blueBorder}`,
        color: palette.blue,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: "16px",
        fontWeight: 800,
      }}>
        ›
      </span>
      <div style={{
        fontSize: "10px", fontWeight: 800, letterSpacing: "0.14em",
        color: palette.textTertiary, textTransform: "uppercase",
      }}>
        Operator
      </div>
      <div style={{
        fontSize: "16px", fontWeight: 700, color: palette.textPrimary, lineHeight: 1.3,
      }}>
        Select a lead
      </div>
      <div style={{
        fontSize: "12px", color: palette.textSecondary, lineHeight: 1.55,
      }}>
        Click any calendar card to open the sales playbook.
      </div>
    </aside>
  );
}

// Light hairline divider — keeps section rhythm without heavy chrome.
function Divider() {
  return (
    <div aria-hidden="true" style={{
      height: "1px",
      background: "#F1F5F9",
      margin: "0",
    }} />
  );
}

const SECTION_EYEBROW = {
  fontSize: "9px", fontWeight: 700, letterSpacing: "0.10em",
  color: palette.textTertiary, textTransform: "uppercase",
  marginBottom: "5px",
};
const REVENUE_CHIP = {
  fontSize: "11px", fontWeight: 600,
  color: palette.success,
  padding: "3px 9px",
  borderRadius: "999px",
  background: palette.successBg,
  border: "1px solid #BBF7D0",
};
const PRIMARY_BUTTON = {
  fontSize: "13px",
  fontWeight: 700,
  color: "#fff",
  background: palette.blue,
  border: "none",
  borderRadius: R.sm,
  padding: "10px 14px",
  cursor: "pointer",
  boxShadow: "0 1px 2px rgba(37,99,235,0.25), 0 6px 14px -6px rgba(37,99,235,0.45)",
  transition: EASE,
  letterSpacing: "0.02em",
};
const SECONDARY_BUTTON = {
  fontSize: "11px",
  fontWeight: 600,
  color: palette.textSecondary,
  background: palette.surfaceHover,
  borderTop: `1px solid ${palette.borderLight}`,
  borderRight: `1px solid ${palette.borderLight}`,
  borderBottom: `1px solid ${palette.borderLight}`,
  borderLeft: `1px solid ${palette.borderLight}`,
  borderRadius: R.sm,
  padding: "8px 10px",
  cursor: "pointer",
  transition: EASE,
};

function TodayFocusPanel({ tasks, now, executeNow, insights, onTaskFeedback, tradeLabel, hasTradeLeads = true, tradeReadiness, bucketPortfolio, prioritizedAngles, onImport, importState, selectedServiceAngleId, selectedServiceAngleLabel, onClearServiceAngle, onSelectServiceAngle, hasAngleLeads = true }) {
  const reducedMotion = usePrefersReducedMotion();

  // Operator-level overrides — UI-only, never mutate scoring/scheduling.
  const [promotedTaskId, setPromotedTaskId] = useState(null);
  const [doneIds, setDoneIds] = useState(() => new Set());
  const [exitingId, setExitingId] = useState(null);
  const [enterToken, setEnterToken] = useState(0);
  const [completedToday, setCompletedToday] = useState(0);
  // Deep Report is owned by LeadWorkflowDrawer; this surface no
  // longer mounts its own scan modal. Kept as a no-op so legacy
  // child props don't error out.
  const openScan = () => {};

  const candidates = useMemo(() => {
    const list = (tasks ?? []).filter(
      (t) => t && t.status !== "done" && !doneIds.has(t.id),
    );
    list.sort((a, b) => compareLeadTasks(a, b, { now }));
    return list;
  }, [tasks, doneIds, now]);

  const activeTask = useMemo(() => {
    if (promotedTaskId) {
      const found = candidates.find((t) => t.id === promotedTaskId);
      if (found) return found;
    }
    if (executeNow?.task && candidates.some((t) => t.id === executeNow.task.id)) {
      return executeNow.task;
    }
    return candidates[0] ?? null;
  }, [promotedTaskId, candidates, executeNow]);

  const queueTasks = useMemo(() => {
    if (!activeTask) return candidates.slice(0, 6);
    return candidates.filter((t) => t.id !== activeTask.id).slice(0, 6);
  }, [candidates, activeTask]);

  const promoteTask = (taskId) => {
    if (!activeTask || reducedMotion) {
      setPromotedTaskId(taskId);
      setEnterToken((t) => t + 1);
      return;
    }
    const fromId = activeTask.id;
    setExitingId(fromId);
    window.setTimeout(() => {
      setPromotedTaskId(taskId);
      setExitingId(null);
      setEnterToken((t) => t + 1);
    }, 280);
  };

  const markActiveDone = () => {
    if (!activeTask) return;
    const id = activeTask.id;
    if (typeof onTaskFeedback === "function") {
      onTaskFeedback(activeTask, "accept_adjustment", "Operator completed the recommended action");
    }
    setCompletedToday((c) => c + 1);
    if (reducedMotion) {
      setDoneIds((prev) => { const n = new Set(prev); n.add(id); return n; });
      setPromotedTaskId(null);
      setEnterToken((t) => t + 1);
      return;
    }
    setExitingId(id);
    window.setTimeout(() => {
      setDoneIds((prev) => { const n = new Set(prev); n.add(id); return n; });
      setPromotedTaskId(null);
      setExitingId(null);
      setEnterToken((t) => t + 1);
    }, 360);
  };

  return (
    <>
    <aside
      data-meridian-rail=""
      style={{
        width: "360px",
        flexShrink: 0,
        padding: "16px",
        paddingBottom: "24px",
        background: RAIL.pageBg,
        borderTop: `1px solid ${RAIL.border}`,
        borderRight: `1px solid ${RAIL.border}`,
        borderBottom: `1px solid ${RAIL.border}`,
        borderLeft: `1px solid ${RAIL.border}`,
        borderRadius: "16px",
        display: "flex",
        flexDirection: "column",
        gap: "16px",
        alignSelf: "stretch",
        // Independent scroll for the rail.
        height: "100%",
        overflowY: "auto",
        overscrollBehavior: "contain",
        boxShadow: SH.sm,
        transition: EASE,
      }}
    >
      {/* Today header */}
      <div>
        <div style={{
          fontSize: "11px", fontWeight: 700, letterSpacing: "0.12em",
          color: RAIL.muted, textTransform: "uppercase",
        }}>
          Today Focus
        </div>
        <div style={{ fontSize: "18px", fontWeight: 650, color: RAIL.textPrimary, marginTop: "2px" }}>
          {DAY_FULL[now.getDay()]}, {now.toLocaleDateString(undefined, { month: "short", day: "numeric" })}
        </div>
      </div>

      {!hasTradeLeads ? (
        // Trade not yet connected: portfolio preview only.
        <ServiceAnglesPanel
          tradeLabel={tradeLabel}
          bucketPortfolio={bucketPortfolio}
          prioritizedAngles={prioritizedAngles}
          hasTradeLeads={hasTradeLeads}
          onImport={onImport}
          importState={importState}
          selectedServiceAngleId={selectedServiceAngleId}
          onSelectServiceAngle={onSelectServiceAngle}
          onClearServiceAngle={onClearServiceAngle}
        />
      ) : (
        <>
          <RightNowCommand
            task={activeTask}
            exiting={!!activeTask && exitingId === activeTask.id}
            enterKey={enterToken}
            onMarkDone={activeTask ? markActiveDone : null}
            onOpenScan={openScan}
            reducedMotion={reducedMotion}
          />

          <UpNextQueue
            tasks={queueTasks}
            onPromote={promoteTask}
            onOpenScan={openScan}
            reducedMotion={reducedMotion}
          />

          <MomentumFooter completed={completedToday} goal={10} />
        </>
      )}
    </aside>
    </>
  );
}

// ── Day column ─────────────────────────────────────────────────────────

function DayColumn({ date, tasks, isToday, now, onTaskFeedback, selectedTaskId, onSelectTask, linkedCountFor, viewMode = "single", isFirstActive = false, isPreLaunch = false }) {
  const grouped = useMemo(() => {
    const out = {};
    for (const t of tasks) {
      (out[t.category] ??= []).push(t);
    }
    return CATEGORY_ORDER
      .filter((c) => out[c]?.length)
      .map((c) => ({ category: c, items: out[c] }));
  }, [tasks]);

  // Time-of-day grouping (Morning / Midday / Afternoon) — purely visual.
  // Reads each task's anchor hour but never mutates timestamps. Tasks
  // without a parseable anchor fall through to "Midday" so nothing
  // disappears from the column.
  const timeBuckets = useMemo(() => {
    const buckets = { Morning: [], Midday: [], Afternoon: [] };
    for (const t of tasks) {
      let hour = 12;
      try {
        const a = taskAnchorIso(t);
        if (a) {
          const h = new Date(a).getHours();
          if (Number.isFinite(h)) hour = h;
        }
      } catch { /* keep default */ }
      if (hour < 12) buckets.Morning.push(t);
      else if (hour < 14) buckets.Midday.push(t);
      else buckets.Afternoon.push(t);
    }
    return buckets;
  }, [tasks]);
  const hasAnyTimeGrouping =
    timeBuckets.Morning.length + timeBuckets.Midday.length + timeBuckets.Afternoon.length > 0
    && (
      (timeBuckets.Morning.length > 0 ? 1 : 0)
      + (timeBuckets.Midday.length > 0 ? 1 : 0)
      + (timeBuckets.Afternoon.length > 0 ? 1 : 0)
    ) >= 2;

  // First 3 tasks of the first active day get the "Start with these"
  // emphasis. Computed against the already-ranked tasks array so it
  // matches whatever priority order the parent passed in.
  const priorityIds = useMemo(() => {
    if (!isFirstActive) return new Set();
    return new Set(tasks.slice(0, 3).map((t) => t.id));
  }, [tasks, isFirstActive]);

  // Tier breakdown for the day-summary line.
  const tierCounts = useMemo(() => {
    const out = { CLOSE_NOW: 0, STRONG: 0, TEST: 0 };
    for (const t of tasks) {
      const tier = t?.leadTier;
      if (tier === "CLOSE_NOW" || tier === "STRONG" || tier === "TEST") {
        out[tier]++;
      }
    }
    return out;
  }, [tasks]);
  const hasTierData =
    tierCounts.CLOSE_NOW + tierCounts.STRONG + tierCounts.TEST > 0;

  // Open / breathing column styling — lighter borders so the grid
  // reads as context, not a boxed-in panel. Day-1 gets a stronger
  // blue accent so it anchors the rollout plan ("Start here").
  const dimBorder = "rgba(15,23,42,0.05)";
  // Pre-launch days fade to a softer border so the eye skips past them
  // and lands on Day 1. Same border family, lower contrast.
  const preLaunchBorder = "rgba(15,23,42,0.06)";
  const accentBorder = isFirstActive
    ? palette.blue
    : isPreLaunch ? preLaunchBorder : dimBorder;
  return (
    <div style={{
      flex: "1 1 0",
      minWidth: "180px",
      display: "flex",
      flexDirection: "column",
      gap: "12px",
      padding: "14px",
      borderRadius: R.sm,
      background: isFirstActive
        ? "rgba(37,99,235,0.045)"
        : isPreLaunch ? "rgba(15,23,42,0.015)"
        : isToday ? "rgba(37,99,235,0.025)" : palette.surface,
      borderTop: `1px solid ${isFirstActive ? accentBorder : (isPreLaunch ? preLaunchBorder : dimBorder)}`,
      borderRight: `1px solid ${isPreLaunch ? preLaunchBorder : dimBorder}`,
      borderBottom: `1px solid ${isPreLaunch ? preLaunchBorder : dimBorder}`,
      borderLeft: `${isFirstActive ? "3px" : "1px"} solid ${accentBorder}`,
      boxShadow: isFirstActive ? "0 1px 2px rgba(37,99,235,0.10), 0 8px 22px -10px rgba(37,99,235,0.30)" : "none",
      // Lower opacity on pre-launch days — content stays legible (~62%)
      // but the column reads as visually deprioritized vs Day 1.
      opacity: isPreLaunch ? 0.62 : 1,
      transition: EASE,
    }}>
      {isFirstActive ? (
        <div style={{
          fontSize: "9px", fontWeight: 800, letterSpacing: "0.12em",
          color: palette.blue, textTransform: "uppercase",
          marginBottom: "-4px",
          lineHeight: 1.3,
        }}>
          Start here — highest probability opportunities
        </div>
      ) : isPreLaunch ? (
        <div style={{
          fontSize: "9px", fontWeight: 700, letterSpacing: "0.12em",
          color: palette.textTertiary, textTransform: "uppercase",
          marginBottom: "-4px",
        }}>
          Pre-launch
        </div>
      ) : null}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "6px" }}>
        <div>
          <div style={{
            fontSize: "10px", fontWeight: 600, letterSpacing: "0.08em",
            color: isToday ? palette.blue : palette.textTertiary,
            textTransform: "uppercase",
          }}>
            {DAY_SHORT[date.getDay()]}
          </div>
          <div style={{
            fontSize: "14px", fontWeight: 600,
            color: isToday ? palette.textPrimary : palette.textSecondary,
          }}>
            {date.getDate()}
          </div>
        </div>
        <span style={{ fontSize: "10px", color: palette.textTertiary }}>
          {tasks.length} {tasks.length === 1 ? "item" : "items"}
        </span>
      </div>

      {isFirstActive ? (
        <div style={{
          padding: "10px 11px",
          borderRadius: R.xs + 2,
          background: "linear-gradient(180deg, rgba(37,99,235,0.07) 0%, rgba(37,99,235,0.03) 100%)",
          border: `1px solid rgba(37,99,235,0.22)`,
          display: "flex",
          flexDirection: "column",
          gap: "6px",
        }}>
          <div style={{
            fontSize: "11px", fontWeight: 800,
            color: palette.blue, letterSpacing: "0.02em",
            lineHeight: 1.3,
          }}>
            {tasks.length > 0 ? "Your first calling day" : "Start your outreach here"}
          </div>
          <div style={{
            fontSize: "10.5px", color: palette.textSecondary,
            lineHeight: 1.45, fontStyle: "italic",
          }}>
            {tasks.length > 0
              ? "Start here — focus on these calls first."
              : "Use this day to begin testing your approach."}
          </div>
          <ul style={{
            margin: "2px 0 0 0",
            padding: "0 0 0 14px",
            listStyle: "disc",
            display: "flex",
            flexDirection: "column",
            gap: "3px",
            fontSize: "10.5px",
            color: palette.textSecondary,
            lineHeight: 1.4,
          }}>
            <li>Focus on the highest-priority opportunities first.</li>
            <li>Use these calls to test messaging and openers.</li>
            <li>Adjust approach based on what you hear back.</li>
          </ul>
        </div>
      ) : null}

      {hasTierData ? (
        <div style={{
          fontSize: "10px", fontWeight: 600,
          color: palette.textSecondary,
          letterSpacing: "0.02em",
          padding: "5px 7px",
          borderRadius: R.xs + 2,
          background: palette.surfaceHover,
          border: `1px solid ${palette.borderLight}`,
          display: "flex",
          flexWrap: "wrap",
          gap: "6px",
          alignItems: "center",
        }}>
          <span style={{ color: palette.textPrimary, fontWeight: 700 }}>
            {tasks.length} {tasks.length === 1 ? "lead" : "leads"}
          </span>
          <span style={{ color: palette.textTertiary }}>·</span>
          <span style={{ color: tierTone("CLOSE_NOW").bg, fontWeight: 700 }}>
            {tierCounts.CLOSE_NOW} Close Now
          </span>
          <span style={{ color: palette.textTertiary }}>·</span>
          <span style={{ color: "#1E40AF", fontWeight: 700 }}>
            {tierCounts.STRONG} Strong
          </span>
          <span style={{ color: palette.textTertiary }}>·</span>
          <span style={{ color: palette.textSecondary, fontWeight: 700 }}>
            {tierCounts.TEST} Test
          </span>
        </div>
      ) : null}

      {tasks.length === 0 ? (
        isFirstActive ? (
          // Day-1 kickoff empty state. The summary block above already
          // frames this column as "Start your outreach here" — this card
          // reinforces it as intentional, not as "nothing scheduled."
          <div style={{
            fontSize: "11px",
            color: palette.textSecondary,
            padding: "16px 12px",
            textAlign: "center",
            borderRadius: R.xs + 2,
            border: `1px dashed rgba(37,99,235,0.35)`,
            background: "rgba(37,99,235,0.04)",
            lineHeight: 1.55,
          }}>
            <div style={{ fontWeight: 700, color: palette.blue, marginBottom: "4px" }}>
              Day 1 of execution
            </div>
            <div style={{ color: palette.textSecondary }}>
              Use this day to begin testing your approach. Pull from the priority queue or trade lists when you're ready to start dialing.
            </div>
          </div>
        ) : (
          <div style={{
            fontSize: "11px",
            color: palette.textTertiary,
            fontStyle: "italic",
            padding: "20px 8px",
            textAlign: "center",
            borderRadius: R.xs + 2,
            border: `1px dashed ${palette.borderLight}`,
            background: "rgba(0,0,0,0.015)",
            lineHeight: 1.5,
          }}>
            No scheduled outreach
          </div>
        )
      ) : hasAnyTimeGrouping ? (
        // Time-of-day grouping (Morning / Midday / Afternoon). Pure
        // presentational re-binning — order within each block follows
        // the parent's rankTasks() result.
        ["Morning", "Midday", "Afternoon"].map((label) => {
          const items = timeBuckets[label];
          if (!items || items.length === 0) return null;
          const isFirstNonEmpty =
            isFirstActive
            && (
              (label === "Morning")
              || (label === "Midday" && timeBuckets.Morning.length === 0)
              || (label === "Afternoon" && timeBuckets.Morning.length === 0 && timeBuckets.Midday.length === 0)
            );
          return (
            <div key={label}>
              <div style={{
                display: "flex",
                alignItems: "baseline",
                justifyContent: "space-between",
                marginBottom: "6px",
              }}>
                <div style={{
                  fontSize: "9px", fontWeight: 700, letterSpacing: "0.10em",
                  color: palette.textSecondary,
                  textTransform: "uppercase",
                }}>
                  {label}
                </div>
                {isFirstNonEmpty ? (
                  <div style={{
                    fontSize: "9px", fontWeight: 800, letterSpacing: "0.08em",
                    color: palette.blue, textTransform: "uppercase",
                  }}>
                    Start with these
                  </div>
                ) : null}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "7px" }}>
                {items.map((t) => {
                  const isPriority = priorityIds.has(t.id);
                  return (
                    <div
                      key={t.id}
                      style={isPriority ? {
                        position: "relative",
                        borderRadius: R.xs + 2,
                        boxShadow: "0 0 0 2.5px rgba(37,99,235,0.32), 0 6px 18px -10px rgba(37,99,235,0.45)",
                      } : undefined}
                    >
                      <TaskCard
                        task={t}
                        compact
                        now={now}
                        onTaskFeedback={onTaskFeedback}
                        isSelected={selectedTaskId === t.id}
                        onSelect={onSelectTask}
                        pipelineLinkedCount={typeof linkedCountFor === "function" ? linkedCountFor(t) : 0}
                        viewMode={viewMode}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })
      ) : (
        // Falls back to category grouping when only one time bucket has
        // tasks (mostly the case today since most tasks anchor to morning).
        grouped.map(({ category, items }, gi) => (
          <div key={category}>
            <div style={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              marginBottom: "5px",
            }}>
              <div style={{
                fontSize: "9px", fontWeight: 700, letterSpacing: "0.08em",
                color: TASK_CATEGORIES[category].tint,
                textTransform: "uppercase",
              }}>
                {TASK_CATEGORIES[category].label}
              </div>
              {isFirstActive && gi === 0 ? (
                <div style={{
                  fontSize: "9px", fontWeight: 800, letterSpacing: "0.08em",
                  color: palette.blue, textTransform: "uppercase",
                }}>
                  Start with these
                </div>
              ) : null}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "7px" }}>
              {items.map((t) => {
                const isPriority = priorityIds.has(t.id);
                return (
                  <div
                    key={t.id}
                    style={isPriority ? {
                      position: "relative",
                      borderRadius: R.xs + 2,
                      boxShadow: "0 0 0 2px rgba(37,99,235,0.18)",
                    } : undefined}
                  >
                    <TaskCard
                      task={t}
                      compact
                      now={now}
                      onTaskFeedback={onTaskFeedback}
                      isSelected={selectedTaskId === t.id}
                      onSelect={onSelectTask}
                      pipelineLinkedCount={typeof linkedCountFor === "function" ? linkedCountFor(t) : 0}
                      viewMode={viewMode}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

// ── Main ───────────────────────────────────────────────────────────────

export default function CalendarCommandCenter({
  tasks,
  insights,
  onTaskFeedback,
  tradeSlot,
  tradeId,
  tradeLabel,
  tradeReadiness,
  hasTradeLeads = true,
  bucketPortfolio,
  prioritizedAngles,
  onImportTradeLeads,
  importState,
  selectedServiceAngleId,
  selectedServiceAngleLabel,
  onClearServiceAngle,
  onSelectServiceAngle,
  hasAngleLeads = true,
  // Cross-tab selection bridge — when supplied, the parent owns the
  // selectedTaskId state so it survives the user switching tabs and
  // returning. When omitted, the component falls back to internal
  // state (existing behaviour, no break for any other call sites).
  selectedTaskId: externalSelectedTaskId,
  onSelectTask: externalOnSelectTask,
  // Cross-tab navigation — when supplied, the LeadContextStrip in
  // SelectedLeadPanel renders "View in All Leads / History" buttons
  // that fire this callback with the target tab key.
  onSwitchTab,
  // Full lead object for the currently-selected task. Sourced from the
  // OperatorConsole's selectedLead derivation so the Find Email button
  // (which needs lead.website / lead.domain) has the data Hunter needs.
  // null when no task is selected.
  selectedLead,
  // Refresh hook fired after the lead is mutated (e.g. Hunter writes
  // verifiedEmail). Same handler the All Leads side uses.
  onLeadUpdate,
  // HUNTER_API_KEY presence flag — drives whether LeadEmailAction
  // offers Find Email mode in the right rail.
  hunterAvailable = false,
  // Workflow UI state — when supplied, the parent owns these so the
  // exact same state drives the All Leads inline workflow too. When
  // omitted, falls back to internal state (older standalone mounts).
  assistantCollapsed: externalAssistantCollapsed,
  onToggleAssistant: externalOnToggleAssistant,
  deepReportOpen: externalDeepReportOpen,
  onDeepReportOpen: externalOnDeepReportOpen,
  onDeepReportClose: externalOnDeepReportClose,
  // Today's "Open Assist Mode →" routing. When supplied, this is the
  // single entry point that flips selectedTask + deepReportOpen in the
  // PARENT in one commit. We must call this rather than driving the
  // two states from the child — otherwise the parent's selectedTaskId
  // effect runs after our intent-aware effect and resets Assist Mode.
  // Today Open Assist Mode = execution intent, not normal selection.
  onEnterAssistMode: externalOnEnterAssistMode,
}) {
  // Single source of truth for the calendar's view mode. "all" when the
  // operator is in All Trades mode, otherwise the active trade slug.
  const viewMode = (!tradeId || tradeId === "all") ? "all" : "single";
  // DEMO ANCHOR: initial week defaults to the week containing the
  // LaborTech demo anchor (May 7). UI state only — backend scheduling
  // is unchanged. The user can still navigate prev/next/Today freely.
  const [weekOffset, setWeekOffset] = useState(() => {
    try {
      return laborTechDemoWeekOffset(startOfWeek(new Date()));
    } catch {
      return 0;
    }
  });
  // Calendar view mode — day / week / month. Default week.
  const [calendarView, setCalendarView] = useState("week");
  // Day offset (number of days from today). Used only when calendarView === "day".
  const [dayOffset, setDayOffset] = useState(0);
  // Month offset (number of months from current month). Used only when "month".
  const [monthOffset, setMonthOffset] = useState(0);
  // Operator vs Calendar mode. Operator = priority-ranked top 5 across all
  // leads. Calendar = the time-based grid.
  const [layoutMode, setLayoutMode] = useState("calendar");
  // Selected task — drives the left panel. null = default Today Focus rail.
  // Controlled vs internal: when the parent supplies selectedTaskId +
  // onSelectTask (the OperatorConsole bridge), those win and internal
  // state is unused. Otherwise the component runs standalone with
  // local state. Single source of truth — never both.
  const isTaskSelectionControlled =
    typeof externalOnSelectTask === "function";
  const [internalSelectedTaskId, setInternalSelectedTaskId] = useState(null);
  const selectedTaskId = isTaskSelectionControlled
    ? (externalSelectedTaskId ?? null)
    : internalSelectedTaskId;
  // Single setter the rest of the component uses; routes to the
  // appropriate sink so call sites don't have to know whether this
  // instance is controlled. When controlled, looks up the task by id
  // in the current `data` array so the parent receives the full task
  // object (it needs linkedLeadId to bridge selectedKey).
  const setSelectedTaskId = (next) => {
    if (isTaskSelectionControlled) {
      let taskObj = null;
      if (next != null) {
        if (typeof next === "object") {
          taskObj = next;
        } else {
          // Lookup by id; falls back to a minimal stub if not found
          // so the parent can at least clear/echo the id.
          // eslint-disable-next-line no-use-before-define
          const found = Array.isArray(data) ? data.find((t) => t?.id === next) : null;
          taskObj = found ?? { id: next };
        }
      }
      externalOnSelectTask(taskObj);
    } else {
      // Local state — accept either id or full object (we just store id).
      const idVal = next && typeof next === "object" ? next.id : next;
      setInternalSelectedTaskId(idVal ?? null);
    }
  };
  // Internal-state fallback for when the parent doesn't supply
  // workflow UI state. When the parent DOES supply it (the new
  // OperatorConsole-level lift), parent wins so Today + All Leads
  // share the same open/closed state.
  const [internalAssistantCollapsed, setInternalAssistantCollapsed] = useState(true);
  const [userClosedAssistant, setUserClosedAssistant] = useState(false);
  const [internalDeepReportOpen, setInternalDeepReportOpen] = useState(false);
  const isAssistantControlled = typeof externalOnToggleAssistant === "function";
  const isDeepReportControlled = typeof externalOnDeepReportOpen === "function" && typeof externalOnDeepReportClose === "function";
  const assistantCollapsed = isAssistantControlled
    ? (externalAssistantCollapsed ?? true)
    : internalAssistantCollapsed;
  const deepReportOpen = isDeepReportControlled
    ? !!externalDeepReportOpen
    : internalDeepReportOpen;
  const setAssistantCollapsed = isAssistantControlled
    ? (next) => {
        const willBeCollapsed = typeof next === "function"
          ? next(externalAssistantCollapsed)
          : next;
        // Parent owns the value — only fire the toggle if it actually
        // changes the state to avoid double-flipping.
        if (willBeCollapsed !== externalAssistantCollapsed) {
          externalOnToggleAssistant();
        }
      }
    : setInternalAssistantCollapsed;
  const setDeepReportOpen = isDeepReportControlled
    ? (next) => { if (next) externalOnDeepReportOpen(); else externalOnDeepReportClose(); }
    : setInternalDeepReportOpen;

  // Assist-mode routing intent. When set to a task id, the next
  // selectedTaskId-change effect treats this lead as "user explicitly
  // opened Assist Mode for it" and opens the panel instead of
  // resetting it. This is what makes Today's "Open Assist Mode →"
  // button land on [Operator + Intelligence Panel] in one click.
  const assistIntentRef = useRef(null);

  // When the operator changes leads via the calendar, Assist Mode
  // resets to a fresh slate. The exception is a routed-in selection
  // from Today's Command Queue — in that case we honour the intent
  // and open the panel as part of the same state commit.
  //
  // IMPORTANT: only run this in STANDALONE mode. When CCC is
  // controlled (the OperatorConsole bridge), the parent owns the
  // intent ref AND the reset effect. Running both would race — the
  // parent's reset (which fires after the child effect in React's
  // bottom-up effect order) would win and clobber the open.
  useEffect(() => {
    if (isDeepReportControlled) return;
    if (assistIntentRef.current && assistIntentRef.current === selectedTaskId) {
      assistIntentRef.current = null;
      setDeepReportOpen(true);
    } else {
      setDeepReportOpen(false);
    }
    // setDeepReportOpen identity changes per controlled/internal mode
    // but is stable inside one mount — exclude it from deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTaskId]);
  // Auto-expand the assistant when Deep Report opens — the rep needs
  // the sales coach most while reviewing the deep report. Respects
  // explicit user dismissal: if they've closed the assistant during
  // this session, we don't override their choice.
  useEffect(() => {
    if (deepReportOpen && !userClosedAssistant) {
      setAssistantCollapsed(false);
    }
    // Only re-fire when the report toggles, not when dismissal flips.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deepReportOpen]);
  // Call mode — single state machine for the rapid call loop:
  //   "idle"   = normal browsing, calendar fully interactive.
  //   "active" = a call is in progress; calendar is locked until the
  //              operator records an outcome and the next lead loads.
  const [callMode, setCallMode] = useState("idle");
  const [callsCompletedToday, setCallsCompletedToday] = useState(0);
  // Per-lead notes captured during the call. Keyed by task id and
  // persisted to localStorage so a refresh doesn't lose them. No
  // backend yet.
  const [notesByTaskId, setNotesByTaskId] = useState({});
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(CALL_NOTES_KEY);
      if (raw) setNotesByTaskId(JSON.parse(raw) ?? {});
    } catch { /* ignore */ }
  }, []);
  const setNoteForTask = (taskId, text) => {
    setNotesByTaskId((prev) => {
      const next = { ...prev, [taskId]: text };
      if (typeof window !== "undefined") {
        try { window.localStorage.setItem(CALL_NOTES_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      }
      return next;
    });
  };
  // Local task overrides for status changes triggered from the left panel
  // (Mark Contacted, Move to Follow Up, Kill Lead). We keep these local
  // so the main task list isn't mutated; if the parent provides a real
  // mutation handler later it can subsume this.
  const [taskOverrides, setTaskOverrides] = useState({});

  // Operator guidance — small overlay launched from the header. The
  // dismissed state is stored in localStorage so first-time users see a
  // tiny "New here?" nudge once and never again.
  const [guidanceOpen, setGuidanceOpen] = useState(false);
  const [guidanceDismissed, setGuidanceDismissed] = useState(true);
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      setGuidanceDismissed(window.localStorage.getItem(GUIDANCE_DISMISS_KEY) === "1");
    } catch {
      setGuidanceDismissed(true);
    }
  }, []);
  const handleCloseGuidance = () => {
    setGuidanceOpen(false);
    setGuidanceDismissed(true);
    if (typeof window !== "undefined") {
      try { window.localStorage.setItem(GUIDANCE_DISMISS_KEY, "1"); } catch { /* ignore */ }
    }
  };

  // Generate "now" once per mount so all comparisons line up.
  const now = useMemo(() => new Date(), []);
  const baseData = useMemo(() => tasks ?? getMockTasks(), [tasks]);
  // Merge any panel-driven overrides (status changes) on top of the
  // canonical task list. Pure derivation — no mutation.
  const data = useMemo(() => {
    if (Object.keys(taskOverrides).length === 0) return baseData;
    return baseData.map((t) => (taskOverrides[t.id] ? { ...t, ...taskOverrides[t.id] } : t));
  }, [baseData, taskOverrides]);

  const selectedTask = useMemo(() => {
    if (!selectedTaskId) return null;
    return data.find((t) => t.id === selectedTaskId) ?? null;
  }, [selectedTaskId, data]);

  const handleSelectTask = (task) => {
    if (!task) return;
    if (callMode === "active") return;
    trackEvent({
      eventType: "calendar_card_select",
      taskId: task.id ?? null,
      leadId: task.linkedLeadId ?? null,
      companyName: task.linkedCompany ?? null,
      tradeId: task.tradeId ?? null,
      serviceBucketId: task?.laborTechScan?.primaryService ?? null,
      metadata: { source: "calendar" },
    });
    handleOpenAssist(task);
  };
  const handleClearSelectedTask = () => {
    if (callMode === "active") return;
    setSelectedTaskId(null);
  };

  // enterExecutionMode — Today's Command Queue routing handler.
  // ONE call drives every step:
  //   1. mark Assist intent so the selectedTaskId effect opens the
  //      panel instead of resetting it. When we're in CONTROLLED
  //      mode the parent owns the intent ref (via onEnterAssistMode);
  //      we forward to it. When we're standalone, the intent ref on
  //      this component is the only one that matters.
  //   2. select the lead (lifts it into the operator slot)
  //   3. set deepReportOpen=true directly when the lead is already
  //      selected (in which case the effect above won't fire)
  //   4. scroll the matching calendar TaskCard into view
  //   5. fire a one-shot highlight pulse so the rep's eye lands on it
  //
  // Today Open Assist Mode = EXECUTION INTENT, not normal lead
  // selection. A normal calendar click still resets Assist Mode.
  const handleOpenAssist = (task) => {
    if (!task) return;
    if (callMode === "active") return;
    trackEvent({
      eventType: "deep_report_open",
      taskId: task.id ?? null,
      leadId: task.linkedLeadId ?? null,
      companyName: task.linkedCompany ?? null,
      tradeId: task.tradeId ?? null,
      serviceBucketId: task?.laborTechScan?.primaryService ?? null,
    });
    if (typeof externalOnEnterAssistMode === "function") {
      externalOnEnterAssistMode(task);
    } else {
      assistIntentRef.current = task.id;
      if (selectedTaskId === task.id) {
        setDeepReportOpen(true);
        assistIntentRef.current = null;
      } else {
        setSelectedTaskId(task.id);
      }
    }
    if (typeof window === "undefined") return;
    window.requestAnimationFrame(() => {
      const el = document.querySelector(`[data-task-id="${task.id}"]`);
      if (!el) return;
      if (typeof el.scrollIntoView === "function") {
        el.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
      }
      el.setAttribute("data-just-routed", "true");
      window.setTimeout(() => {
        if (el.getAttribute("data-task-id") === task.id) {
          el.removeAttribute("data-just-routed");
        }
      }, 1300);
    });
  };

  // Assistant auto-expand on lead selection. The assistant is most
  // useful at the moment of action, so when a lead is opened we
  // expand it unless the user has explicitly closed it during this
  // session. Clearing the lead resets to the quiet floating-pill
  // default so the next lead gets a fresh auto-expand.
  useEffect(() => {
    if (!selectedTaskId) {
      setAssistantCollapsed(true);
      setUserClosedAssistant(false);
      return;
    }
    if (!userClosedAssistant) {
      setAssistantCollapsed(false);
    }
    // Intentionally NOT depending on userClosedAssistant: a manual
    // close mid-session shouldn't re-fire this effect and re-open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTaskId]);

  // Toggle handler that respects user intent — collapsing during a
  // lead session marks the dismissal so we don't re-auto-open;
  // expanding clears that flag so the assistant stays available.
  const handleToggleAssistant = () => {
    setAssistantCollapsed((wasCollapsed) => {
      const willBeCollapsed = !wasCollapsed;
      if (willBeCollapsed) setUserClosedAssistant(true);
      else setUserClosedAssistant(false);
      return willBeCollapsed;
    });
  };
  const handleTaskMutation = (taskId, patch) => {
    if (!taskId) return;
    setTaskOverrides((prev) => ({ ...prev, [taskId]: { ...(prev[taskId] ?? {}), ...patch } }));
  };

  // ── Call mode loop ───────────────────────────────────────────────
  // Build the working call queue from the current data — every open
  // task ordered by the same comparator the rail uses, so "next" is
  // always the next-best lead.
  const callQueue = useMemo(() => {
    return (data ?? [])
      .filter((t) => t && t.status !== "done")
      .slice()
      .sort((a, b) => compareLeadTasks(a, b, { now }));
  }, [data, now]);

  const enterCallMode = (task) => {
    if (!task) return;
    setSelectedTaskId(task.id);
    setCallMode("active");
  };
  const exitCallMode = () => {
    setCallMode("idle");
  };

  // Outcome → task patch + advance. Patches stay local via
  // handleTaskMutation; the queue is recomputed on the next render.
  const recordOutcomeAndAdvance = (outcomeId) => {
    const current = data.find((t) => t.id === selectedTaskId);
    if (!current) {
      setCallMode("idle");
      return;
    }
    const note = (notesByTaskId[current.id] ?? "").trim();
    // eslint-disable-next-line no-console
    console.log(
      `[call-outcome] lead="${current.linkedCompany ?? current.id}" ` +
      `outcome="${outcomeId}" notesLength=${note.length}`,
    );
    // Map outcome → task patch.
    let patch = null;
    switch (outcomeId) {
      case "connected_interested":
        patch = { status: "in_progress", feedbackApplied: true, feedbackReason: "Connected — interested" };
        break;
      case "connected_not_interested":
        patch = { status: "done", priority: "low", feedbackApplied: true, feedbackReason: "Connected — not interested" };
        break;
      case "no_answer":
        patch = { feedbackApplied: true, feedbackReason: "No answer" };
        break;
      case "wrong_number":
        patch = { status: "blocked", feedbackApplied: true, feedbackReason: "Wrong number" };
        break;
      case "callback_needed":
        patch = { category: "followup", priority: "medium", feedbackApplied: true, feedbackReason: "Callback needed" };
        break;
      default:
        patch = { feedbackApplied: true, feedbackReason: outcomeId };
    }
    handleTaskMutation(current.id, patch);
    setCallsCompletedToday((c) => c + 1);

    // Bridge the Call Mode outcome into the persistent Execution
    // Outcome layer. One state path: every call mode outcome is also
    // a status the Today queue + commission-attribution log read.
    try {
      const statusMap = {
        connected_interested:     "Interested",
        connected_not_interested: "Closed Lost",
        no_answer:                "Called",
        wrong_number:             "Closed Lost",
        callback_needed:          "Follow Up",
      };
      const targetStatus = statusMap[outcomeId] ?? "Called";
      const outcomeNotes = note;
      const merged = updateExecutionOutcome(loadExecutionOutcome(current.id), {
        status: targetStatus,
        notes: outcomeNotes || undefined,
      });
      saveExecutionOutcome(current.id, merged);
    } catch { /* fail silent */ }

    // Pick next — first item in callQueue that isn't the one we just
    // recorded and whose effective status is still open. callQueue
    // hasn't re-derived yet in this tick, so filter inline.
    const next = callQueue.find(
      (t) =>
        t.id !== current.id
        && t.status !== "done"
        && (patch?.status !== "done" || t.id !== current.id),
    );
    if (next) {
      setSelectedTaskId(next.id);
      // Stay in call mode for the next call.
    } else {
      // Queue empty → exit cleanly.
      setSelectedTaskId(null);
      setCallMode("idle");
    }
  };

  const baseStart = useMemo(() => startOfWeek(now), [now]);
  const weekStart = useMemo(() => {
    const d = new Date(baseStart);
    d.setDate(d.getDate() + weekOffset * 7);
    return d;
  }, [baseStart, weekOffset]);

  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => {
      const d = new Date(weekStart);
      d.setDate(weekStart.getDate() + i);
      return d;
    }),
    [weekStart],
  );

  const tasksByDay = useMemo(() => {
    const map = {};
    let droppedNoAnchor = 0;
    for (const t of data) {
      const a = taskAnchorIso(t);
      if (!a) { droppedNoAnchor++; continue; }
      const k = dayKey(new Date(a));
      (map[k] ??= []).push(t);
    }
    for (const k of Object.keys(map)) {
      map[k] = rankTasks(map[k], now);
    }
    // ── Stage 5 diagnostic — gated by DEBUG_UI to keep the live demo
    // free of console-flood UI freezes.
    if (DEBUG_UI && typeof console !== "undefined") {
      try {
        const callOnly = {};
        for (const [k, list] of Object.entries(map)) {
          const calls = list.filter((t) => {
            const id = t?.id ?? ""; const title = t?.title ?? "";
            return id.endsWith("-call") || title.startsWith("Call ");
          });
          callOnly[k] = calls.length;
        }
        const expected = ["2026-05-07","2026-05-08","2026-05-11","2026-05-12","2026-05-13","2026-05-14"];
        const expectedVsActual = expected.map((d) => `${d}:exp20/act${callOnly[d] ?? 0}`).join(" ");
        // eslint-disable-next-line no-console
        console.log(
          `[stage5-tasksByDay] dataTotal=${data.length} droppedNoAnchor=${droppedNoAnchor} ` +
          `dayKeys=${Object.keys(map).length} ` +
          `callsByDay=${JSON.stringify(callOnly)} ` +
          `field-test=${expectedVsActual}`,
        );
      } catch { /* ignore */ }
    }
    return map;
  }, [data, now]);

  const weekLabel = `${weekStart.toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${days[6].toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;

  // First active day of the visible week — the column that should get
  // the "Day 1 · Start here" emphasis. Pure UI hint; no scheduling
  // logic is touched.
  //
  // Order of preference:
  //   1. The LaborTech demo anchor (May 7) when present in the visible
  //      week — even if that column has zero tasks today, we still want
  //      it visually flagged as Day 1 of the rollout.
  //   2. Otherwise the earliest day with tasks that isn't before today.
  const firstActiveDayKey = useMemo(() => {
    if (LABORTECH_DEMO_ANCHOR_ENABLED) {
      const anchorKey = laborTechDemoAnchorKey();
      for (const d of days) {
        if (dayKey(d) === anchorKey) return anchorKey;
      }
    }
    const todayKey = dayKey(now);
    for (const d of days) {
      const k = dayKey(d);
      if (k < todayKey) continue;
      const items = tasksByDay[k];
      if (Array.isArray(items) && items.length > 0) return k;
    }
    return null;
  }, [days, tasksByDay, now]);

  // View-aware navigation labels.
  const dayLabel = (() => {
    const d = new Date(now);
    d.setDate(d.getDate() + dayOffset);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  })();
  const monthLabel = (() => {
    const d = new Date(now);
    d.setDate(1);
    d.setMonth(d.getMonth() + monthOffset);
    return d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  })();
  const headerRangeLabel =
    calendarView === "day" ? dayLabel
      : calendarView === "month" ? monthLabel
      : weekLabel;
  const todayLabel =
    calendarView === "day" ? "Today"
      : calendarView === "month" ? "This Month"
      : "This Week";
  const isAtTodayRange =
    calendarView === "day" ? dayOffset === 0
      : calendarView === "month" ? monthOffset === 0
      : weekOffset === 0;
  const navPrev = () => {
    if (calendarView === "day") setDayOffset((o) => o - 1);
    else if (calendarView === "month") setMonthOffset((o) => o - 1);
    else setWeekOffset((o) => o - 1);
  };
  const navNext = () => {
    if (calendarView === "day") setDayOffset((o) => o + 1);
    else if (calendarView === "month") setMonthOffset((o) => o + 1);
    else setWeekOffset((o) => o + 1);
  };
  const navToday = () => {
    setDayOffset(0);
    setWeekOffset(0);
    setMonthOffset(0);
  };

  // Decision layer: single best Execute Now action + ranked allocation.
  // Memoized on the data + now so we don't recompute on unrelated state.
  const executeNow = useMemo(() => getExecuteNowDecision(data, { now }), [data, now]);
  const allocation = useMemo(() => rankCapitalAllocation(data, { now, topN: 3 }), [data, now]);
  // Operator-mode top 5: pure priority across every lead, regardless of
  // when the task is scheduled. Reuses canonical scoring.
  const operatorTop5 = useMemo(() => rankCapitalAllocation(data, { now, topN: 5 }), [data, now]);
  // Pipeline link counts — number of open tasks per lead. Powers the
  // small `↻ N` chip on the card so the operator sees that a calendar
  // item is one step in a multi-step deal.
  const pipelineLinkCount = useMemo(() => {
    const map = new Map();
    for (const t of data) {
      if (!t || t.status === "done") continue;
      const k = t.linkedLeadId;
      if (!k) continue;
      map.set(k, (map.get(k) ?? 0) + 1);
    }
    return map;
  }, [data]);
  const linkedCountFor = (task) => {
    const k = task?.linkedLeadId;
    if (!k) return 0;
    return pipelineLinkCount.get(k) ?? 0;
  };
  // Grid no longer paints the EXECUTE NOW glow — Right Now is the only
  // "this one" surface. Decision still drives Right Now via executeNow.

  if (typeof window !== "undefined" && process.env.NODE_ENV !== "production") {
    // Memoized log key — only fires when the decision actually changes.
    const allocIds = allocation.map((a) => a.task.id);
    const dupes = allocIds.filter((id, i) => allocIds.indexOf(id) !== i);
    const rightNowId = executeNow.task?.id ?? null;
    const nextMoveCandidates = (data ?? [])
      .filter((t) => t && t.status !== "done" && t.id !== rightNowId)
      .map((t, i) => ({ t, i }))
      .sort((a, b) => {
        const c = compareLeadTasks(a.t, b.t, { now });
        if (c !== 0) return c;
        return a.i - b.i;
      })
      .slice(0, 3)
      .map((p) => p.t.id);
    const overdueCount = data.filter((t) => isOverdue(t, now)).length;
    const followUpsCount = data.filter((t) => {
      if (t.category !== "followup" || t.status === "done") return false;
      if (!t.dueDate) return false;
      return new Date(t.dueDate).getTime() <= now.getTime() + 24 * 3_600_000;
    }).length;
    const revenueCount = data.filter((t) => (t.revenueImpact ?? 0) > 0 && t.status !== "done").length;
    const riskCount = data.filter((t) => t.riskIfMissed === "high" && t.status !== "done").length;
    const logKey = `${data.length}|${rightNowId ?? "none"}|${nextMoveCandidates.join(",")}|${insights?.[0]?.id ?? "none"}|${overdueCount},${followUpsCount},${revenueCount},${riskCount}`;
    if (logKey !== lastDevLogKey) {
      lastDevLogKey = logKey;
      console.debug("[ExecuteNow]", {
        totalTasks: data.length,
        executeNowTaskId: rightNowId,
        allocationTaskIds: allocIds,
        duplicateAllocationIds: dupes,
        rightNowTaskId: rightNowId,
        nextMoveIds: nextMoveCandidates,
        todaysEdgeId: insights?.[0]?.id ?? null,
        holdingAreaCounts: {
          overdue: overdueCount,
          followUps: followUpsCount,
          revenue: revenueCount,
          risks: riskCount,
        },
      });
    }
  }

  const Divider = () => (
    <span aria-hidden="true" style={{
      width: "1px",
      height: "20px",
      background: palette.border,
      opacity: 0.6,
      display: "inline-block",
      margin: "0 6px",
    }} />
  );

  return (
    <div style={{
      // Single page-scroll model — Today flows with the document.
      // No fixed height, no overflow trap. Sticky drawer + internal
      // panel scrolls handle the workflow side; the page handles
      // top-to-bottom navigation (controls → queue → calendar).
      width: "100%",
      minHeight: "560px",
      display: "flex",
      flexDirection: "column",
      overflowX: "hidden",
      overflowY: "visible",
    }}>
      <div style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: "12px",
        padding: "20px 24px 0",
        gap: "16px",
        flexWrap: "wrap",
        flexShrink: 0,
      }}>
        {/* Left group: title + (optional wrap) trade pills. Wraps as a unit. */}
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: "12px",
          flexWrap: "wrap",
          flex: "1 1 auto",
          minWidth: 0,
        }}>
          <div style={{
            display: "flex",
            flexDirection: "column",
            flex: "0 0 auto",
            minWidth: "180px",
          }}>
            <div style={{ fontSize: "18px", fontWeight: 700, color: palette.textPrimary, lineHeight: 1.2 }}>
              Operator
            </div>
            <div style={{ fontSize: "12px", color: palette.textSecondary, marginTop: "1px" }}>
              {headerRangeLabel} · {data.length} in queue
            </div>
          </div>
          {tradeSlot ? (
            <>
              <Divider />
              <div style={{
                display: "flex",
                flex: "1 1 auto",
                minWidth: 0,
                flexWrap: "wrap",
                alignItems: "center",
                gap: "6px",
              }}>
                {tradeSlot}
                {selectedServiceAngleId && selectedServiceAngleLabel && (
                  <button
                    type="button"
                    onClick={onClearServiceAngle}
                    aria-label={`Clear angle filter ${selectedServiceAngleLabel}`}
                    title="Clear angle filter"
                    style={{
                      fontSize: "11px",
                      fontWeight: 600,
                      padding: "4px 10px",
                      borderRadius: "999px",
                      cursor: "pointer",
                      color: palette.blue,
                      background: palette.bluePale,
                      border: `1px solid ${palette.blueBorder}`,
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "6px",
                      whiteSpace: "nowrap",
                    }}
                  >
                    Angle: {selectedServiceAngleLabel}
                    <span aria-hidden="true" style={{ fontSize: "13px", lineHeight: 1 }}>×</span>
                  </button>
                )}
              </div>
            </>
          ) : null}
        </div>

        {/* CALENDAR CONTROL BAR — three zones: View Mode | Time Scale |
            Navigation. Help "?" sits before the first zone as its own
            quiet affordance. Each zone is a self-contained cluster
            separated by ~20px of breathing room + a hairline divider
            so the user reads the bar as structured navigation, not a
            row of buttons. */}
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: "20px",
          flex: "0 0 auto",
        }}>
          {/* Help affordance — separate from the navigation zones. */}
          <button
            type="button"
            onClick={() => setGuidanceOpen(true)}
            aria-label="How to use"
            title="How to use"
            onMouseEnter={(e) => { e.currentTarget.style.background = palette.surfaceHover; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = guidanceDismissed ? "transparent" : palette.bluePale; }}
            onFocus={applyFocusRing}
            onBlur={clearFocusRing}
            style={{
              width: "28px",
              height: "28px",
              fontSize: "12px",
              fontWeight: 600,
              color: guidanceDismissed ? palette.textTertiary : palette.blue,
              background: guidanceDismissed ? "transparent" : palette.bluePale,
              border: `1px solid ${guidanceDismissed ? "rgba(15,23,42,0.08)" : palette.blueBorder}`,
              borderRadius: "999px",
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              transition: EASE,
            }}
          >
            ?
          </button>

          {/* ZONE 1 — View Mode (Calendar / Priority) */}
          <div style={{ display: "inline-flex", alignItems: "center" }}>
            <ModeSegmented value={layoutMode} onChange={setLayoutMode} />
          </div>

          {/* Divider */}
          {layoutMode === "calendar" ? (
            <span aria-hidden="true" style={{
              width: "1px",
              height: "22px",
              background: "rgba(15,23,42,0.08)",
            }} />
          ) : null}

          {/* ZONE 2 — Time Scale (Day / Week / Month) */}
          {layoutMode === "calendar" && (
            <div style={{ display: "inline-flex", alignItems: "center" }}>
              <ViewSegmented value={calendarView} onChange={setCalendarView} />
            </div>
          )}

          {/* Divider */}
          <span aria-hidden="true" style={{
            width: "1px",
            height: "22px",
            background: "rgba(15,23,42,0.08)",
          }} />

          {/* ZONE 3 — Navigation (← · range label · →) */}
          <div style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "8px",
          }}>
            <button
              onClick={navPrev}
              style={navIconBtn}
              aria-label="Previous"
              title="Previous"
              onMouseEnter={(e) => { e.currentTarget.style.background = palette.surfaceHover; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
              onFocus={applyFocusRing}
              onBlur={clearFocusRing}
            >
              ←
            </button>

            {/* Range label — reads as a label, not a button. Clickable
                for "jump to today" but visually quiet. Shows the date
                range alongside "This Week" so the user always knows
                what window they're looking at. */}
            <button
              onClick={navToday}
              onMouseEnter={(e) => { e.currentTarget.style.background = isAtTodayRange ? palette.surfaceHover : "transparent"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
              onFocus={applyFocusRing}
              onBlur={clearFocusRing}
              title={isAtTodayRange ? "Currently viewing this range" : "Jump to today"}
              style={{
                fontSize: "13px",
                fontWeight: isAtTodayRange ? 700 : 500,
                color: isAtTodayRange ? palette.textPrimary : palette.textSecondary,
                background: "transparent",
                border: "none",
                borderRadius: "8px",
                padding: "4px 10px",
                cursor: "pointer",
                whiteSpace: "nowrap",
                letterSpacing: "0.01em",
                transition: EASE,
                lineHeight: 1.3,
              }}
            >
              {todayLabel}
              {calendarView === "week" ? (
                <span style={{
                  marginLeft: "8px",
                  fontSize: "12px",
                  fontWeight: 500,
                  color: palette.textTertiary,
                  letterSpacing: "0",
                }}>
                  {weekLabel}
                </span>
              ) : null}
            </button>

            <button
              onClick={navNext}
              style={navIconBtn}
              aria-label="Next"
              title="Next"
              onMouseEnter={(e) => { e.currentTarget.style.background = palette.surfaceHover; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
              onFocus={applyFocusRing}
              onBlur={clearFocusRing}
            >
              →
            </button>
          </div>
        </div>
      </div>

      <HowToUseOverlay open={guidanceOpen} onClose={handleCloseGuidance} />

      {/* Today layout — single vertical flow.
            • Top: trust strip + execution plan (full width).
            • Middle: calendar (full width, primary workspace).
            • Lead detail: opens as a right slide-over only when the
              user clicks an execution item or calendar card.
            • Assistant: floating button, expands only on click.
          No permanent side panels, no fixed columns. The whole page
          reads as one flow the user moves through. */}
      {/* TODAY ROOT — flows with the page. No fixed height, no
          overflow trap. Sections sit naturally; user scrolls the
          document to reach the secondary calendar below the queue. */}
      <div style={{
        display: "flex",
        flexDirection: "column",
        gap: "20px",
        padding: "4px 32px 28px",
      }}>
        {/* TOP: trust strip + execution plan (full width). */}
        <div style={{
          flex: "0 0 auto",
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
          gap: "10px",
        }}>
          {/* Top-of-Today Execution Plan — top 5 leads by closeability,
              with one-tap Call / Email and the contact strategy chip
              inline. Shown only in week-view calendar mode where the
              user lands on Today; suppressed in priority view (which
              already is its own top-5 list) and in day/month views. */}
          {layoutMode !== "operator" && calendarView === "week" && hasTradeLeads ? (() => {
            const executionPlan = (() => {
              if (!Array.isArray(data) || data.length === 0) return [];
              const dayOneKey = LABORTECH_DEMO_ANCHOR_ENABLED ? laborTechDemoAnchorKey() : null;
              const pool = data.filter((t) => {
                if (!t || t.status === "done") return false;
                const id = t.id ?? "";
                const title = t.title ?? "";
                const isCall = id.endsWith("-call") || title.startsWith("Call ");
                if (!isCall) return false;
                if (dayOneKey) {
                  const a = taskAnchorIso(t);
                  if (!a) return false;
                  return dayKey(new Date(a)) === dayOneKey;
                }
                return true;
              });
              pool.sort((a, b) => {
                const sa = a?.laborTechScan?.closeability?.score ?? 0;
                const sb = b?.laborTechScan?.closeability?.score ?? 0;
                return sb - sa;
              });
              // Show ALL leads scheduled for today — Today is a routing
              // queue now, not a top-5 highlights strip.
              return pool;
            })();
            if (executionPlan.length === 0) return null;
            return (
              <>
                {/* Trust strip — answers "why is this better than other
                    tools?" in one line, plus a quiet expectation-setter
                    so email hit-rate is never the metric the user
                    judges the system on. Rendered once, only here. */}
                <div
                  role="note"
                  aria-label="Plan rationale"
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: "12px",
                    alignItems: "baseline",
                    justifyContent: "space-between",
                    padding: "10px 14px",
                    marginBottom: "10px",
                    borderRadius: "10px",
                    background: palette.surface,
                    border: `1px solid ${palette.borderLight}`,
                    fontSize: "11.5px",
                    lineHeight: 1.4,
                  }}
                >
                  <span style={{ color: palette.textPrimary, fontWeight: 600 }}>
                    This plan is based on urgency and closeability — not just raw data.
                  </span>
                  <span style={{ color: palette.textTertiary, fontStyle: "italic" }}>
                    Email is available for a subset of leads — phone remains the primary channel.
                  </span>
                </div>
                <TodayExecutionPlan
                  tasks={executionPlan}
                  onSelectTask={handleSelectTask}
                  onOpenAssist={handleOpenAssist}
                  leadByKey={null}
                />
                <FieldTestDiagnosticsPanel tasksByDay={tasksByDay} dataTotal={data.length} />
              </>
            );
          })() : null}
        </div>

        {/* MAIN WORKSPACE — flex ROW. Calendar lives on the left and
            stays clickable at all times. When a lead is selected,
            the operator panel + (optional) deep report + assistant
            join inline on the right. The calendar compresses but
            never disables — clicking another card swaps the lead in
            place so the user works through the call queue without
            modal-style "open / close" friction. */}
        {/* WORKSPACE SHELL — single explicit four-column grid.
            Workspace + Operator + Deep Report + Assistant all live
            as direct children of this grid (the drawer returns a
            React fragment so its panels are siblings of the
            calendar column, not nested in a sub-grid).
            Templates:
              No lead:  1fr
              Closed:   minmax(520, 1fr) 380 320
              Deep:     minmax(360, 1fr) 340 420 64
            Single 12px gap, single source of truth. */}
        <div style={{
          minWidth: 0,
          display: "grid",
          gridTemplateColumns: !selectedTask
            ? SHELL_GRID.noLead
            : (deepReportOpen ? SHELL_GRID.deep : SHELL_GRID.closed),
          gap: WORKFLOW.shellGap,
          alignItems: "start",
          transition: WORKFLOW.shellTransition,
        }}>
        {/* CALENDAR COLUMN — secondary section, flows with the page.
            No max-height, no overflow trap. The weekly grid below
            sits in normal document flow; horizontal scroll lives on
            the inner grid only when the viewport is narrow. */}
        <div style={{
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
          gap: "10px",
          paddingBottom: "20px",
          borderBottom: "1px solid rgba(15, 23, 42, 0.08)",
        }}>
          <div style={{
            fontSize: "10px", fontWeight: 700, letterSpacing: "0.10em",
            color: palette.textTertiary, textTransform: "uppercase",
            paddingBottom: "2px",
          }}>
            {layoutMode === "operator"
              ? "Priority view · top 5 actions to work now"
              : calendarView === "day" ? "Today's call plan"
              : calendarView === "month" ? "This month at a glance"
              : LABORTECH_DEMO_ANCHOR_ENABLED && isLaunchDayOrBefore()
                ? `LaborTech launch call plan · Day 1 starts ${laborTechDemoAnchorLabel()}`
                : `This week's call plan · Week of ${formatWeekStartLabel(getWeekStartIso())}`}
          </div>

          {!hasTradeLeads ? (
            <div style={{
              padding: "32px 24px",
              borderRadius: R.md,
              background: palette.surface,
              borderTop: `1px solid ${palette.borderLight}`,
              borderRight: `1px solid ${palette.borderLight}`,
              borderBottom: `1px solid ${palette.borderLight}`,
              borderLeft: `1px solid ${palette.borderLight}`,
              boxShadow: SH.sm,
              fontSize: "12px",
              color: palette.textSecondary,
              lineHeight: 1.5,
            }}>
              <div style={{ fontWeight: 600, color: palette.textPrimary, marginBottom: "4px" }}>
                {viewMode === "all"
                  ? "No LaborTech leads connected yet."
                  : `No ${tradeLabel ?? "trade"} leads connected yet.`}
              </div>
              <div>
                {viewMode === "all"
                  ? "Connect a source or import companies to activate the workspace."
                  : `Connect a source or import ${tradeLabel ?? "trade"} companies to activate this trade.`}
              </div>
              {tradeReadiness?.missingEnvVars?.length ? (
                <div style={{ fontSize: "11px", color: palette.textTertiary, marginTop: "8px" }}>
                  Connect <code style={{
                    fontFamily: "ui-monospace, SFMono-Regular, monospace",
                    fontSize: "11px",
                    background: palette.surfaceHover,
                    padding: "1px 5px",
                    borderRadius: R.xs,
                  }}>{tradeReadiness.missingEnvVars[0]}</code> to activate automated sourcing.
                </div>
              ) : null}
            </div>
          ) : layoutMode === "operator" ? (
            <OperatorView
              ranked={operatorTop5}
              now={now}
              selectedTaskId={selectedTaskId}
              onSelectTask={handleSelectTask}
              onTaskFeedback={onTaskFeedback}
              linkedCountFor={linkedCountFor}
            />
          ) : calendarView === "day" ? (
            (() => {
              const day = (() => {
                const d = new Date(now);
                d.setDate(d.getDate() + dayOffset);
                d.setHours(0, 0, 0, 0);
                return d;
              })();
              const k = dayKey(day);
              const items = tasksByDay[k] ?? [];
              const isTodayCol = k === dayKey(now);
              const isDayOneCol = LABORTECH_DEMO_ANCHOR_ENABLED && k === laborTechDemoAnchorKey();
              const isPreLaunchCol =
                LABORTECH_DEMO_ANCHOR_ENABLED
                && k < laborTechDemoAnchorKey()
                && !isDayOneCol;
              return (
                <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "16px" }}>
                  <DayColumn
                    date={day}
                    tasks={items}
                    isToday={isTodayCol}
                    now={now}
                    onTaskFeedback={onTaskFeedback}
                    selectedTaskId={selectedTaskId}
                    onSelectTask={handleSelectTask}
                    linkedCountFor={linkedCountFor}
                    viewMode={viewMode}
                    isFirstActive={isDayOneCol || (isTodayCol && items.length > 0)}
                    isPreLaunch={isPreLaunchCol}
                  />
                </div>
              );
            })()
          ) : calendarView === "month" ? (
            <MonthGrid
              monthOffset={monthOffset}
              now={now}
              tasks={data}
              selectedTaskId={selectedTaskId}
              onSelectTask={handleSelectTask}
              linkedCountFor={linkedCountFor}
            />
          ) : (
            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(7, minmax(200px, 1fr))",
              gap: "20px",
              // Calendar grid body — vertical flow ONLY (page handles
              // vertical scroll). Horizontal scroll stays here for
              // narrow viewports so the seven-day layout doesn't
              // force page-level horizontal scroll.
              width: "100%",
              overflowX: "auto",
              overflowY: "visible",
              paddingBottom: "20px",
              backgroundImage: "linear-gradient(to bottom, transparent calc(100% - 28px), rgba(15,23,42,0.02))",
            }}>
              {days.map((d) => {
                const k = dayKey(d);
                const items = tasksByDay[k] ?? [];
                const today = k === dayKey(now);
                const isFirstActive = firstActiveDayKey != null && k === firstActiveDayKey;
                // Pre-launch = any day before the demo Day-1 anchor
                // (May 7). Visually deprioritized so the eye skips them
                // and lands on Day 1. Pure presentational flag — the
                // column still renders normally if the user navigates
                // to it; we just fade it.
                const isPreLaunch =
                  LABORTECH_DEMO_ANCHOR_ENABLED
                  && k < laborTechDemoAnchorKey()
                  && !isFirstActive;
                return (
                  <DayColumn
                    key={k}
                    date={d}
                    tasks={items}
                    isToday={today}
                    now={now}
                    onTaskFeedback={onTaskFeedback}
                    selectedTaskId={selectedTaskId}
                    onSelectTask={handleSelectTask}
                    linkedCountFor={linkedCountFor}
                    viewMode={viewMode}
                    isFirstActive={isFirstActive}
                    isPreLaunch={isPreLaunch}
                  />
                );
              })}
            </div>
          )}
        </div>
        {/* WORKFLOW DRAWER — single shared component used by both
            Today and All Leads. The drawer hosts Operator + Deep
            Report + Assistant internally; opening Deep Report
            reorganizes the drawer's INTERNAL layout but the drawer's
            outer width stays stable, so the calendar workspace is
            never pushed further off-screen when the user dives deeper. */}
        <LeadWorkflowDrawer
          selectedTask={selectedTask}
          deepReportOpen={deepReportOpen}
          onDeepReportClose={() => setDeepReportOpen(false)}
          assistantCollapsed={assistantCollapsed}
          onToggleAssistant={handleToggleAssistant}
          tradeLabel={tradeLabel}
          operatorPanel={(
            <SelectedLeadPanel
              task={selectedTask}
              now={now}
              tradeLabel={tradeLabel}
              onClose={handleClearSelectedTask}
              onMutate={handleTaskMutation}
              onOpen={(t) => {
                if (typeof onTaskFeedback === "function") {
                  onTaskFeedback(t, "promote_task", "Operator opened lead from calendar");
                }
              }}
              callMode={callMode}
              onEnterCallMode={enterCallMode}
              onExitCallMode={exitCallMode}
              onRecordOutcome={recordOutcomeAndAdvance}
              callsCompletedToday={callsCompletedToday}
              queueRemaining={callQueue.length}
              currentNote={notesByTaskId[selectedTask?.id] ?? ""}
              onChangeNote={(text) => selectedTask?.id && setNoteForTask(selectedTask.id, text)}
              onSwitchTab={onSwitchTab}
              selectedLead={selectedLead}
              onLeadUpdate={onLeadUpdate}
              hunterAvailable={hunterAvailable}
              onOpenDeepReport={() => setDeepReportOpen(true)}
            />
          )}
        />
        </div>
      </div>

    </div>
  );
}

// ── Operator view ─────────────────────────────────────────────────────
// Priority-ranked top 5 actions across every lead. Reuses the canonical
// rankCapitalAllocation scorer so this surface stays aligned with Right
// Now and Capital Allocation. Cards click into the same SelectedLead
// flow as the calendar.

function OperatorView({ ranked, now, selectedTaskId, onSelectTask, onTaskFeedback, linkedCountFor }) {
  if (!Array.isArray(ranked) || ranked.length === 0) {
    return (
      <div style={{
        padding: "20px 18px",
        borderRadius: R.md,
        background: palette.surface,
        borderTop: `1px solid ${palette.borderLight}`,
        borderRight: `1px solid ${palette.borderLight}`,
        borderBottom: `1px solid ${palette.borderLight}`,
        borderLeft: `1px solid ${palette.borderLight}`,
        boxShadow: SH.sm,
        fontSize: "12px",
        color: palette.textSecondary,
      }}>
        No ranked actions in the queue.
      </div>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
      {ranked.map((row, i) => {
        const t = row.task;
        return (
          <div key={t.id} style={{ display: "grid", gridTemplateColumns: "28px 1fr", gap: "12px", alignItems: "center" }}>
            <div style={{
              fontSize: "20px", fontWeight: 800, color: i === 0 ? palette.blue : palette.textTertiary,
              textAlign: "center", letterSpacing: "0.02em",
            }}>
              {i + 1}
            </div>
            <TaskCard
              task={t}
              now={now}
              isExecuteNow={i === 0}
              onTaskFeedback={onTaskFeedback}
              isSelected={selectedTaskId === t.id}
              onSelect={onSelectTask}
              pipelineLinkedCount={typeof linkedCountFor === "function" ? linkedCountFor(t) : 0}
            />
          </div>
        );
      })}
    </div>
  );
}

// ── Month grid ────────────────────────────────────────────────────────
// Calm, glanceable monthly overview. Each cell shows the date, a
// task count, up to two task titles, and a muted overflow string.
// Never competes with Right Now — strictly secondary.

function MonthGrid({ monthOffset, now, tasks, selectedTaskId, onSelectTask, linkedCountFor }) {
  const { firstDay, gridStart, gridEnd } = useMemo(() => {
    const base = new Date(now);
    base.setDate(1);
    base.setMonth(base.getMonth() + monthOffset);
    base.setHours(0, 0, 0, 0);
    const firstDay = new Date(base);
    const lastDay = new Date(base);
    lastDay.setMonth(lastDay.getMonth() + 1);
    lastDay.setDate(0);
    // Pad to start of week (Sunday) and end of week (Saturday).
    const gridStart = new Date(firstDay);
    gridStart.setDate(firstDay.getDate() - firstDay.getDay());
    const gridEnd = new Date(lastDay);
    gridEnd.setDate(lastDay.getDate() + (6 - lastDay.getDay()));
    return { firstDay, gridStart, gridEnd };
  }, [monthOffset, now]);

  const allDays = useMemo(() => {
    const out = [];
    const cursor = new Date(gridStart);
    while (cursor.getTime() <= gridEnd.getTime()) {
      out.push(new Date(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
    return out;
  }, [gridStart, gridEnd]);

  const tasksByDay = useMemo(() => {
    const map = {};
    for (const t of tasks ?? []) {
      const a = taskAnchorIso(t);
      if (!a) continue;
      const k = dayKey(new Date(a));
      (map[k] ??= []).push(t);
    }
    return map;
  }, [tasks]);

  return (
    <div>
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(7, 1fr)",
        gap: "4px",
        marginBottom: "6px",
      }}>
        {DAY_SHORT.map((d) => (
          <div key={d} style={{
            fontSize: "10px", fontWeight: 600, letterSpacing: "0.08em",
            color: palette.textTertiary, textTransform: "uppercase",
            padding: "0 6px",
          }}>
            {d}
          </div>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: "4px" }}>
        {allDays.map((d) => {
          const k = dayKey(d);
          const items = (tasksByDay[k] ?? []);
          const isCurMonth = d.getMonth() === firstDay.getMonth();
          const today = k === dayKey(now);
          const top = items.slice(0, 2);
          const overflow = items.length - top.length;
          return (
            <div key={k} style={{
              minHeight: "78px",
              padding: "6px 8px",
              borderRadius: R.sm,
              background: today ? "rgba(37,99,235,0.025)" : palette.surface,
              borderTop: `1px solid ${palette.borderLight}`,
              borderRight: `1px solid ${palette.borderLight}`,
              borderBottom: `1px solid ${palette.borderLight}`,
              borderLeft: `1px solid ${palette.borderLight}`,
              opacity: isCurMonth ? 1 : 0.45,
              display: "flex",
              flexDirection: "column",
              gap: "3px",
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <span style={{
                  fontSize: "12px",
                  fontWeight: today ? 700 : 500,
                  color: today ? palette.blue : palette.textSecondary,
                }}>
                  {d.getDate()}
                </span>
                {items.length > 0 && (
                  <span style={{ fontSize: "10px", color: palette.textTertiary }}>{items.length}</span>
                )}
              </div>
              {top.map((t) => {
                const sel = selectedTaskId === t.id;
                const linkN = typeof linkedCountFor === "function" ? linkedCountFor(t) : 0;
                const blocked = isTaskBlocked(t);
                const callNow = isCallNowTask(t);
                return (
                  <div
                    key={t.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => onSelectTask?.(t)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onSelectTask?.(t);
                      }
                    }}
                    title={t.title}
                    style={{
                      fontSize: "10px",
                      color: blocked ? palette.danger : callNow ? palette.blue : palette.textSecondary,
                      fontWeight: sel ? 700 : callNow || blocked ? 600 : 500,
                      lineHeight: 1.3,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      cursor: "pointer",
                      background: sel ? palette.bluePale : "transparent",
                      borderRadius: R.xs,
                      padding: sel ? "1px 4px" : "1px 0",
                    }}
                  >
                    {blocked ? "⚠ " : callNow ? "● " : ""}{t.title}{linkN > 1 ? ` ↻${linkN}` : ""}
                  </div>
                );
              })}
              {overflow > 0 && (
                <div style={{ fontSize: "10px", color: palette.textTertiary }}>
                  +{overflow} more
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Single ghost button language for header controls. Hover lifts the
// background to surfaceHover. Filled primary is reserved for Mark Done.
const btnGhost = {
  padding: "6px 12px",
  fontSize: "12px",
  fontWeight: 500,
  color: palette.textSecondary,
  background: "transparent",
  borderTop: `1px solid ${palette.borderLight}`,
  borderRight: `1px solid ${palette.borderLight}`,
  borderBottom: `1px solid ${palette.borderLight}`,
  borderLeft: `1px solid ${palette.borderLight}`,
  borderRadius: R.xs + 2,
  cursor: "pointer",
  transition: EASE,
};

// Quiet square icon button — used for prev/next chevrons in the
// navigation zone. Same dimensions as the help "?" so the bar reads
// as a row of consistent affordances. No outer border; relies on
// hover background to signal interactivity.
const navIconBtn = {
  width: "28px",
  height: "28px",
  fontSize: "14px",
  fontWeight: 600,
  color: palette.textSecondary,
  background: "transparent",
  border: "none",
  borderRadius: "8px",
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  lineHeight: 1,
  transition: EASE,
};

const btnPrimaryActive = {
  padding: "6px 12px",
  fontSize: "12px",
  fontWeight: 600,
  color: palette.textPrimary,
  background: palette.surfaceHover,
  borderTop: `1px solid ${palette.border}`,
  borderRight: `1px solid ${palette.border}`,
  borderBottom: `1px solid ${palette.border}`,
  borderLeft: `1px solid ${palette.border}`,
  borderRadius: R.xs + 2,
  cursor: "pointer",
  transition: EASE,
};
