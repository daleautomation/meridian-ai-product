import { auditTiers } from "@/content/public/home";
import { SectionIntro } from "@/components/public/ui/SectionIntro";

export function AuditsSection() {
  return (
    <section id="audits" className="public-section public-audit-section">
      <SectionIntro
        eyebrow="Audits"
        title="Start with a focused audit."
        text="Walk away with a clear diagnosis, priority fixes, and a roadmap for turning your business into an operator-grade system."
      />
      <div className="public-audit-grid">
        {auditTiers.map((tier) => (
          <article className="public-pricing-card" key={tier.name}>
            <div>
              <span>{tier.name}</span>
              <strong>{tier.price}</strong>
            </div>
            <p>{tier.bestFor}</p>
            <ul>
              {tier.points.map((point) => (
                <li key={point}>{point}</li>
              ))}
            </ul>
          </article>
        ))}
      </div>
    </section>
  );
}
