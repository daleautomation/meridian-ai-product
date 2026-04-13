"use client";

import { useState } from "react";
import { palette, publicContent, brand } from "../lib/theme";
import MeridianMark from "./MeridianMark";

function PricingCard({ tier }) {
  const [open, setOpen] = useState(false);

  return (
    <div style={{ ...S.pricingTier, borderColor: open ? "rgba(12,7,49,0.22)" : undefined }}>
      <div style={S.pricingTierLabel}>{tier.label}</div>
      <div style={S.pricingRow}>
        <span style={S.pricingKey}>{tier.label.includes("Custom") ? "Build" : "Setup"}</span>
        <span style={S.pricingValue}>{tier.setup}</span>
      </div>
      <div style={{ ...S.pricingRow, marginBottom: "10px" }}>
        <span style={S.pricingKey}>Monthly</span>
        <span style={S.pricingValue}>{tier.monthly}</span>
      </div>
      <button onClick={() => setOpen(o => !o)} style={S.pricingDetailBtn}>
        {open ? "Hide details" : "What affects price?"}
      </button>

      {open && tier.detail && (
        <div style={S.pricingDetail}>
          <p style={S.pricingDetailIntro}>{tier.detail.intro}</p>
          {tier.detail.sections.map(sec => (
            <div key={sec.title} style={S.pricingDetailSection}>
              <div style={S.pricingDetailTitle}>{sec.title}</div>
              {sec.items.map(item => (
                <div key={item} style={S.pricingDetailItem}>
                  <span style={S.pricingDetailDot} />
                  <span>{item}</span>
                </div>
              ))}
            </div>
          ))}
          {tier.detail.rubric && (
            <>
              <div style={{ ...S.pricingDetailTitle, marginTop: "14px" }}>Complexity guide</div>
              {tier.detail.rubric.map(r => (
                <div key={r.level} style={S.rubricLevel}>
                  <div style={S.rubricLevelName}>{r.level}</div>
                  <div style={S.rubricLevelItems}>
                    {r.items.map(item => (
                      <div key={item} style={S.pricingDetailItem}>
                        <span style={S.pricingDetailDot} />
                        <span>{item}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function PricingSection() {
  return (
    <section style={S.section}>
      <div style={S.sectionLabel}>{publicContent.pricing.title}</div>
      <p style={S.pricingSub}>{publicContent.pricing.subtext}</p>
      <div style={S.pricingGrid}>
        {publicContent.pricing.tiers.map(tier => (
          <PricingCard key={tier.label} tier={tier} />
        ))}
      </div>
      <p style={S.pricingFooter}>{publicContent.pricing.footer}</p>
    </section>
  );
}

function moduleHref(moduleId, isAuthenticated) {
  const target = `/dashboard?module=${moduleId}`;
  if (isAuthenticated) return target;
  return `/login?next=${encodeURIComponent(target)}`;
}

export default function WelcomePage({ isAuthenticated }) {
  const entryHref = isAuthenticated ? "/dashboard" : "/login";
  const entryLabel = isAuthenticated ? "Enter Platform" : "Log In";

  return (
    <div style={S.root}>
      {/* Nav: About Meridian → entry action */}
      <nav style={S.nav}>
        <div style={S.navBrand}>
          <MeridianMark size={26} color={palette.cobalt} bg={palette.lightBg} />
          <span style={S.navName}>{brand.name}</span>
        </div>
        <div style={S.navRight}>
          <a href="/about" style={S.navLink}>About</a>
          <a href={entryHref} style={S.navCta}>{entryLabel}</a>
        </div>
      </nav>

      {/* Hero: About Meridian → entry action (same order as nav) */}
      <section style={S.hero}>
        <MeridianMark size={48} color={palette.cobalt} bg={palette.lightBg} />
        <h1 style={S.heroTitle}>{publicContent.hero.headline}</h1>
        <p style={S.heroSub}>{publicContent.hero.subline}</p>
        <p style={S.heroTrust}>{publicContent.hero.trust}</p>
        <div style={S.heroCtas}>
          <a href="/about" style={S.ctaSecondary}>{publicContent.hero.ctaSecondary}</a>
          <a href={entryHref} style={S.ctaPrimary}>{entryLabel}</a>
        </div>
      </section>

      {/* Live Modules */}
      <section style={S.section}>
        <div style={S.sectionLabel}>{publicContent.modules.title}</div>
        <div style={S.moduleGrid}>
          {publicContent.modules.items.map(mod => (
            <a
              key={mod.id}
              href={moduleHref(mod.id, isAuthenticated)}
              style={S.moduleCard}
              onMouseEnter={e => {
                e.currentTarget.style.transform = "scale(1.02)";
                e.currentTarget.style.borderColor = "rgba(12,7,49,0.22)";
                e.currentTarget.style.boxShadow = "0 4px 20px rgba(12,7,49,0.06)";
              }}
              onMouseLeave={e => {
                e.currentTarget.style.transform = "scale(1)";
                e.currentTarget.style.borderColor = "rgba(12,7,49,0.12)";
                e.currentTarget.style.boxShadow = "0 0 0 1px rgba(12,7,49,0.04)";
              }}
            >
              <div style={S.moduleLabel}>{mod.label}</div>
              <div style={S.moduleLiveRow}><span style={S.liveDot} /><span style={S.moduleLiveText}>{mod.status}</span></div>
              <p style={S.moduleDesc}>{mod.desc}</p>
              <div style={{ flex: 1 }} />
              <span style={S.moduleCta}>
                {isAuthenticated ? "Enter Module →" : "Log In to Enter →"}
              </span>
            </a>
          ))}
        </div>
        {publicContent.modules.footer && (
          <p style={S.moduleFooter}>{publicContent.modules.footer}</p>
        )}
      </section>

      {/* Pricing */}
      <PricingSection />

      {/* Conversion */}
      <section style={S.conversionSection}>
        <div style={S.sectionLabel}>Get started</div>
        <div style={S.cGrid}>
          {[
            { t: publicContent.demo.title, d: publicContent.demo.desc, timing: publicContent.demo.timing, href: publicContent.demo.href, label: publicContent.demo.cta, primary: true },
            { t: publicContent.requestModule.title, d: publicContent.requestModule.desc, timing: publicContent.requestModule.timing, href: publicContent.requestModule.href, label: publicContent.requestModule.cta, primary: false },
          ].map((card, i) => (
            <div key={i} style={S.cCard}>
              <div style={S.cTitle}>{card.t}</div>
              <p style={S.cDesc}>{card.d}</p>
              {card.timing && <div style={S.cTiming}>{card.timing}</div>}
              <a href={card.href} style={card.primary ? S.cBtnPrimary : S.cBtnSecondary}>{card.label}</a>
            </div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer style={S.footer}>
        <span>{brand.name}</span>
        <span style={S.footerDim}>{brand.positioning}</span>
      </footer>
    </div>
  );
}

const S = {
  root: {
    minHeight: "100vh",
    background: palette.lightBg,
    color: palette.lightText,
    fontFamily: "'DM Sans', sans-serif",
    position: "relative",
  },

  // Nav
  nav: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "22px 44px",
  },
  navBrand: { display: "flex", alignItems: "center", gap: "10px" },
  navName: {
    fontFamily: "'Syne', sans-serif",
    fontSize: "15px",
    fontWeight: 700,
    letterSpacing: "0.04em",
    color: palette.lightText,
  },
  navRight: { display: "flex", alignItems: "center", gap: "22px" },
  navLink: {
    fontSize: "14px",
    fontWeight: 500,
    color: palette.lightText,
    textDecoration: "none",
    opacity: 0.7,
  },
  navCta: {
    fontSize: "14px",
    fontWeight: 600,
    color: "#fff",
    textDecoration: "none",
    padding: "9px 20px",
    borderRadius: "8px",
    background: palette.cobalt,
  },

  // Hero
  hero: {
    textAlign: "center",
    padding: "72px 44px 48px",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
  },
  heroTitle: {
    fontFamily: "'Syne', sans-serif",
    fontSize: "52px",
    fontWeight: 800,
    letterSpacing: "-0.025em",
    color: palette.lightText,
    margin: "22px 0 16px",
    lineHeight: 1.08,
  },
  heroSub: {
    fontSize: "18px",
    color: palette.lightText,
    opacity: 0.65,
    maxWidth: "460px",
    margin: "0 auto 36px",
    lineHeight: 1.6,
  },
  heroTrust: {
    fontSize: "14px",
    color: palette.lightText,
    opacity: 0.55,
    maxWidth: "420px",
    margin: "0 auto 28px",
    lineHeight: 1.5,
  },
  heroCtas: { display: "flex", gap: "14px", justifyContent: "center" },
  ctaPrimary: {
    display: "inline-block",
    fontSize: "15px",
    fontWeight: 600,
    color: "#fff",
    background: palette.cobalt,
    padding: "12px 28px",
    borderRadius: "8px",
    textDecoration: "none",
    letterSpacing: "0.01em",
  },
  ctaSecondary: {
    display: "inline-block",
    fontSize: "15px",
    fontWeight: 500,
    color: palette.cobalt,
    padding: "12px 28px",
    borderRadius: "8px",
    border: `1px solid ${palette.lightCyanBorder}`,
    background: palette.lightCyanBg,
    textDecoration: "none",
  },

  // Sections
  section: {
    maxWidth: "740px",
    margin: "0 auto",
    padding: "40px 44px 20px",
  },
  sectionLabel: {
    fontSize: "12px",
    fontWeight: 700,
    letterSpacing: "0.12em",
    color: palette.cobalt,
    textTransform: "uppercase",
    marginBottom: "20px",
  },

  // Module cards
  moduleGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "18px", alignItems: "stretch" },
  moduleCard: {
    display: "flex",
    flexDirection: "column",
    padding: "26px",
    background: palette.lightSurface,
    border: "1px solid rgba(12,7,49,0.12)",
    boxShadow: "0 0 0 1px rgba(12,7,49,0.04)",
    borderRadius: "12px",
    textDecoration: "none",
    textAlign: "center",
    color: "inherit",
    cursor: "pointer",
    transition: "transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease",
  },
  moduleLabel: {
    fontFamily: "'Syne', sans-serif",
    fontSize: "18px",
    fontWeight: 700,
    color: palette.lightText,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    textAlign: "center",
    marginBottom: "6px",
  },
  moduleLiveRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "5px",
    marginBottom: "12px",
  },
  moduleLiveText: {
    fontSize: "9px",
    fontWeight: 700,
    letterSpacing: "0.1em",
    color: palette.cobalt,
  },
  liveDot: {
    width: "5px",
    height: "5px",
    borderRadius: "50%",
    background: palette.cobalt,
  },
  moduleDesc: {
    fontSize: "14px",
    color: palette.lightText,
    opacity: 0.68,
    lineHeight: 1.65,
    margin: "0 0 16px",
  },
  moduleFooter: {
    fontSize: "13px",
    color: palette.midnight,
    opacity: 0.50,
    textAlign: "center",
    marginTop: "16px",
    lineHeight: 1.5,
  },
  moduleCta: {
    fontSize: "13px",
    fontWeight: 600,
    color: palette.midnight,
    letterSpacing: "0.01em",
  },

  // Conversion
  conversionSection: {
    maxWidth: "740px",
    margin: "0 auto",
    padding: "48px 44px 72px",
  },
  conversionGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "18px",
    alignItems: "stretch",
  },
  // ── Conversion cards: top-aligned stack, no centering ──
  cGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "18px",
  },
  cCard: {
    padding: "28px 28px 26px",
    background: palette.lightSurface,
    border: "1px solid rgba(12,7,49,0.12)",
    boxShadow: "0 0 0 1px rgba(12,7,49,0.04)",
    borderRadius: "12px",
    textAlign: "center",
  },
  cTitle: {
    fontFamily: "'Syne', sans-serif",
    fontSize: "17px",
    fontWeight: 700,
    letterSpacing: "0.01em",
    lineHeight: 1.3,
    color: palette.midnight,
    marginBottom: "8px",
    textTransform: "uppercase",
  },
  cDesc: {
    fontSize: "14px",
    color: palette.midnight,
    opacity: 0.72,
    lineHeight: 1.7,
    margin: "0 auto 16px",
    maxWidth: "240px",
  },
  cTiming: {
    fontSize: "12px",
    fontFamily: "'JetBrains Mono', monospace",
    color: palette.midnight,
    opacity: 0.4,
    marginBottom: "14px",
    letterSpacing: "0.02em",
  },

  // Pricing
  pricingSub: {
    fontSize: "15px",
    color: palette.midnight,
    opacity: 0.68,
    lineHeight: 1.65,
    margin: "0 0 20px",
    maxWidth: "500px",
  },
  pricingGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "18px",
    marginBottom: "16px",
  },
  pricingTier: {
    padding: "22px 24px",
    background: palette.lightSurface,
    border: "1px solid rgba(12,7,49,0.12)",
    boxShadow: "0 0 0 1px rgba(12,7,49,0.04)",
    borderRadius: "10px",
  },
  pricingTierLabel: {
    fontFamily: "'Syne', sans-serif",
    fontSize: "15px",
    fontWeight: 700,
    color: palette.midnight,
    marginBottom: "12px",
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    textAlign: "center",
  },
  pricingRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "baseline",
    marginBottom: "6px",
  },
  pricingKey: {
    fontSize: "13px",
    color: palette.midnight,
    opacity: 0.5,
  },
  pricingValue: {
    fontSize: "14px",
    fontWeight: 600,
    fontFamily: "'JetBrains Mono', monospace",
    color: palette.midnight,
  },
  pricingDetailBtn: {
    display: "block",
    width: "100%",
    fontSize: "12px",
    fontWeight: 500,
    color: palette.cobalt,
    background: "transparent",
    border: `1px solid ${palette.lightCyanBorder}`,
    borderRadius: "6px",
    padding: "7px 0",
    cursor: "pointer",
    letterSpacing: "0.02em",
    textAlign: "center",
  },
  rubricLevel: {
    marginBottom: "8px",
  },
  rubricLevelName: {
    fontSize: "13px",
    fontWeight: 600,
    color: palette.midnight,
    marginBottom: "4px",
  },
  rubricLevelItems: {
    paddingLeft: "2px",
  },
  pricingDetail: {
    marginTop: "14px",
    paddingTop: "14px",
    borderTop: `1px solid ${palette.lightBorder}`,
  },
  pricingDetailIntro: {
    fontSize: "13px",
    color: palette.midnight,
    opacity: 0.6,
    lineHeight: 1.6,
    margin: "0 0 12px",
  },
  pricingDetailSection: {
    marginBottom: "10px",
  },
  pricingDetailTitle: {
    fontSize: "11px",
    fontWeight: 700,
    letterSpacing: "0.08em",
    color: palette.midnight,
    opacity: 0.45,
    textTransform: "uppercase",
    marginBottom: "6px",
  },
  pricingDetailItem: {
    display: "flex",
    alignItems: "baseline",
    gap: "8px",
    fontSize: "13px",
    color: palette.midnight,
    opacity: 0.6,
    lineHeight: 1.5,
    marginBottom: "3px",
  },
  pricingDetailDot: {
    width: "3px",
    height: "3px",
    borderRadius: "50%",
    background: palette.cobalt,
    opacity: 0.4,
    flexShrink: 0,
    marginTop: "7px",
  },
  pricingFooter: {
    fontSize: "13px",
    color: palette.midnight,
    opacity: 0.45,
    margin: 0,
  },

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
  cBtnSecondary: {
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

  // Footer
  footer: {
    textAlign: "center",
    padding: "28px 44px",
    fontSize: "13px",
    color: palette.lightTextTertiary,
    display: "flex",
    justifyContent: "center",
    gap: "16px",
    borderTop: `1px solid ${palette.lightBorder}`,
  },
  footerDim: { color: palette.lightTextDim },
};
