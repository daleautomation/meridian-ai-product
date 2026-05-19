"use client";

// Meridian — Lead Workflow Drawer.
//
// Single column: [ Operator ]. The legacy "Assist Mode" right column
// (Intelligence Panel + AI chat) was removed in the AI-theater removal
// pass — Meridian no longer offers AI-generated coaching surfaces. The
// drawer remains as a positional wrapper so parent layout grids
// (CalendarCommandCenter / OperatorConsole) stay stable.

import {
  WORKFLOW,
} from "./workflowLayout";

const CELL_BASE = {
  alignSelf: "start",
  minHeight: 0,
  minWidth: 0,
  display: "flex",
  flexDirection: "column",
};

export default function LeadWorkflowDrawer({
  selectedTask,
  operatorPanel,
  // Legacy props retained so existing call sites don't error. The
  // assist column was removed; these are no-ops.
  // eslint-disable-next-line no-unused-vars
  deepReportOpen,
  // eslint-disable-next-line no-unused-vars
  onDeepReportClose,
  // eslint-disable-next-line no-unused-vars
  tradeLabel,
  // eslint-disable-next-line no-unused-vars
  assistantCollapsed,
  // eslint-disable-next-line no-unused-vars
  onToggleAssistant,
}) {
  if (!selectedTask) return null;

  return (
    <aside
      role="region"
      aria-label="Lead workflow drawer"
      style={{
        display: "flex",
        alignItems: "flex-start",
        position: "sticky",
        top: "12px",
        alignSelf: "start",
        maxHeight: WORKFLOW.panelMaxHeight,
        minHeight: 0,
        maxWidth: WORKFLOW.drawerMaxWidth,
        overflowX: "visible",
        overflowY: "visible",
        overscrollBehavior: "contain",
        paddingRight: "2px",
      }}
    >
      <div
        style={{
          ...CELL_BASE,
          height: WORKFLOW.panelMaxHeight,
          maxHeight: WORKFLOW.panelMaxHeight,
          overflow: "hidden",
          animation: "meridian-operator-enter 180ms cubic-bezier(0.22, 1, 0.36, 1) both",
        }}
      >
        {operatorPanel}
      </div>
    </aside>
  );
}
