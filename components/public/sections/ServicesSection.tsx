import { SectionIntro } from "@/components/public/ui/SectionIntro";
import { SectionCta } from "@/components/public/ui/SectionCta";
import {
  REQUEST_DEMO_HREF,
  services,
  START_AUDIT_HREF,
} from "@/content/public/home";

export function ServicesSection() {
  return (
    <section id="services" className="public-section">
      <SectionIntro
        eyebrow="Diagnosis"
        title="First Meridian names the operational drag. Then it turns the diagnosis into system design."
        text="Start with the clearest pain point, then convert the findings into workflow maps, operator playbooks, execution queues, and reporting your team can run every day."
      />
      <div className="public-service-grid">
        {services.map((service, index) => (
          <article className="public-card" key={service.title}>
            <span className="public-card-index">
              {String(index + 1).padStart(2, "0")}
            </span>
            <span className="public-card-outcome">{service.outcome}</span>
            <h3>{service.title}</h3>
            <p>{service.text}</p>
          </article>
        ))}
      </div>
      <SectionCta
        eyebrow="Start point"
        text="Most teams start by locating the leak, then build the workspace once the workflow is clear."
        primaryHref={START_AUDIT_HREF}
        primaryLabel="Start Audit"
        secondaryHref={REQUEST_DEMO_HREF}
        secondaryLabel="Request Demo"
      />
    </section>
  );
}
