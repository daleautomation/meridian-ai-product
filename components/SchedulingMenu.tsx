"use client";

// Meridian — Per-lead scheduling action menu.
//
// Compact dropdown attached to a lead row. Six operator actions:
//   • Move to Today
//   • Move to Tomorrow
//   • Move to Next Week
//   • Mark Follow-Up
//   • Skip / Revisit Later
//   • Assign Rep (rep submenu)
//
// Each click optimistically signals the action ("Moving…"), POSTs to
// /api/scheduling/override, then triggers a soft router.refresh()
// so the SSR-merged lead list reflects the new placement. No full
// page reload, no client-side bucket arithmetic — the server is the
// source of truth and the snapshot fast-path keeps the round-trip
// under ~150ms.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Action =
  | "move_today"
  | "move_tomorrow"
  | "move_next_week"
  | "move_to_date"
  | "follow_up"
  | "skip"
  | "assign_rep"
  | "clear";

interface Rep {
  id: string;
  name: string;
}

interface Props {
  leadId: string;
  workspaceSlug: string;
  companyKey?: string | null;
  crmKey?: string | null;
  leadName?: string;
  reps?: Rep[];
  /** Visible on lead rows that already have an override applied so
   *  the operator can revert. */
  hasOverride?: boolean;
  /** Render style — "icon" for tight rows, "button" for spacious areas. */
  variant?: "icon" | "button";
}

const palette = {
  trigger: "#475569",
  triggerHover: "#1A1A2E",
  border: "#E2E8F0",
  surface: "#FFFFFF",
  surfaceHover: "#F8FAFC",
  text: "#1A1A2E",
  textMuted: "#64748B",
  divider: "#F1F5F9",
  destructive: "#B91C1C",
  accent: "#2563EB",
  accentMuted: "#EFF6FF",
};

const PRIMARY_ITEMS: Array<{ action: Action; label: string; hint: string }> = [
  { action: "move_today", label: "Move to Today", hint: "Top of today's queue" },
  { action: "move_tomorrow", label: "Move to Tomorrow", hint: "Next working day" },
  { action: "move_next_week", label: "Move to Next Week", hint: "Next Monday" },
];

const SECONDARY_ITEMS: Array<{ action: Action; label: string; hint: string }> = [
  { action: "follow_up", label: "Mark Follow-Up", hint: "Out of main queue, retains context" },
  { action: "skip", label: "Skip / Revisit Later", hint: "Drops to bottom of pipeline" },
];

// Weekday quick picks. Numbers map to JS getDay(): 1=Mon … 5=Fri.
// Today's weekday is hidden — operators use "Move to Today" instead.
const WEEKDAYS: Array<{ id: number; label: string; short: string }> = [
  { id: 1, label: "Monday", short: "Mon" },
  { id: 2, label: "Tuesday", short: "Tue" },
  { id: 3, label: "Wednesday", short: "Wed" },
  { id: 4, label: "Thursday", short: "Thu" },
  { id: 5, label: "Friday", short: "Fri" },
];

