import {
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
        <div className="public-preview-header">
          <span>Private workspace examples</span>
          <strong>Operator view</strong>
        </div>
        <div className="public-preview-card-grid">
          {workspacePreviewCards.map((card) => (
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
