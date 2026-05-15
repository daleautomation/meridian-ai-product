import { SectionCta } from "@/components/public/ui/SectionCta";
import { SectionIntro } from "@/components/public/ui/SectionIntro";
import {
  REQUEST_WORKSPACE_HREF,
  showcaseHomepageCards,
  showcasePreviewRows,
  SHOWCASE_HREF,
} from "@/content/public/home";

export function ShowcaseIntegrationSection() {
  return (
    <section id="showcase-engine" className="public-section public-split-section">
      <div>
        <SectionIntro
          eyebrow="Showcase demo system"
          title="See Meridian applied to your workflow."
          text="The showcase library turns relationship-priority workspaces into clean, cinematic demos for sales, outreach, onboarding, and vertical positioning."
        />
        <div className="public-showcase-card-grid">
          {showcaseHomepageCards.map((card) => (
            <article className="public-showcase-card" key={card.title}>
              <h3>{card.title}</h3>
              <p>{card.text}</p>
            </article>
          ))}
        </div>
      </div>
      <div className="public-showcase-preview" aria-label="Showcase system preview">
        <div className="public-preview-header public-preview-header-live">
          <span>Screen-recording-safe demo flow</span>
          <strong>Clean showcase routes</strong>
        </div>
        <div className="public-showcase-frame">
          {showcasePreviewRows.map((row) => (
            <article key={row.label}>
              <span>{row.label}</span>
              <strong>{row.title}</strong>
            </article>
          ))}
        </div>
        <div className="public-panel-footer">
          <span className="public-live-dot" />
          <a href={SHOWCASE_HREF}>Open the Meridian showcase library</a>
        </div>
      </div>
      <SectionCta
        eyebrow="Showcase library"
        text="Open clean branded demos with vertical overlays, before/after panels, and the relationship-priority story already framed."
        primaryHref={SHOWCASE_HREF}
        primaryLabel="View Showcase"
        secondaryHref={REQUEST_WORKSPACE_HREF}
        secondaryLabel="Request Demo System"
      />
    </section>
  );
}
