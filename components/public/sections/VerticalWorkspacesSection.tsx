import { SectionCta } from "@/components/public/ui/SectionCta";
import { SectionIntro } from "@/components/public/ui/SectionIntro";
import {
  REQUEST_WORKSPACE_HREF,
  SHOWCASE_HREF,
  verticalWorkspaces,
  workspacePositioning,
} from "@/content/public/home";

export function VerticalWorkspacesSection() {
  return (
    <section id="vertical-workspaces" className="public-section">
      <SectionIntro
        eyebrow="Single-user vs shared workspaces"
        title="Meridian separates personal execution from team coordination."
        text="Some businesses need one operator to know who to contact today. Others need a shared workspace where relationship ownership, routing, and recovery work stay visible."
      />
      <div className="public-workspace-positioning-grid">
        {workspacePositioning.map((workspace) => (
          <article className="public-workspace-positioning-card" key={workspace.title}>
            <span>{workspace.title}</span>
            <h3>{workspace.subtitle}</h3>
            <p>{workspace.description}</p>
            <ul>
              {workspace.examples.map((example) => (
                <li key={example}>{example}</li>
              ))}
            </ul>
          </article>
        ))}
      </div>
      <div className="public-workspace-ladder-grid">
        {verticalWorkspaces.map((workspace) => (
          <article className="public-workspace-ladder-card" key={workspace.title}>
            <span>{workspace.industry}</span>
            <h3>{workspace.title}</h3>
            <p>{workspace.text}</p>
            <ul>
              {workspace.capabilities.map((capability) => (
                <li key={capability}>{capability}</li>
              ))}
            </ul>
          </article>
        ))}
      </div>
      <SectionCta
        eyebrow="Workspace request"
        text="Request the workspace closest to your current relationship bottleneck, then Meridian maps the workflow around real execution."
        primaryHref={REQUEST_WORKSPACE_HREF}
        primaryLabel="Request Workspace"
        secondaryHref={SHOWCASE_HREF}
        secondaryLabel="View Showcase"
      />
    </section>
  );
}
