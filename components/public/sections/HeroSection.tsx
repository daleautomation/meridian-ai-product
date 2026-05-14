import {
  BOOK_STRATEGY_CALL_HREF,
  EXPLORE_SYSTEMS_HREF,
  heroMetrics,
  heroQueue,
  productLadder,
  REQUEST_WORKSPACE_HREF,
  ROOFING_INTELLIGENCE_HREF,
} from "@/content/public/home";

export function HeroSection() {
  return (
    <section className="public-hero">
      <div className="public-hero-copy">
        <span className="public-eyebrow">Operator-grade growth and intelligence systems</span>
        <h1>Growth systems for service businesses that need revenue execution, not more noise.</h1>
        <p>
          Meridian builds fast monetizable tools, vertical operator workspaces,
          and roofing intelligence infrastructure for teams that sell from lead
          quality, local visibility, follow-up, and operational clarity.
        </p>
        <div className="public-hero-actions">
          <a className="public-primary-button" href={EXPLORE_SYSTEMS_HREF}>
            Explore Systems
          </a>
          <a className="public-secondary-button" href={REQUEST_WORKSPACE_HREF}>
            Request Workspace
          </a>
          <a className="public-secondary-button" href={BOOK_STRATEGY_CALL_HREF}>
            Book Strategy Call
          </a>
        </div>
        <div className="public-hero-proof" aria-label="Meridian operating loop">
          {productLadder.map((item) => (
            <span key={item}>{item}</span>
          ))}
        </div>
      </div>
      <div className="public-hero-panel" aria-label="Meridian platform preview">
        <div className="public-panel-orb public-panel-orb-one" />
        <div className="public-panel-orb public-panel-orb-two" />
        <div className="public-panel-topline">
          <span>Meridian product ladder</span>
          <strong>Operator growth view</strong>
        </div>
        <div className="public-workspace-chrome">
          <span />
          <span />
          <span />
          <strong>Growth desk</strong>
        </div>
        <div className="public-command-grid">
          <div className="public-signal-card public-signal-card-primary">
            <span>Lead intelligence</span>
            <strong>Visibility becomes owned revenue work</strong>
            <p>Scan demand, rank opportunities, prepare follow-up, and keep action attached to an operator.</p>
            <div className="public-score-bar" aria-hidden="true">
              <span />
            </div>
          </div>
          <div className="public-command-rail">
            <span>System status</span>
            <strong>Field-ready</strong>
            <p>Tools, workspaces, and proof</p>
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
          <a href={ROOFING_INTELLIGENCE_HREF}>Roofing intelligence path mapped without claiming future integrations are live</a>
        </div>
      </div>
    </section>
  );
}
