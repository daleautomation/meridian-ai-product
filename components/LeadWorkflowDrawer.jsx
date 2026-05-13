"use client";

// Meridian — Lead Workflow Drawer.
//
// ARCHITECTURE (one workflow, no duplicates):
//   • Parent shell is two columns: [ workspace ][ drawer ].
//   • Drawer states:
//       closed → [ Operator ]                              one column
//       assist → [ Operator ][ Intelligence Panel ]        two columns
//
//   • Operator is always rendered, full-size, never replaced.
//   • The Intelligence Panel is the SINGLE surface that combines
//     deep analysis + AI assistant. There is no separate Assistant
//     drawer column anywhere in this tree.
//
// The `deepReportOpen` / `onDeepReportClose` / `onOpenDeepReport`
// prop names are kept for compatibility with the parent state in
// CalendarCommandCenter / OperatorConsole — semantically they now
// open / close "Assist Mode."

import { palette } from "../lib/theme";
import {
  WORKFLOW,
  DRAWER_GRID,
  PANEL_SURFACE,
} from "./workflowLayout";
import IntelligencePanel from "./IntelligencePanel";

const CELL_BASE = {
  alignSelf: "start",
  minHeight: 0,
  minWidth: 0,
  display: "flex",
  flexDirection: "column",
};

export default function LeadWorkflowDrawer({
  selectedTask,
  deepReportOpen,
  onDeepReportClose,
  tradeLabel,
  operatorPanel,
  // Legacy props retained so existing call sites don't error. The
  // Assistant no longer lives in the drawer, so these are no-ops in
  // the new architecture.
  // eslint-disable-next-line no-unused-vars
  assistantCollapsed,
  // eslint-disable-next-line no-unused-vars
  onToggleAssistant,
}) {
  if (!selectedTask) return null;

  const assistOpen = !!deepReportOpen;
  const company =
    selectedTask?.linkedCompany
    ?? selectedTask?.title
    ?? "Selected lead";

  return (
    <aside
      role="region"
      aria-label="Lead workflow drawer"
      style={{
        display: "grid",
        gridTemplateColumns: assistOpen ? DRAWER_GRID.deep : DRAWER_GRID.closed,
        gap: assistOpen ? "20px" : "16px",
        alignItems: "start",
        position: "sticky",
        top: "12px",
        alignSelf: "start",
        maxHeight: WORKFLOW.panelMaxHeight,
        minHeight: 0,
        maxWidth: WORKFLOW.drawerMaxWidth,
        overflowX: "visible",
        overflowY: "auto",
        overscrollBehavior: "contain",
        paddingRight: "2px",
      }}
    >
      {/* OPERATOR — always rendered, full size. SelectedLeadPanel
          owns its own surface and internal scroll. */}
      <div
        style={{
          ...CELL_BASE,
          maxHeight: WORKFLOW.panelMaxHeight,
          overflow: "visible",
          animation: "meridian-operator-enter 180ms cubic-bezier(0.22, 1, 0.36, 1) both",
        }}
      >
        {operatorPanel}
      </div>

      {/* INTELLIGENCE PANEL — only when Assist Mode is open.
          Single unified surface (insight + assistant). The cell owns
          the surface (PANEL_SURFACE), the height bound, and the
          single internal scroll boundary. */}
      {assistOpen ? (
        <div
          role="region"
          aria-label="Intelligence Panel"
          style={{
            ...CELL_BASE,
            ...PANEL_SURFACE,
            maxHeight: WORKFLOW.panelMaxHeight,
            overflow: "hidden",
            animation: "meridian-intel-enter 280ms cubic-bezier(0.22, 1, 0.36, 1) both",
          }}
        >
          {selectedTask?.laborTechScan ? (
            <IntelligencePanel
              task={selectedTask}
              company={company}
              tradeLabel={selectedTask.tradeLabel ?? tradeLabel ?? null}
              onBack={onDeepReportClose}
              onClose={onDeepReportClose}
            />
          ) : (
            <div style={{
              flex: 1,
              minHeight: 0,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: "10px",
              padding: "32px 24px",
              textAlign: "center",
              color: palette.textSecondary,
            }}>
              <div style={{ fontSize: "13px", fontWeight: 700, color: palette.textPrimary }}>
                Assist Mode unavailable
              </div>
              <div style={{ fontSize: "12px", color: palette.textSecondary, lineHeight: 1.5 }}>
                This lead doesn&apos;t have a LaborTech scan yet.
              </div>
              <button
                type="button"
                onClick={onDeepReportClose}
                style={{
                  fontSize: "12px",
                  fontWeight: 700,
                  color: palette.blue,
                  background: palette.bluePale,
                  border: `1px solid ${palette.blueBorder}`,
                  borderRadius: "10px",
                  padding: "8px 14px",
                  cursor: "pointer",
                }}
              >
                ← Back to lead
              </button>
            </div>
          )}
        </div>
      ) : null}
    </aside>
  );
}
