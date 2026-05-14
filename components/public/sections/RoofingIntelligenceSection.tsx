import { SectionCta } from "@/components/public/ui/SectionCta";
import {
  REQUEST_WORKSPACE_HREF,
  roofingFutureSignals,
  roofingIntelligenceSignals,
  VISIBILITY_SCAN_HREF,
} from "@/content/public/home";

export function RoofingIntelligenceSection() {
  return (
    <section id="roofing-intelligence" className="public-section public-split-section public-roofing-section">
      <div>
        <span className="public-eyebrow">Roofing intelligence</span>
        <h2>Roofing growth will be won through property signals, local visibility, and execution speed.</h2>
        <p>
          Meridian is positioning roofing intelligence as contractor growth
          infrastructure: a way to connect property context, local opportunity,
          lead quality, follow-up, and operating workflows without pretending
          future data integrations are already live.
        </p>
        <div className="public-pill-row">
          {roofingFutureSignals.map((signal) => (
            <span key={signal}>{signal}</span>
          ))}
        </div>
      </div>
      <div className="public-roofing-intel-panel" aria-label="Roofing intelligence signals">
        <div className="public-preview-header public-preview-header-live">
          <span>Conceptual roadmap</span>
          <strong>
            <span className="public-live-dot" />
            No fake functionality
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
          <strong>Future integrations are directional.</strong>
          <p>
            Satellite imagery, storm intelligence, property signals, and local
            opportunity detection are framed as infrastructure targets, not
            live claims.
          </p>
        </div>
      </div>
      <SectionCta
        eyebrow="Roofing path"
        text="Start with a visibility scan or request a roofing workspace that turns lead signal into execution."
        primaryHref={VISIBILITY_SCAN_HREF}
        primaryLabel="Get a Visibility Scan"
        secondaryHref={REQUEST_WORKSPACE_HREF}
        secondaryLabel="Request Roofing Workspace"
      />
    </section>
  );
}
