import { SectionCta } from "@/components/public/ui/SectionCta";
import {
  ROOFING_DEMO_HREF,
  roofingFutureSignals,
  roofingIntelligenceSignals,
  SHOWCASE_HREF,
} from "@/content/public/home";

export function RoofingIntelligenceSection() {
  return (
    <section id="roofing-intelligence" className="public-section public-split-section public-roofing-section">
      <div>
        <span className="public-eyebrow">One showcase example</span>
        <h2>Roofing is one clear demo of the larger relationship recovery system.</h2>
        <p>
          A roofing estimate that goes quiet is easy to understand: the
          relationship is warm, the revenue is exposed, and the next action
          matters. Meridian uses the same logic across many relationship-heavy
          businesses.
        </p>
        <div className="public-pill-row">
          {roofingFutureSignals.map((signal) => (
            <span key={signal}>{signal}</span>
          ))}
        </div>
      </div>
      <div className="public-roofing-intel-panel" aria-label="Roofing intelligence signals">
        <div className="public-preview-header public-preview-header-live">
          <span>Example workflow</span>
          <strong>
            <span className="public-live-dot" />
            Showcase-ready
          </strong>
        </div>
        <div className="public-roofing-signal-grid">
          {roofingIntelligenceSignals.map((signal) => (
            <article className="public-roofing-signal-card" key={signal.title}>
              <span>{signal.title}</span>
              <p>{signal.text}</p>
            </article>
          ))}
        </div>
        <div className="public-roofing-roadmap-note">
          <strong>Roofing does not define Meridian.</strong>
          <p>
            It remains a useful vertical example for stale estimate recovery,
            while the company positioning centers on relationships, revenue,
            clarity, and execution.
          </p>
        </div>
      </div>
      <SectionCta
        eyebrow="Example demo"
        text="Open the broader showcase library or request a focused roofing recovery demo if that is the workflow you need to explain."
        primaryHref={SHOWCASE_HREF}
        primaryLabel="View Showcase"
        secondaryHref={ROOFING_DEMO_HREF}
        secondaryLabel="Request Roofing Demo"
      />
    </section>
  );
}
