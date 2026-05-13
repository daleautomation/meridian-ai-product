import { SectionCta } from "@/components/public/ui/SectionCta";
import { SectionIntro } from "@/components/public/ui/SectionIntro";
import {
  businessReasons,
  REQUEST_DEMO_HREF,
  START_AUDIT_HREF,
} from "@/content/public/home";

export function ReasonsSection() {
  return (
    <section className="public-section">
      <SectionIntro
        eyebrow="Why businesses use Meridian"
        title="Because operational drag is expensive when nobody can feel where it starts."
        text="Meridian gives teams the structure to prioritize the right work, assign it clearly, and keep momentum visible from first signal through outcome."
      />
      <div className="public-reason-grid">
        {businessReasons.map((reason) => (
          <article className="public-reason-card" key={reason.title}>
            <span />
            <h3>{reason.title}</h3>
            <p>{reason.text}</p>
          </article>
        ))}
      </div>
      <SectionCta
        eyebrow="Operating clarity"
        text="If the team is busy but the system feels unclear, Meridian starts by finding the hidden leaks and turning them into owned movement."
        primaryHref={START_AUDIT_HREF}
        primaryLabel="Start Audit"
        secondaryHref={REQUEST_DEMO_HREF}
        secondaryLabel="Request Demo"
      />
    </section>
  );
}
