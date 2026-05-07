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
  { action: "move_tomorrow", label: "Move to Tomorrow", hint: "Working day, weekend-skipped" },
  { action: "move_next_week", label: "Move to Next Week", hint: "Next Monday" },
];

const SECONDARY_ITEMS: Array<{ action: Action; label: string; hint: string }> = [
  { action: "follow_up", label: "Mark Follow-Up", hint: "Out of main queue, retains context" },
  { action: "skip", label: "Skip / Revisit Later", hint: "Drops to bottom of pipeline" },
];

export default function SchedulingMenu({
  leadId,
  workspaceSlug,
  leadName,
  reps,
  hasOverride,
  variant = "icon",
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<Action | null>(null);
  const [showReps, setShowReps] = useState(false);
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

  async function send(action: Action, repId?: string) {
    if (pending) return;
    setPending(action);
    setError(null);
    try {
      const res = await fetch("/api/scheduling/override", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          leadId,
          workspaceSlug,
          action,
          repId: action === "assign_rep" ? repId : undefined,
        }),
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
            zIndex: 50,
          }}
        >
          {showReps && reps && reps.length > 0 ? (
            <>
              <MenuHeader label="Assign rep" onBack={() => setShowReps(false)} />
              {reps.map((r) => (
                <MenuItem
                  key={r.id}
                  label={r.name}
                  hint={`Assign ${r.name}`}
                  pending={pending === "assign_rep"}
                  onClick={() => send("assign_rep", r.id)}
                />
              ))}
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
                    label="Assign Rep…"
                    hint={`${reps.length} rep${reps.length === 1 ? "" : "s"} available`}
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
