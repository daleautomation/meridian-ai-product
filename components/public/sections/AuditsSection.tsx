import { SectionIntro } from "@/components/public/ui/SectionIntro";
import { SectionCta } from "@/components/public/ui/SectionCta";
import {
  auditTiers,
  REQUEST_DEMO_HREF,
  START_AUDIT_HREF,
} from "@/content/public/home";

export function AuditsSection() {
  return (
    <section id="audits" className="public-section public-audit-section">
      <SectionIntro
        eyebrow="Audits"
        title="Start with a focused audit."
        text="Walk away with a clear diagnosis, priority fixes, workflow maps, and a roadmap for turning your business into an operator-grade system."
      />
      <div className="public-audit-grid">
        {auditTiers.map((tier, index) => (
          <article
            className={`public-pricing-card${
              index === 1 ? " public-pricing-card-featured" : ""
            }`}
            key={tier.name}
          >
            <div>
              <span>{tier.name}</span>
              <strong>{tier.price}</strong>
            </div>
            <p>{tier.bestFor}</p>
            <span className="public-audit-signal">{tier.signal}</span>
            <ul>
              {tier.points.map((point) => (
                <li key={point}>{point}</li>
              ))}
            </ul>
          </article>
        ))}
      </div>
      <SectionCta
        eyebrow="Audit request"
        text="Get the operational truth first: where work leaks, who owns it, and what the workspace should become."
        primaryHref={START_AUDIT_HREF}
        primaryLabel="Start Audit"
        secondaryHref={REQUEST_DEMO_HREF}
        secondaryLabel="Request Demo"
      />
    </section>
  );
}