function nextWeekdayIso(targetDow: number, now: Date = new Date()): string {
  const t = new Date(now);
  let delta = targetDow - t.getDay();
  if (delta <= 0) delta += 7;
  t.setDate(t.getDate() + delta);
  const y = t.getFullYear();
  const m = String(t.getMonth() + 1).padStart(2, "0");
  const d = String(t.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function todayIsoLocal(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function isWeekdayInFuture(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return false;
  const dow = parsed.getDay();
  if (dow === 0 || dow === 6) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return parsed.getTime() >= today.getTime();
}

export default function SchedulingMenu({
  leadId,
  workspaceSlug,
  companyKey = null,
  crmKey = null,
  leadName,
  reps,
  hasOverride,
  variant = "icon",
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<Action | null>(null);
  const [showReps, setShowReps] = useState(false);
  const [showDateInput, setShowDateInput] = useState(false);
  const [dateInputValue, setDateInputValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Close on outside click + Escape — the menu must never trap focus.
  useEffect(() => {
    if (!open) return undefined;
    function onDoc(e: MouseEvent) {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setShowReps(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        setShowReps(false);
      }
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function send(action: Action, opts?: { repId?: string; scheduledFor?: string }) {
    if (pending) return;
    setPending(action);
    setError(null);
    try {
      const payload: Record<string, unknown> = { leadId, workspaceSlug, action, companyKey, crmKey };
      if (action === "assign_rep" && opts?.repId) payload.repId = opts.repId;
      if (action === "move_to_date" && opts?.scheduledFor) payload.scheduledFor = opts.scheduledFor;
      const res = await fetch("/api/scheduling/override", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      router.refresh();
      setTimeout(() => {
        setPending(null);
        setOpen(false);
        setShowReps(false);
        setShowDateInput(false);
        setDateInputValue("");
      }, 350);
    } catch (e) {
      setError(e instanceof Error ? e.message : "request failed");
      setPending(null);
    }
  }

  const triggerStyle: React.CSSProperties = variant === "icon"
    ? {
        padding: "4px 8px",
        fontSize: "11px",
        fontWeight: 500,
        background: hasOverride ? palette.accentMuted : palette.surface,
        color: hasOverride ? palette.accent : palette.trigger,
        border: `1px solid ${hasOverride ? palette.accent : palette.border}`,
        borderRadius: "6px",
        cursor: "pointer",
        userSelect: "none",
      }
    : {
        padding: "6px 12px",
        fontSize: "12px",
        fontWeight: 500,
        background: hasOverride ? palette.accentMuted : palette.surface,
        color: hasOverride ? palette.accent : palette.text,
        border: `1px solid ${hasOverride ? palette.accent : palette.border}`,
        borderRadius: "7px",
        cursor: "pointer",
        userSelect: "none",
      };

  return (
    <div ref={containerRef} style={{ position: "relative", display: "inline-block" }}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        title={leadName ? `Schedule actions for ${leadName}` : "Schedule actions"}
        style={triggerStyle}
      >
        {pending ? "…" : hasOverride ? "Scheduled ▾" : "Schedule ▾"}
      </button>

      {open ? (
        <div
          role="menu"
          onClick={(e) => e.stopPropagation()}
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            right: 0,
            minWidth: "240px",
            background: palette.surface,
            border: `1px solid ${palette.border}`,
            borderRadius: "10px",
            boxShadow: "0 10px 30px rgba(15,23,42,0.10), 0 4px 8px rgba(15,23,42,0.06)",
            padding: "6px",
            // Operator-side modals and drawers sit at z=1000+; the
            // dropdown sits just below those so a stacked modal can
            // still take precedence, but it never gets clipped by
            // calendar cards or rail panels (typical z<=20).
            zIndex: 200,
          }}
        >
          {showReps && reps && reps.length > 0 ? (
            <>
              <MenuHeader label="Assign operator" onBack={() => setShowReps(false)} />
              {reps.map((r) => (
                <MenuItem
                  key={r.id}
                  label={r.name}
                  hint={`Assign ${r.name}`}
                  pending={pending === "assign_rep"}
                  onClick={() => send("assign_rep", { repId: r.id })}
                />
              ))}
            </>
          ) : showDateInput ? (
            <>
              <MenuHeader
                label="Schedule for date"
                onBack={() => {
                  setShowDateInput(false);
                  setDateInputValue("");
                }}
              />
              <div style={{ padding: "6px 10px 4px" }}>
                <input
                  type="date"
                  value={dateInputValue}
                  min={todayIsoLocal()}
                  onChange={(e) => setDateInputValue(e.target.value)}
                  aria-label="Pick a weekday date"
                  style={{
                    width: "100%",
                    padding: "6px 8px",
                    fontSize: "12px",
                    color: palette.text,
                    border: `1px solid ${palette.border}`,
                    borderRadius: "6px",
                    fontFamily: "inherit",
                  }}
                />
                {dateInputValue && !isWeekdayInFuture(dateInputValue) ? (
                  <div style={{ marginTop: "6px", fontSize: "10px", color: palette.destructive }}>
                    Pick a weekday today or later. Weekends aren&rsquo;t valid call days.
                  </div>
                ) : null}
                <button
                  type="button"
                  disabled={!isWeekdayInFuture(dateInputValue) || pending === "move_to_date"}
                  onClick={() => send("move_to_date", { scheduledFor: dateInputValue })}
                  style={{
                    marginTop: "8px",
                    width: "100%",
                    padding: "7px 10px",
                    fontSize: "12px",
                    fontWeight: 600,
                    background: isWeekdayInFuture(dateInputValue) ? palette.accent : palette.divider,
                    color: isWeekdayInFuture(dateInputValue) ? "#FFFFFF" : palette.textMuted,
                    border: "none",
                    borderRadius: "6px",
                    cursor: isWeekdayInFuture(dateInputValue) ? "pointer" : "not-allowed",
                  }}
                >
                  {pending === "move_to_date" ? "Scheduling…" : "Schedule for this date"}
                </button>
              </div>
            </>
          ) : (
            <>
              <SectionLabel>Schedule</SectionLabel>
              {PRIMARY_ITEMS.map((it) => (
                <MenuItem
                  key={it.action}
                  label={it.label}
                  hint={it.hint}
                  pending={pending === it.action}
                  onClick={() => send(it.action)}
                />
              ))}
              <SectionLabel>This week</SectionLabel>
              <div
                style={{
                  display: "flex",
                  gap: "4px",
                  padding: "4px 6px 6px",
                  flexWrap: "wrap",
                }}
              >
                {WEEKDAYS.map((d) => {
                  const iso = nextWeekdayIso(d.id);
                  const isPending = pending === "move_to_date";
                  return (
                    <button
                      key={d.id}
                      type="button"
                      onClick={() => send("move_to_date", { scheduledFor: iso })}
                      disabled={isPending}
                      title={`Move to ${d.label} (${iso})`}
                      style={{
                        flex: 1,
                        minWidth: "40px",
                        padding: "5px 8px",
                        fontSize: "11px",
                        fontWeight: 500,
                        background: palette.surfaceHover,
                        color: palette.text,
                        border: `1px solid ${palette.border}`,
                        borderRadius: "5px",
                        cursor: isPending ? "wait" : "pointer",
                      }}
                    >
                      {d.short}
                    </button>
                  );
                })}
              </div>
              <MenuItem
                label="Pick a specific date…"
                hint="Schedule for any future weekday"
                onClick={() => setShowDateInput(true)}
                chevron
              />
              <Divider />
              <SectionLabel>State</SectionLabel>
              {SECONDARY_ITEMS.map((it) => (
                <MenuItem
                  key={it.action}
                  label={it.label}
                  hint={it.hint}
                  pending={pending === it.action}
                  onClick={() => send(it.action)}
                />
              ))}
              {reps && reps.length > 0 ? (
                <>
                  <Divider />
                  <SectionLabel>Assignment</SectionLabel>
                  <MenuItem
                    label="Assign operator…"
                    hint={`${reps.length} operator${reps.length === 1 ? "" : "s"} available`}
                    onClick={() => setShowReps(true)}
                    chevron
                  />
                </>
              ) : null}
              {hasOverride ? (
                <>
                  <Divider />
                  <MenuItem
                    label="Clear scheduling override"
                    hint="Restore the engine's scored placement"
                    pending={pending === "clear"}
                    onClick={() => send("clear")}
                    destructive
                  />
                </>
              ) : null}
            </>
          )}
          {error ? (
            <div
              role="alert"
              style={{
                marginTop: "6px",
                padding: "6px 8px",
                fontSize: "11px",
                color: palette.destructive,
                background: "#FEF2F2",
                border: "1px solid #FCA5A5",
                borderRadius: "6px",
              }}
            >
              {error}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        padding: "6px 10px 2px",
        fontSize: "10px",
        fontWeight: 600,
        textTransform: "uppercase",
        letterSpacing: "0.04em",
        color: palette.textMuted,
      }}
    >
      {children}
    </div>
  );
}

function Divider() {
  return <div style={{ height: "1px", background: palette.divider, margin: "6px 4px" }} />;
}

interface MenuItemProps {
  label: string;
  hint?: string;
  pending?: boolean;
  destructive?: boolean;
  chevron?: boolean;
  onClick: () => void;
}

function MenuItem({ label, hint, pending, destructive, chevron, onClick }: MenuItemProps) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      disabled={pending}
      style={{
        width: "100%",
        textAlign: "left",
        padding: "8px 10px",
        background: "transparent",
        border: "1px solid transparent",
        borderRadius: "6px",
        cursor: pending ? "wait" : "pointer",
        display: "flex",
        flexDirection: "column",
        gap: "2px",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = palette.surfaceHover;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
      }}
    >
      <span
        style={{
          fontSize: "12px",
          fontWeight: 500,
          color: destructive ? palette.destructive : palette.text,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "8px",
        }}
      >
        {pending ? "Updating…" : label}
        {chevron ? <span style={{ color: palette.textMuted }}>›</span> : null}
      </span>
      {hint ? (
        <span style={{ fontSize: "10px", color: palette.textMuted }}>{hint}</span>
      ) : null}
    </button>
  );
}

function MenuHeader({ label, onBack }: { label: string; onBack: () => void }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "6px",
        padding: "6px 10px 4px",
        fontSize: "11px",
        fontWeight: 600,
        color: palette.text,
      }}
    >
      <button
        type="button"
        onClick={onBack}
        style={{
          background: "transparent",
          border: "none",
          color: palette.textMuted,
          cursor: "pointer",
          padding: 0,
          fontSize: "11px",
        }}
        aria-label="Back"
      >
        ‹
      </button>
      {label}
    </div>
  );
}
