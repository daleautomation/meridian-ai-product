import {
  EXPLORE_SYSTEMS_HREF,
  heroMetrics,
  heroQueue,
  productLadder,
  REQUEST_WORKSPACE_HREF,
  SHOWCASE_HREF,
} from "@/content/public/home";

export function HeroSection() {
  return (
    <section className="public-hero">
      <div className="public-hero-copy">
        <span className="public-eyebrow">Relationship priority for revenue growth</span>
        <h1>Turn relationship chaos into revenue clarity.</h1>
        <p>
          Your business already has leads, referrals, estimates, contacts, and
          warm conversations. Meridian shows which relationships matter most,
          which revenue is at risk, and what should happen next.
        </p>
        <div className="public-hero-actions">
          <a className="public-primary-button" href={EXPLORE_SYSTEMS_HREF}>
            Explore Solutions
          </a>
          <a className="public-secondary-button" href={SHOWCASE_HREF}>
            View Showcase
          </a>
          <a className="public-secondary-button" href={REQUEST_WORKSPACE_HREF}>
            Request Workspace
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
          <strong>Today&apos;s revenue clarity</strong>
        </div>
        <div className="public-workspace-chrome">
          <span />
          <span />
          <span />
          <strong>Operator desk</strong>
        </div>
        <div className="public-command-grid">
          <div className="public-signal-card public-signal-card-primary">
            <span>Who deserves attention</span>
            <strong>Warm relationship with revenue at risk</strong>
            <p>Context, timing, risk, contact path, and next action compressed into one calm operator card.</p>
            <div className="public-score-bar" aria-hidden="true">
              <span />
            </div>
          </div>
          <div className="public-command-rail">
            <span>Next move</span>
            <strong>Act today</strong>
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
          <a href={SHOWCASE_HREF}>See Meridian applied to real workflows in the showcase library</a>
        </div>
      </div>
    </section>
  );
}
