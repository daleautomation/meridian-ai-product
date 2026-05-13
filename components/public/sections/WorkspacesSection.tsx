import { workspaceAudiences, workspaceExamples } from "@/content/public/home";

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
      <div className="public-example-stack">
        {workspaceExamples.map((example) => (
          <div key={example}>
            <span className="public-live-dot" />
            {example}
          </div>
        ))}
      </div>
    </section>
  );
}
