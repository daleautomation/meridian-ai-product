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
        <span className="public-eyebrow">Relationship prioritization and execution</span>
        <h1>Know who to contact today, why they matter, and what to do next.</h1>
        <p>
          Meridian turns existing contacts, stale opportunities, and scattered
          CRM notes into a clean operator queue for relationship recovery,
          follow-up execution, and faster decisions.
        </p>
        <div className="public-hero-actions">
          <a className="public-primary-button" href={EXPLORE_SYSTEMS_HREF}>
            See Priority Workflow
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
          <span>Relationship Priority Queue</span>
          <strong>Today&apos;s operator view</strong>
        </div>
        <div className="public-workspace-chrome">
          <span />
          <span />
          <span />
          <strong>Recovery desk</strong>
        </div>
        <div className="public-command-grid">
          <div className="public-signal-card public-signal-card-primary">
            <span>Who matters today</span>
            <strong>High-fit relationship, stale opportunity</strong>
            <p>Market fit, urgency, contact path, recommended angle, and next step compressed into one action card.</p>
            <div className="public-score-bar" aria-hidden="true">
              <span />
            </div>
          </div>
          <div className="public-command-rail">
            <span>Next move</span>
            <strong>Call first</strong>
            <p>Recovery angle ready</p>
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
          <a href={ROOFING_INTELLIGENCE_HREF}>Roofing recovery workflow mapped from priority to execution</a>
        </div>
      </div>
    </section>
  );
}
