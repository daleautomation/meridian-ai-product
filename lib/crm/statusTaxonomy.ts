// Meridian AI — CRM status taxonomy.
//
// Single source of truth for the pipeline statuses the rep can move a lead
// through. The snapshot store's `status` field is loosely typed (accepts
// any string) because legacy data used free-form labels; this module is
// what UI + new code should import so we don't drift.
//
// Grouped so the pipeline view can render tabs without re-deriving groups.

export const LEAD_STATUS = {
  NEW: "NEW",
  READY_TO_CALL: "READY_TO_CALL",
  CONTACTED: "CONTACTED",
  VOICEMAIL: "VOICEMAIL",
  EMAILED: "EMAILED",
  INTERESTED: "INTERESTED",
  FOLLOW_UP: "FOLLOW_UP",
  QUALIFIED: "QUALIFIED",
  CLOSED_WON: "CLOSED_WON",
  CLOSED_LOST: "CLOSED_LOST",
  NOT_QUALIFIED: "NOT_QUALIFIED",
  ARCHIVED: "ARCHIVED",
} as const;

export type LeadStatus = (typeof LEAD_STATUS)[keyof typeof LEAD_STATUS];

export const LEAD_STATUS_LIST: LeadStatus[] = [
  LEAD_STATUS.NEW,
  LEAD_STATUS.READY_TO_CALL,
  LEAD_STATUS.CONTACTED,
  LEAD_STATUS.VOICEMAIL,
  LEAD_STATUS.EMAILED,
  LEAD_STATUS.INTERESTED,
  LEAD_STATUS.FOLLOW_UP,
  LEAD_STATUS.QUALIFIED,
  LEAD_STATUS.CLOSED_WON,
  LEAD_STATUS.CLOSED_LOST,
  LEAD_STATUS.NOT_QUALIFIED,
  LEAD_STATUS.ARCHIVED,
];

export const LEAD_STATUS_LABEL: Record<LeadStatus, string> = {
  NEW: "New",
  READY_TO_CALL: "Ready to Call",
  CONTACTED: "Contacted",
  VOICEMAIL: "Voicemail",
  EMAILED: "Emailed",
  INTERESTED: "Interested",
  FOLLOW_UP: "Follow Up",
  QUALIFIED: "Qualified",
  CLOSED_WON: "Closed Won",
  CLOSED_LOST: "Closed Lost",
  NOT_QUALIFIED: "Not Qualified",
  ARCHIVED: "Archived",
};

// High-level pipeline groups used by the pipeline view tabs.
export const LEAD_STATUS_GROUPS = {
  READY: [LEAD_STATUS.NEW, LEAD_STATUS.READY_TO_CALL] as LeadStatus[],
  CONTACTED: [
    LEAD_STATUS.CONTACTED,
    LEAD_STATUS.VOICEMAIL,
    LEAD_STATUS.EMAILED,
  ] as LeadStatus[],
  INTERESTED: [LEAD_STATUS.INTERESTED, LEAD_STATUS.QUALIFIED] as LeadStatus[],
  FOLLOW_UP: [LEAD_STATUS.FOLLOW_UP] as LeadStatus[],
  CLOSED: [
    LEAD_STATUS.CLOSED_WON,
    LEAD_STATUS.CLOSED_LOST,
    LEAD_STATUS.NOT_QUALIFIED,
    LEAD_STATUS.ARCHIVED,
  ] as LeadStatus[],
};

export function isLeadStatus(s: unknown): s is LeadStatus {
  return typeof s === "string" && (LEAD_STATUS_LIST as string[]).includes(s);
}

// Legacy statuses emitted by the existing system get normalized to the
// canonical set above. Keeps the UI consistent without breaking the
// historical record.
const LEGACY_MAP: Record<string, LeadStatus> = {
  CALLED: LEAD_STATUS.CONTACTED,
  PITCHED: LEAD_STATUS.INTERESTED,
};

export function normalizeStatus(s: string | null | undefined): LeadStatus {
  if (!s) return LEAD_STATUS.NEW;
  const upper = s.toUpperCase();
  if (isLeadStatus(upper)) return upper;
  if (LEGACY_MAP[upper]) return LEGACY_MAP[upper];
  return LEAD_STATUS.NEW;
}

// Statuses that mean "this lead is no longer a live opportunity".
export const TERMINAL_STATUSES: LeadStatus[] = [
  LEAD_STATUS.CLOSED_WON,
  LEAD_STATUS.CLOSED_LOST,
  LEAD_STATUS.NOT_QUALIFIED,
  LEAD_STATUS.ARCHIVED,
];

export function isTerminalStatus(s: LeadStatus): boolean {
  return TERMINAL_STATUSES.includes(s);
}
