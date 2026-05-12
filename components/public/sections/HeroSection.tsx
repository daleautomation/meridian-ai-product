import { REQUEST_DEMO_HREF, START_AUDIT_HREF } from "@/content/public/home";

export function HeroSection() {
  return (
    <section className="public-hero">
      <div className="public-hero-copy">
        <span className="public-eyebrow">Operator-grade intelligence</span>
        <h1>Operator-grade intelligence systems for modern businesses.</h1>
        <p>
          Meridian AI audits your operation, identifies revenue leaks, and
          builds custom AI-powered workspaces that help your team know what to
          do next.
        </p>
        <div className="public-hero-actions">
          <a className="public-primary-button" href={START_AUDIT_HREF}>
            Start with an Audit
          </a>
          <a className="public-secondary-button" href={REQUEST_DEMO_HREF}>
            Request a Workspace Demo
          </a>
        </div>
      </div>
      <div className="public-hero-panel" aria-label="Meridian platform preview">
        <div className="public-panel-topline">
          <span>Meridian workspace</span>
          <strong>Live operating view</strong>
        </div>
        <div className="public-signal-card public-signal-card-primary">
          <span>Lead quality</span>
          <strong>High-intent accounts first</strong>
          <p>Score, route, and prepare outreach from one execution queue.</p>
        </div>
        <div className="public-panel-grid">
          {["Revenue leaks", "Call plan", "Owner", "Next action"].map((item) => (
            <div key={item}>
              <span>{item}</span>
              <strong>{item === "Owner" ? "Assigned" : "Ready"}</strong>
            </div>
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
