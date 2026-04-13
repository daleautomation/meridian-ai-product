"use client";

import { palette, publicContent, brand } from "../lib/theme";
import MeridianMark from "./MeridianMark";

export default function AboutPage({ isAuthenticated }) {
  const entryHref = isAuthenticated ? "/dashboard" : "/login";
  const entryLabel = isAuthenticated ? "Enter Platform" : "Sign In";

  return (
    <div style={S.root}>
      {/* Nav */}
      <nav style={S.nav}>
        <a href="/" style={S.navBrand}>
          <MeridianMark size={26} color={palette.cobalt} bg={palette.lightBg} />
          <span style={S.navName}>{brand.name}</span>
        </a>
        <div style={S.navRight}>
          <a href="/" style={S.navLink}>Home</a>
          <a href={entryHref} style={S.navCta}>{entryLabel}</a>
        </div>
      </nav>

      {/* Hero */}
      <section style={S.heroSection}>
        <div style={S.sectionLabel}>About Meridian</div>
        <h1 style={S.pageTitle}>Decision intelligence for high-value acquisitions</h1>
        <p style={S.lead}>
          Meridian AI is a modular decision engine. It ingests from dozens of sources, scores every opportunity on real economics and trust, and produces one clear action per item. Built for operators who need speed, clarity, and edge.
        </p>
      </section>

      {/* How It Works */}
      <section style={S.section}>
        <div style={S.sectionLabel}>How it works</div>
        <div style={S.stepGrid}>
          {[
            { n: "1", t: "Source", d: "Ingests from marketplaces, community listings, public records, FSBO, and private sellers. Prioritizes fresh, mispriced, and distressed opportunities." },
            { n: "2", t: "Score", d: "Every item is scored on net economics, trust, valuation confidence, and execution risk. No signal is taken at face value." },
            { n: "3", t: "Decide", d: "The engine compresses each opportunity into one dominant action: execute, probe, wait, or walk. With a full acquisition plan attached." },
          ].map(s => (
            <div key={s.n} style={S.card}>
              <div style={S.stepNum}>{s.n}</div>
              <div style={S.stepTitle}>{s.t}</div>
              <p style={S.stepDesc}>{s.d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Live Modules */}
      <section style={S.section}>
        <div style={S.sectionLabel}>Live modules</div>
        <div style={S.moduleGrid}>
          {publicContent.about.moduleCapabilities.map(mod => (
            <div key={mod.label} style={S.card}>
              <div style={S.cardTitle}>{mod.label}</div>
              {mod.capabilities.map(cap => (
                <div key={cap} style={S.capItem}>
                  <span style={S.capDot} />
                  <span>{cap}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
        <div style={S.detailGrid}>
          <div>
            <div style={S.cardTitle}>Luxury Goods</div>
            <p style={S.body}>
              Sources watches and high-end collectibles from eBay, Chrono24, Facebook Marketplace, Reddit, and private sellers. Scores on net margin after platform friction, trust-filters on seller history and authenticity, and ranks by liquidity-adjusted annualized return.
            </p>
          </div>
          <div>
            <div style={S.cardTitle}>Homes</div>
            <p style={S.body}>
              Sources off-market residential deals from public records, FSBO listings, and aggregator feeds. Scores on equity spread against ARV, risk-adjusts for condition and rehab scope, and detects distress signals from price drops, stale DOM, and seller motivation keywords.
            </p>
          </div>
        </div>
      </section>

      {/* Why It Matters */}
      <section style={S.section}>
        <div style={S.sectionLabel}>Why it matters</div>
        <p style={S.body}>
          Most opportunities are visible to everyone. The edge comes from acting faster on the right ones and ignoring the rest. Meridian compresses the time between seeing an opportunity and knowing exactly what to do about it.
        </p>
      </section>

      {/* Always Expanding */}
      <section style={S.section}>
        <div style={S.sectionLabel}>Always expanding</div>
        <p style={S.body}>
          The platform grows through new modules, new data sources, and sharper tools. Upcoming:
        </p>
        <div style={S.roadmapList}>
          {publicContent.roadmap.items.map(item => (
            <div key={item} style={S.roadmapItem}>
              <div style={S.roadmapDot} />
              <span>{item}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Conversion */}
      <section style={S.conversionSection}>
        <div style={S.sectionLabel}>Get started</div>
        <div style={S.cGrid}>
          <div style={S.cCard}>
            <div style={S.cTitle}>{publicContent.demo.title}</div>
            <p style={S.cDesc}>{publicContent.demo.desc}</p>
            <a href={publicContent.demo.href} style={S.cBtnPrimary}>{publicContent.demo.cta}</a>
          </div>
          <div style={S.cCard}>
            <div style={S.cTitle}>{publicContent.requestModule.title}</div>
            <p style={S.cDesc}>{publicContent.requestModule.desc}</p>
            <a href={publicContent.requestModule.href} style={S.cBtnPrimary}>{publicContent.requestModule.cta}</a>
          </div>
        </div>
      </section>

      <footer style={S.footer}>
        <a href="/" style={S.footerLink}>{brand.name}</a>
        <span style={S.footerDim}>{brand.positioning}</span>
      </footer>
    </div>
  );
}

// ── Styles: matched to WelcomePage system ──────────────────────────────

const S = {
  root: { minHeight: "100vh", background: palette.lightBg, color: palette.lightText, fontFamily: "'DM Sans', sans-serif" },

  // Nav — matches homepage exactly
  nav: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "22px 44px" },
  navBrand: { display: "flex", alignItems: "center", gap: "10px", textDecoration: "none" },
  navName: { fontFamily: "'Syne', sans-serif", fontSize: "15px", fontWeight: 700, letterSpacing: "0.04em", color: palette.lightText },
  navRight: { display: "flex", alignItems: "center", gap: "22px" },
  navLink: { fontSize: "14px", fontWeight: 500, color: palette.lightText, textDecoration: "none", opacity: 0.7 },
  navCta: { fontSize: "14px", fontWeight: 600, color: "#fff", textDecoration: "none", padding: "9px 20px", borderRadius: "8px", background: palette.cobalt },

  // Hero
  heroSection: { maxWidth: "740px", margin: "0 auto", padding: "56px 44px 24px" },
  pageTitle: { fontFamily: "'Syne', sans-serif", fontSize: "40px", fontWeight: 800, letterSpacing: "-0.02em", color: palette.lightText, margin: "0 0 18px", lineHeight: 1.12 },
  lead: { fontSize: "17px", color: palette.lightText, opacity: 0.68, lineHeight: 1.7, margin: 0, maxWidth: "580px" },

  // Sections — matches homepage
  section: { maxWidth: "740px", margin: "0 auto", padding: "40px 44px 20px" },
  sectionLabel: { fontSize: "12px", fontWeight: 700, letterSpacing: "0.12em", color: palette.cobalt, textTransform: "uppercase", marginBottom: "20px" },
  body: { fontSize: "15px", color: palette.lightText, opacity: 0.68, lineHeight: 1.7, margin: "0 0 16px" },

  // Cards — unified system
  card: {
    padding: "24px",
    background: palette.lightSurface,
    border: "1px solid rgba(12,7,49,0.12)",
    boxShadow: "0 0 0 1px rgba(12,7,49,0.04)",
    borderRadius: "12px",
  },
  cardTitle: { fontFamily: "'Syne', sans-serif", fontSize: "16px", fontWeight: 700, color: palette.lightText, marginBottom: "10px", textTransform: "uppercase", letterSpacing: "0.04em" },

  // Steps
  stepGrid: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "18px" },
  stepNum: { fontFamily: "'JetBrains Mono', monospace", fontSize: "22px", fontWeight: 700, color: palette.cobalt, marginBottom: "8px", opacity: 0.4 },
  stepTitle: { fontFamily: "'Syne', sans-serif", fontSize: "16px", fontWeight: 700, color: palette.lightText, marginBottom: "8px" },
  stepDesc: { fontSize: "13px", color: palette.lightText, opacity: 0.68, lineHeight: 1.6, margin: 0 },

  // Module capabilities
  moduleGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "18px", marginBottom: "24px" },
  capItem: { display: "flex", alignItems: "baseline", gap: "8px", fontSize: "14px", color: palette.lightText, opacity: 0.68, lineHeight: 1.55, marginBottom: "5px" },
  capDot: { width: "4px", height: "4px", borderRadius: "50%", background: palette.cobalt, opacity: 0.35, flexShrink: 0, marginTop: "8px" },

  // Module detail
  detailGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px" },

  // Roadmap
  roadmapList: { display: "flex", flexDirection: "column", gap: "9px" },
  roadmapItem: { display: "flex", alignItems: "center", gap: "10px", fontSize: "15px", color: palette.lightText, opacity: 0.68 },
  roadmapDot: { width: "5px", height: "5px", borderRadius: "50%", background: palette.cobalt, opacity: 0.3, flexShrink: 0 },

  // Conversion — matches homepage system
  conversionSection: { maxWidth: "740px", margin: "0 auto", padding: "48px 44px 72px" },
  cGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "18px" },
  cCard: {
    padding: "28px 28px 26px",
    background: palette.lightSurface,
    border: "1px solid rgba(12,7,49,0.12)",
    boxShadow: "0 0 0 1px rgba(12,7,49,0.04)",
    borderRadius: "12px",
    textAlign: "center",
  },
  cTitle: { fontFamily: "'Syne', sans-serif", fontSize: "17px", fontWeight: 700, letterSpacing: "0.01em", lineHeight: 1.3, color: palette.midnight, marginBottom: "8px", textTransform: "uppercase" },
  cDesc: { fontSize: "14px", color: palette.midnight, opacity: 0.72, lineHeight: 1.7, margin: "0 auto 16px", maxWidth: "240px" },
  cBtnPrimary: {
    display: "inline-block",
    fontSize: "14px",
    fontWeight: 700,
    color: "#fff",
    background: palette.midnight,
    border: "1px solid transparent",
    padding: "10px 0",
    borderRadius: "7px",
    textDecoration: "none",
    textAlign: "center",
    width: "180px",
  },

  // Footer — matches homepage
  footer: { textAlign: "center", padding: "28px 44px", fontSize: "13px", color: palette.lightTextTertiary, display: "flex", justifyContent: "center", gap: "16px", borderTop: `1px solid ${palette.lightBorder}` },
  footerLink: { color: palette.lightTextTertiary, textDecoration: "none" },
  footerDim: { color: palette.lightTextDim },
};
