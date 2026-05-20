// Dev-only scroll-zone visualizer. When true, every named scroll
// container gets a colored outline so the engineer can see which
// boxes own which scroll. Default false.
export const DEBUG_SCROLL_ZONES = false;

// Meridian — shared workflow layout + motion constants.
//
// Single source of truth for the drawer/workspace grid AND the
// premium interaction system. Today + All Leads consume the same
// values so motion + spacing + surface treatment are identical.

// ── Motion ──────────────────────────────────────────────────────────
// Apple-style easing curve + three duration tokens. Used across every
// transition and keyframe in the workflow shell.
export const MOTION = {
  motionFast: "120ms",
  motionBase: "180ms",
  motionSlow: "240ms",
  easeApple:  "cubic-bezier(0.22, 1, 0.36, 1)",
};

// ── Spacing ─────────────────────────────────────────────────────────
// One scale, used everywhere. No competing margins.
export const SPACING = {
  panelGap:     "12px",
  panelPadding: "16px",
  sectionGap:   "14px",
  innerGap:     "10px",
};

// ── Selected-blue panel border tokens ──────────────────────────────
// Shared blue border feel — matches the selected calendar card so
// every workflow panel reads as "selected / in-focus." The strong
// 2px left border anchors the panel; soft 1.5px on the other sides
// keeps the surface premium without feeling boxed-in. Glow gives
// each panel a visible boundary even on white-on-white backgrounds.
export const panelBlueBorder     = "2px solid #2563EB";
export const panelBlueBorderSoft = "1.5px solid rgba(37, 99, 235, 0.55)";
export const panelBlueGlow       = "0 0 0 1px rgba(37,99,235,0.10), 0 18px 50px -30px rgba(37,99,235,0.45)";

// ── Panel surface ───────────────────────────────────────────────────
// Every workflow panel shares this surface so the user can immediately
// see where each panel starts and ends. Strong 2px blue left rail +
// soft blue outline on the other sides + a subtle blue glow.
export const PANEL_SURFACE = {
  background:     "rgba(255,255,255,0.96)",
  borderTop:      panelBlueBorderSoft,
  borderRight:    panelBlueBorderSoft,
  borderBottom:   panelBlueBorderSoft,
  borderLeft:     panelBlueBorder,
  borderRadius:   "18px",
  boxShadow:      panelBlueGlow,
  backdropFilter: "blur(14px)",
  WebkitBackdropFilter: "blur(14px)",
};

// ── Workflow widths ─────────────────────────────────────────────────
// In closed state we use fixed widths (Operator + Assistant fit at any
// viewport down to 1024px without trouble). In deep state we clamp
// Operator and Deep Report so the drawer always fits beside the
// workspace + 240px buffer at 1440 / 1280 / 1024 viewports without
// pushing the Assistant rail off-screen. Assistant rail stays fixed.
export const WORKFLOW = {
  shellGap:           SPACING.panelGap,
  panelGap:           SPACING.panelGap,

  // Workspace minima — the workspace must be at least this wide so
  // it never compresses past readable. In deep state we drop to 240px
  // so the responsive drawer has room to fit the Assistant rail.
  workspaceMinClosed: "360px",
  workspaceMinDeep:   "240px",

  // Drawer-internal panel widths.
  // In deep state the Assistant moves BELOW the Operator (operator
  // stack), so the deep grid is only two columns: Operator stack |
  // Deep Report. Both columns use minmax() so the workflow reads as
  // a balanced two-column workspace at typical desktop widths.
  operatorClosed:     "minmax(460px, 620px)",
  operatorDeep:       "minmax(430px, 520px)",
  deepReport:         "minmax(520px, 640px)",
  assistantOpen:      "320px",
  assistantRail:      "64px",

  // Panel max-height — every panel caps here. Long content scrolls
  // inside the panel. Tighter top reserve (72px) maximises usable
  // vertical room for the Operator Stack + Deep Report duo.
  panelMaxHeight:     "calc(100vh - 72px)",

  // Operator floor inside the deep-state stack. Reserves at least
  // 360px for Operator no matter what — the Call-Now / action
  // buttons must remain reachable.
  operatorDeepMin:    "360px",

  // Compact Assistant height when stacked under Operator. Bounded so
  // the stack stays usable on shorter screens; minHeight 300 keeps
  // header + chips + a message + composer all visible.
  assistantCompactHeight:  "clamp(300px, 34vh, 400px)",
  assistantCompactMin:     "300px",

  // Expanded Assistant height — toggled by the chevron in the
  // Assistant header. Operator above shrinks (with internal scroll)
  // to make room, BUT we cap the expanded Assistant so Operator
  // never drops below operatorDeepMin (360px) + the 20px stack gap.
  // 72 (top reserve) + 380 + 20 = 472 → max = calc(100vh - 472px).
  assistantExpandedHeight: "clamp(460px, 56vh, 640px)",
  assistantExpandedMin:    "460px",
  assistantExpandedMax:    "calc(100vh - 472px)",

  // Drawer outer cap — guarantees the drawer never grows wide enough
  // to push the Assistant rail off-screen, no matter the viewport.
  // 280px reserves room for the workspace + horizontal padding.
  drawerMaxWidth:     "calc(100vw - 240px)",

  // Legacy aliases (kept so existing imports don't break).
  gap:                SPACING.panelGap,
  operatorWidth:      "minmax(460px, 620px)",
  operatorWidthDeep:  "minmax(430px, 520px)",
  deepReportWidth:    "minmax(520px, 640px)",
  assistantWidth:     "320px",
  assistantRailWidth: "64px",
  minWorkspaceWidth:  "360px",

  // Motion tokens routed through MOTION so callers don't reach into
  // it directly.
  panelEnterTransition: `opacity ${MOTION.motionBase} ease, transform ${MOTION.motionBase} ${MOTION.easeApple}`,
  shellTransition:      `grid-template-columns ${MOTION.motionBase} ${MOTION.easeApple}`,
};

// Parent shell grid templates — drawer is a single `auto` column.
export const SHELL_GRID = {
  noLead:  "1fr",
  closed:  `minmax(${WORKFLOW.workspaceMinClosed}, 1fr) auto`,
  deep:    `minmax(${WORKFLOW.workspaceMinDeep}, 1fr) auto`,
};

// Drawer-internal grid templates.
//
// Closed: [ Operator ]                                 "minmax(380px, 460px)"
// Assist: [ Operator ][ Intelligence Panel ]           "minmax(390px, 430px) minmax(520px, 640px)"
//
// The Assistant is no longer a separate drawer column — it lives
// INSIDE the Intelligence Panel. The drawer therefore exposes only
// two grid templates: the closed one-column form and the assist
// two-column form.
export const DRAWER_GRID = {
  closed: `minmax(460px, 620px)`,
  deep:   `${WORKFLOW.operatorDeep} ${WORKFLOW.deepReport}`,
};
