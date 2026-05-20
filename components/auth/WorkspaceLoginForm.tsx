"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

type DevHint = {
  label: string;
  username: string;
  workspace: string;
};

const DEV_HINTS: DevHint[] = [
  { label: "LaborTech operator", username: "john", workspace: "labortech" },
  { label: "Nicole Lonergan · Brookside", username: "nicole", workspace: "nicole-lonergan" },
  { label: "Meridian admin", username: "dylan", workspace: "workspace-select" },
];

export function WorkspaceLoginForm({ initialNext }: { initialNext?: string | null }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showDevHints, setShowDevHints] = useState(false);

  useEffect(() => {
    const host = window.location.hostname.toLowerCase();
    setShowDevHints(
      host === "localhost" || host === "127.0.0.1" || host.includes("ngrok"),
    );
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const nextParam = searchParams.get("next") ?? initialNext ?? null;
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username,
          password,
          next: nextParam,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Invalid credentials");
        setLoading(false);
        return;
      }
      const redirectTo =
        typeof data.redirectTo === "string" && data.redirectTo.startsWith("/")
          ? data.redirectTo
          : "/workspace-select";
      setLoading(false);
      router.replace(redirectTo);
      router.refresh();
    } catch {
      setError("Network error — try again");
      setLoading(false);
    }
  }

  return (
    <div className="workspace-login-layout">
      <Link href="/" className="workspace-login-back">
        ← Meridian
      </Link>

      <form onSubmit={onSubmit} className="workspace-login-card">
        <p className="workspace-login-eyebrow">Workspace access</p>
        <h1 className="workspace-login-title">Sign in</h1>
        <p className="workspace-login-sub">
          Enter the credentials for your assigned Meridian workspace.
        </p>

        <label className="workspace-login-label" htmlFor="username">
          Username
        </label>
        <input
          id="username"
          autoFocus
          autoComplete="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          className="workspace-login-input"
        />

        <label className="workspace-login-label" htmlFor="password">
          Password
        </label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="workspace-login-input"
        />

        {error ? <p className="workspace-login-error" role="alert">{error}</p> : null}

        <button type="submit" disabled={loading} className="workspace-login-submit">
          {loading ? "Signing in…" : "Continue to workspace"}
        </button>
      </form>

      {showDevHints ? (
        <aside className="workspace-login-dev" aria-label="Development workspace hints">
          <p className="workspace-login-dev-title">Dev workspace accounts</p>
          <p className="workspace-login-dev-copy">
            Usernames only — use assigned passwords from your Meridian credential sheet.
          </p>
          <ul className="workspace-login-dev-list">
            {DEV_HINTS.map((hint) => (
              <li key={hint.username}>
                <strong>{hint.label}</strong>
                <span>username: {hint.username}</span>
              </li>
            ))}
          </ul>
          <div className="workspace-login-dev-actions">
            <a
              href="/api/auth/demo-login?user=john&workspace=labortech"
              className="workspace-login-dev-btn"
            >
              Quick: John → LaborTech
            </a>
            <a
              href="/api/auth/demo-login?user=nicole&workspace=nicole-lonergan&surface=personal"
              className="workspace-login-dev-btn"
            >
              Quick: Nicole → Brookside
            </a>
          </div>
        </aside>
      ) : null}
    </div>
  );
}
