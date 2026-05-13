import {
  heroMetrics,
  heroQueue,
  REQUEST_DEMO_HREF,
  START_AUDIT_HREF,
} from "@/content/public/home";

export function HeroSection() {
  return (
    <section className="public-hero">
      <div className="public-hero-copy">
        <span className="public-eyebrow">Operator-first infrastructure</span>
        <h1>Custom AI workspaces for businesses that need execution clarity.</h1>
        <p>
          Meridian AI audits real workflows, identifies revenue leaks, and
          builds operator-grade workspaces that turn signal into owned,
          trackable execution.
        </p>
        <div className="public-hero-actions">
          <a className="public-primary-button" href={START_AUDIT_HREF}>
            Start with an Audit
          </a>
          <a className="public-secondary-button" href={REQUEST_DEMO_HREF}>
            Request a Workspace Demo
          </a>
        </div>
        <div className="public-hero-proof" aria-label="Meridian operating loop">
          <span>Built from real operational workflows</span>
          <span>Every workspace is custom-built</span>
          <span>Designed around execution</span>
        </div>
      </div>
      <div className="public-hero-panel" aria-label="Meridian platform preview">
        <div className="public-panel-orb public-panel-orb-one" />
        <div className="public-panel-orb public-panel-orb-two" />
        <div className="public-panel-topline">
          <span>Meridian command workspace</span>
          <strong>Live operating view</strong>
        </div>
        <div className="public-workspace-chrome">
          <span />
          <span />
          <span />
          <strong>Operator desk</strong>
        </div>
        <div className="public-command-grid">
          <div className="public-signal-card public-signal-card-primary">
            <span>Lead quality</span>
            <strong>High-intent accounts first</strong>
            <p>Score, route, and prepare outreach from one execution queue.</p>
            <div className="public-score-bar" aria-hidden="true">
              <span />
            </div>
          </div>
          <div className="public-command-rail">
            <span>System status</span>
            <strong>Ready</strong>
            <p>3 briefs prepared</p>
          </div>
        </div>
        <div className="public-hero-metrics">
          {heroMetrics.map((metric) => (
            <div key={metric.label}>
              <span>{metric.label}</span>
              <strong>{metric.value}</strong>
              <p>{metric.detail}</p>
            </div>
          ))}
        </div>
        <div className="public-queue-stack">
          {heroQueue.map((item) => (
            <article key={item.label}>
              <span>{item.label}</span>
              <strong>{item.title}</strong>
              <p>{item.meta}</p>
            </article>
          ))}
        </div>
        <div className="public-panel-footer">
          <span className="public-live-dot" />
          Audit insight converted to operator workflow
        </div>
      </div>
    </section>
  );
}
