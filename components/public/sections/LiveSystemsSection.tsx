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
        <span className="public-eyebrow">Live systems / proof</span>
        <h2>Meridian is already being shaped by real operational workflows.</h2>
        <p>
          The public site now points at the proof base: LaborTech workspace
          patterns, execution queues, scheduling intelligence, and relationship
          engine concepts that make operator work visible.
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
          <span>LaborTech / operational patterns</span>
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
            <span>Execution queue</span>
            <strong>Scheduling + follow-up state</strong>
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
        eyebrow="Operational proof"
        text="See how a live operator system can map your scheduling, relationship, follow-up, and execution workflow."
        primaryHref={REQUEST_WORKSPACE_HREF}
        primaryLabel="Request Workspace"
        secondaryHref={VISIBILITY_SCAN_HREF}
        secondaryLabel="Get a Visibility Scan"
      />
    </section>
  );
}
