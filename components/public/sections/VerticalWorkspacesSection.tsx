import { SectionCta } from "@/components/public/ui/SectionCta";
import { SectionIntro } from "@/components/public/ui/SectionIntro";
import {
  REQUEST_WORKSPACE_HREF,
  ROOFING_INTELLIGENCE_HREF,
  verticalWorkspaces,
} from "@/content/public/home";

export function VerticalWorkspacesSection() {
  return (
    <section id="vertical-workspaces" className="public-section">
      <SectionIntro
        eyebrow="Vertical workspaces"
        title="Operator systems built for specific industries."
        text="These are not generic software projects. Each workspace packages the operating logic, queues, visibility, and follow-up rhythm a service business needs to execute."
      />
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
        text="Request the operator workspace closest to your current revenue bottleneck, then Meridian maps the workflow around real execution."
        primaryHref={REQUEST_WORKSPACE_HREF}
        primaryLabel="Request Workspace"
        secondaryHref={ROOFING_INTELLIGENCE_HREF}
        secondaryLabel="See Roofing Intelligence"
      />
    </section>
  );
}
