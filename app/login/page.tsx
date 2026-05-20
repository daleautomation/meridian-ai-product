"use client";

import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Demo button gating — show only after mount AND only on dev /
  // ngrok hosts. SSR returns null so production hydration never
  // sees the button.
  const [showDemoLogin, setShowDemoLogin] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const timer = window.setTimeout(() => {
      const host = window.location.hostname.toLowerCase();
      const isDev = host === "localhost" || host === "127.0.0.1";
      const isNgrok = host.includes("ngrok");
      setShowDemoLogin(isDev || isNgrok);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Login failed");
        setLoading(false);
        return;
      }
      const next = searchParams.get("next") || "/operator";
      // Only allow internal redirects
      const safe = next.startsWith("/") && !next.startsWith("//") ? next : "/operator";
      router.replace(safe);
      router.refresh();
    } catch {
      setError("Network error");
      setLoading(false);
    }
  }

  return (
    <div style={styles.root}>
      <form onSubmit={onSubmit} style={styles.card}>
        <div style={styles.brand}>MERIDIAN</div>
        <div style={styles.sub}>Sign in to your workspace</div>
        <label style={styles.label}>USERNAME</label>
        <input
          autoFocus
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          style={styles.input}
          autoComplete="username"
        />
        <label style={styles.label}>PASSWORD</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={styles.input}
          autoComplete="current-password"
        />
        {error && <div style={styles.error}>{error}</div>}
        <button type="submit" disabled={loading} style={styles.btn}>
          {loading ? "Signing in..." : "Sign In"}
        </button>
        {showDemoLogin ? (
          <a
            href="/api/auth/demo-login?user=john&workspace=labortech"
            style={styles.demoBtn}
          >
            Demo Login as John
          </a>
        ) : null}
      </form>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    minHeight: "100dvh",
    background: "#FAFBFC",
    color: "#1A1A2E",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "24px 16px",
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Inter', sans-serif",
  },
  card: {
    width: "100%",
    maxWidth: "340px",
    padding: "32px 24px",
    background: "#FFFFFF",
    border: "1px solid #E2E8F0",
    borderRadius: "14px",
    boxShadow: "0 4px 6px rgba(0,0,0,0.04), 0 10px 15px rgba(0,0,0,0.03)",
    display: "flex",
    flexDirection: "column",
    boxSizing: "border-box",
  },
  brand: {
    fontSize: "18px",
    fontWeight: 700,
    color: "#1A1A2E",
    letterSpacing: "-0.01em",
  },
  sub: {
    fontSize: "12px",
    color: "#94A3B8",
    marginBottom: "28px",
    marginTop: "2px",
  },
  label: {
    fontSize: "12px",
    fontWeight: 500,
    color: "#64748B",
    marginTop: "14px",
    marginBottom: "6px",
  },
  input: {
    background: "#FAFBFC",
    border: "1px solid #E2E8F0",
    borderRadius: "8px",
    padding: "12px 12px",
    color: "#1A1A2E",
    fontSize: "16px",
    fontFamily: "inherit",
    outline: "none",
    width: "100%",
    boxSizing: "border-box",
  },
  error: {
    marginTop: "14px",
    fontSize: "12px",
    color: "#DC2626",
  },
  btn: {
    marginTop: "24px",
    padding: "14px 12px",
    borderRadius: "8px",
    background: "#2563EB",
    color: "#FFFFFF",
    border: "none",
    fontSize: "15px",
    fontWeight: 600,
    cursor: "pointer",
    minHeight: "44px",
  },
  demoBtn: {
    marginTop: "12px",
    padding: "12px",
    borderRadius: "8px",
    background: "transparent",
    color: "#2563EB",
    border: "1px solid #BFDBFE",
    fontSize: "13px",
    fontWeight: 600,
    cursor: "pointer",
    minHeight: "40px",
    textAlign: "center",
    textDecoration: "none",
    display: "block",
  },
};

export default function LoginPage() {
  return (
    <Suspense fallback={<LoginLoadingShell />}>
      <LoginForm />
    </Suspense>
  );
}

function LoginLoadingShell() {
  return (
    <div style={styles.root} aria-busy="true" aria-live="polite">
      <div style={styles.card}>
        <div style={styles.brand}>MERIDIAN</div>
        <div style={styles.sub}>Preparing your workspace sign-in...</div>
        <div style={{ height: 12, borderRadius: 999, background: "#E2E8F0", marginTop: 16 }} />
        <div style={{ height: 44, borderRadius: 8, background: "#EEF2F7", marginTop: 18 }} />
        <div style={{ height: 44, borderRadius: 8, background: "#DBEAFE", marginTop: 24 }} />
      </div>
    </div>
  );
}
