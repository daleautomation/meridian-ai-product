"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
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
      router.replace("/");
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
          {loading ? "Signing in..." : "Sign in"}
        </button>
      </form>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    minHeight: "100vh",
    background: "#080910",
    color: "#E8EAF0",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontFamily: "'DM Sans', sans-serif",
  },
  card: {
    width: "320px",
    padding: "32px 28px",
    background: "#0A0B10",
    border: "1px solid rgba(255,255,255,0.06)",
    borderRadius: "12px",
    display: "flex",
    flexDirection: "column",
  },
  brand: {
    fontSize: "18px",
    fontWeight: 800,
    letterSpacing: "0.12em",
  },
  sub: {
    fontSize: "11px",
    color: "rgba(255,255,255,0.3)",
    letterSpacing: "0.05em",
    marginBottom: "24px",
  },
  label: {
    fontSize: "10px",
    letterSpacing: "0.1em",
    color: "rgba(255,255,255,0.4)",
    marginTop: "12px",
    marginBottom: "6px",
  },
  input: {
    background: "rgba(255,255,255,0.04)",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: "6px",
    padding: "10px 12px",
    color: "#E8EAF0",
    fontSize: "13px",
    fontFamily: "inherit",
    outline: "none",
  },
  error: {
    marginTop: "14px",
    fontSize: "12px",
    color: "#FF5555",
  },
  btn: {
    marginTop: "20px",
    padding: "10px 12px",
    borderRadius: "7px",
    background: "#C8873A",
    color: "#080910",
    border: "none",
    fontSize: "13px",
    fontWeight: 600,
    cursor: "pointer",
  },
};
