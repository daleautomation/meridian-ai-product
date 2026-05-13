import {
  attributionSignals,
  intelligenceLayerLinks,
  platformModules,
} from "@/content/public/home";
import { SectionIntro } from "@/components/public/ui/SectionIntro";

export function PlatformSection() {
  return (
    <section id="platform" className="public-section">
      <SectionIntro
        eyebrow="Meridian Intelligence Layer"
        title="Infrastructure that turns audit signals into accountable execution."
        text="Meridian connects diagnostics, workflow rules, operator ownership, and reporting so the system shows what moved, what leaked, and what should happen next."
      />
      <div className="public-intelligence-layer" aria-label="Meridian intelligence layer diagram">
        <div className="public-intelligence-core">
          <span>Meridian OS</span>
          <strong>{"Signal -> Workflow -> Execution -> Attribution"}</strong>
          <p>
            A shared intelligence layer that keeps audits, workspaces, operators,
            and reports aligned around real next actions.
          </p>
        </div>
        <div className="public-intelligence-links">
          {intelligenceLayerLinks.map((link) => (
            <article key={link.title}>
              <span>{link.output}</span>
              <strong>{link.title}</strong>
              <p>{link.text}</p>
            </article>
          ))}
        </div>
        <div className="public-attribution-feed">
          <div className="public-console-header">
            <span>System proof</span>
            <strong>Attribution trail</strong>
          </div>
          {attributionSignals.map((signal) => (
            <div className="public-attribution-signal" key={signal}>
              <span className="public-live-dot" />
              {signal}
            </div>
          ))}
        </div>
      </div>
      <div className="public-module-grid">
        {platformModules.map((module) => (
          <div key={module.title}>
            <span />
            <strong>{module.title}</strong>
            <p>{module.text}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
