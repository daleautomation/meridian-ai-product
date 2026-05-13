import { SectionIntro } from "@/components/public/ui/SectionIntro";
import { SectionCta } from "@/components/public/ui/SectionCta";
import {
  audienceCards,
  REQUEST_DEMO_HREF,
  START_AUDIT_HREF,
} from "@/content/public/home";

export function AudienceSection() {
  return (
    <section id="who-for" className="public-section">
      <SectionIntro
        eyebrow="Who Meridian is for"
        title="For teams that need execution to feel visible, owned, and calm."
        text="Meridian is built for operators who already have demand, moving parts, and accountability pressure, but need a clearer system for turning signal into completed work."
      />
      <div className="public-audience-grid">
        {audienceCards.map((audience) => (
          <article className="public-audience-card" key={audience.title}>
            <h3>{audience.title}</h3>
            <div>
              <span>Pain</span>
              <p>{audience.pain}</p>
            </div>
            <div>
              <span>Meridian fixes</span>
              <p>{audience.fix}</p>
            </div>
            <div>
              <span>Workspace becomes</span>
              <p>{audience.becomes}</p>
            </div>
          </article>
        ))}
      </div>
      <SectionCta
        eyebrow="Audience fit"
        text="If your team has real workflow complexity, start by mapping where execution is leaking."
        primaryHref={START_AUDIT_HREF}
        primaryLabel="Start Audit"
        secondaryHref={REQUEST_DEMO_HREF}
        secondaryLabel="Request Demo"
      />
    </section>
  );
}
