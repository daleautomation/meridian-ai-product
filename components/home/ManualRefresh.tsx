"use client";

import { useState } from "react";

/** Re-runs the morning operator (recompute + re-notify) via the admin-session
 *  path of the protected route, then reloads to show the fresh brief. No secret
 *  is exposed client-side — auth is the existing session cookie. */
export default function ManualRefresh() {
  const [state, setState] = useState<"idle" | "running" | "done" | "error">("idle");

  async function refresh() {
    setState("running");
    try {
      const res = await fetch("/api/operator/morning-brief", { method: "POST", credentials: "include" });
      if (!res.ok) throw new Error(String(res.status));
      setState("done");
      window.location.reload();
    } catch {
      setState("error");
    }
  }

  const label = state === "running" ? "Refreshing…" : state === "error" ? "Retry refresh" : "Run manual refresh";
  return (
    <button
      onClick={refresh}
      disabled={state === "running"}
      style={{
        fontSize: 12, padding: "4px 10px", borderRadius: 7, cursor: state === "running" ? "default" : "pointer",
        border: "1px solid #2a2f3a", background: "#171b23", color: "#c3cad6",
      }}
    >
      {label}
    </button>
  );
}
