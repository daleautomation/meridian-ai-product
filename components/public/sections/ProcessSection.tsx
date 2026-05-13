import { operatingSteps } from "@/content/public/home";
import { SectionIntro } from "@/components/public/ui/SectionIntro";

export function ProcessSection() {
  return (
    <section className="public-section public-process-section">
      <SectionIntro
        eyebrow="How Meridian works"
        title="From diagnosis to control, the operating rhythm compounds."
        text="The work begins with evidence, turns into a practical system, and keeps improving as your team executes with visible ownership and attribution."
      />
      <ol className="public-process-list">
        {operatingSteps.map((step, index) => (
          <li key={step}>
            <span>{String(index + 1).padStart(2, "0")}</span>
            <strong>{step}</strong>
          </li>
        ))}
      </ol>
    </section>
  );
}
