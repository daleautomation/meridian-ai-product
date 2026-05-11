// Meridian — Client-side tracking helper.
//
// Fire-and-forget POST to /api/events/track. Never throws, never
// blocks UI, never awaits a response. Works through ngrok HTTPS
// because it's a same-origin request.

export interface TrackEventInput {
  eventType: string;
  workspace?: string | null;
  leadId?: string | null;
  taskId?: string | null;
  companyKey?: string | null;
  crmKey?: string | null;
  companyName?: string | null;
  tradeId?: string | null;
  serviceBucketId?: string | null;
  metadata?: Record<string, unknown>;
}

export function trackEvent(input: TrackEventInput): void {
  if (typeof window === "undefined") return;
  try {
    const body = JSON.stringify({
      eventType: input.eventType,
      workspace: input.workspace ?? null,
      leadId: input.leadId ?? null,
      taskId: input.taskId ?? null,
      companyKey: input.companyKey ?? null,
      crmKey: input.crmKey ?? null,
      companyName: input.companyName ?? null,
      tradeId: input.tradeId ?? null,
      serviceBucketId: input.serviceBucketId ?? null,
      metadata: input.metadata ?? {},
    });
    // navigator.sendBeacon is preferable for fire-and-forget — it
    // continues across page navigations (e.g. when the user clicks
    // a calendar card that triggers an Assist Mode route change).
    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      const blob = new Blob([body], { type: "application/json" });
      const ok = navigator.sendBeacon("/api/events/track", blob);
      if (ok) return;
    }
    // Fallback: fetch with keepalive so the request survives a
    // navigation. Errors are silently dropped.
    fetch("/api/events/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
      credentials: "same-origin",
    }).catch(() => { /* fail silent */ });
  } catch {
    /* fail silent */
  }
}
