import { SectionCta } from "@/components/public/ui/SectionCta";
import {
  executionQueuePreview,
  liveSystemsProof,
  operatorWorkspaceStats,
  REQUEST_WORKSPACE_HREF,
  VISIBILITY_SCAN_HREF,
} from "@/content/public/home";

export function LiveSystemsSection() {
  return (
    <section id="live-systems" className="public-section public-split-section">
      <div>
        <span className="public-eyebrow">Execution layer proof</span>
        <h2>Meridian keeps the engine underneath and compresses the operator surface.</h2>
        <p>
          Relationship memory, scheduling context, queue ordering, and workflow
          continuity remain intact. Operators only see the priority, reason,
          contact path, and next action they need to move.
        </p>
        <div className="public-live-system-grid">
          {liveSystemsProof.map((system) => (
            <article className="public-live-system-card" key={system.title}>
              <span>{system.proof}</span>
              <h3>{system.title}</h3>
              <p>{system.text}</p>
            </article>
          ))}
        </div>
      </div>
      <div className="public-operator-preview" aria-label="Live system proof preview">
        <div className="public-preview-header public-preview-header-live">
          <span>Relationship execution patterns</span>
          <strong>
            <span className="public-live-dot" />
            In production
          </strong>
        </div>
        <div className="public-workspace-stat-grid">
          {operatorWorkspaceStats.map((stat) => (
            <article key={stat.label}>
              <span>{stat.label}</span>
              <strong>{stat.value}</strong>
              <p>{stat.detail}</p>
            </article>
          ))}
        </div>
        <div className="public-execution-panel">
          <div className="public-console-header">
            <span>Priority queue</span>
            <strong>Who, why, action</strong>
          </div>
          <div className="public-execution-list">
            {executionQueuePreview.map((item) => (
              <article key={`${item.time}-${item.title}`}>
                <time>{item.time}</time>
                <div>
                  <strong>{item.title}</strong>
                  <p>{item.detail}</p>
                  <span>{item.owner}</span>
                </div>
                <em>{item.status}</em>
              </article>
            ))}
          </div>
        </div>
      </div>
      <SectionCta
        eyebrow="Relationship execution"
        text="See how Meridian can sit above your CRM, prioritize relationships, and simplify follow-up without hiding workflow continuity."
        primaryHref={REQUEST_WORKSPACE_HREF}
        primaryLabel="Request Workspace"
        secondaryHref={VISIBILITY_SCAN_HREF}
        secondaryLabel="Get a Priority Scan"
      />
    </section>
  );
}
