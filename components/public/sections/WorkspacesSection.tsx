import {
  deepReportPreview,
  executionQueuePreview,
  followUpProgression,
  leadQueuePreview,
  operatorWorkspaceStats,
  workspaceAudiences,
  workspaceExamples,
  workspacePreviewCards,
} from "@/content/public/home";

export function WorkspacesSection() {
  return (
    <section id="workspaces" className="public-section public-split-section">
      <div>
        <span className="public-eyebrow">Workspaces</span>
        <h2>Personalized command centers for teams that execute.</h2>
        <p>
          Meridian workspaces are built around the way each business sells,
          services clients, tracks ownership, and measures outcomes.
        </p>
        <div className="public-pill-row">
          {workspaceAudiences.map((audience) => (
            <span key={audience}>{audience}</span>
          ))}
        </div>
      </div>
      <div className="public-operator-preview" aria-label="Workspace preview cards">
        <div className="public-preview-header public-preview-header-live">
          <span>Demo workspace / synthetic data</span>
          <strong>
            <span className="public-live-dot" />
            Live operator view
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
        <div className="public-workspace-console">
          <div className="public-lead-queue-panel">
            <div className="public-console-header">
              <span>Lead queue</span>
              <strong>Ranked by closeability</strong>
            </div>
            <div className="public-lead-queue-list">
              {leadQueuePreview.map((lead) => (
                <article key={lead.company} className="public-lead-row">
                  <div>
                    <span>{lead.request}</span>
                    <strong>{lead.company}</strong>
                    <p>{lead.signal}</p>
                  </div>
                  <div className="public-lead-score" aria-label={`${lead.score} closeability score`}>
                    {lead.score}
                  </div>
                  <div className="public-lead-owner">
                    <span>{lead.owner}</span>
                    <strong>{lead.state}</strong>
                    <p>{lead.nextAction}</p>
                  </div>
                </article>
              ))}
            </div>
          </div>

          <article className="public-deep-report-card" aria-label="Deep Report preview">
            <div className="public-deep-report-topline">
              <span>{deepReportPreview.title}</span>
              <strong>{deepReportPreview.severity}</strong>
            </div>
            <h3>{deepReportPreview.subtitle}</h3>
            <p>{deepReportPreview.summary}</p>
            <div className="public-deep-report-findings">
              {deepReportPreview.findings.map((finding) => (
                <div key={finding.label}>
                  <span>{finding.label}</span>
                  <strong>{finding.value}</strong>
                  <p>{finding.detail}</p>
                </div>
              ))}
            </div>
            <ul className="public-deep-report-actions">
              {deepReportPreview.actions.map((action) => (
                <li key={action}>{action}</li>
              ))}
            </ul>
          </article>

          <div className="public-execution-panel">
            <div className="public-console-header">
              <span>Today's execution queue</span>
              <strong>Call plan + follow-up state</strong>
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
            <div className="public-followup-progression" aria-label="Follow-up state progression">
              {followUpProgression.map((state, index) => (
                <span key={state} data-active={index < followUpProgression.length - 1}>
                  {state}
                </span>
              ))}
            </div>
          </div>
        </div>
        <div className="public-preview-card-grid public-preview-card-grid-compact">
          {workspacePreviewCards.slice(0, 3).map((card) => (
            <article key={card.title}>
              <span>{card.title}</span>
              <strong>{card.value}</strong>
              <p>{card.text}</p>
            </article>
          ))}
        </div>
        <div className="public-example-stack">
          {workspaceExamples.map((example) => (
            <div key={example}>
              <span className="public-live-dot" />
              {example}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
