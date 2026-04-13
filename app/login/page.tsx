"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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
      const next = searchParams.get("next") || "/dashboard";
      // Only allow internal redirects
      const safe = next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";
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
        <a href="/" style={styles.backLink}>← Back</a>
        <div style={styles.brand}>MERIDIAN AI</div>
        <div style={styles.sub}>Decision Platform</div>
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
      </form>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    minHeight: "100vh",
    background: "#0C0731",
    color: "#F0EFF5",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontFamily: "'DM Sans', sans-serif",
  },
  card: {
    width: "320px",
    padding: "32px 28px",
    background: "#11102A",
    border: "1px solid rgba(240,239,245,0.06)",
    borderRadius: "12px",
    display: "flex",
    flexDirection: "column",
  },
  backLink: {
    fontSize: "12px",
    color: "rgba(240,239,245,0.35)",
    textDecoration: "none",
    marginBottom: "16px",
  },
  brand: {
    fontSize: "18px",
    fontWeight: 800,
    letterSpacing: "0.10em",
    fontFamily: "'Syne', sans-serif",
  },
  sub: {
    fontSize: "11px",
    color: "rgba(240,239,245,0.35)",
    letterSpacing: "0.05em",
    marginBottom: "24px",
  },
  label: {
    fontSize: "10px",
    letterSpacing: "0.1em",
    color: "rgba(240,239,245,0.40)",
    marginTop: "12px",
    marginBottom: "6px",
  },
  input: {
    background: "rgba(240,239,245,0.04)",
    border: "1px solid rgba(240,239,245,0.08)",
    borderRadius: "6px",
    padding: "10px 12px",
    color: "#F0EFF5",
    fontSize: "13px",
    fontFamily: "inherit",
    outline: "none",
  },
  error: {
    marginTop: "14px",
    fontSize: "12px",
    color: "#D4726A",
  },
  btn: {
    marginTop: "20px",
    padding: "11px 12px",
    borderRadius: "7px",
    background: "#68ECF4",
    color: "#0C0731",
    border: "none",
    fontSize: "13px",
    fontWeight: 600,
    cursor: "pointer",
    letterSpacing: "0.02em",
  },
};
