import { SectionIntro } from "@/components/public/ui/SectionIntro";
import { howMeridianWorks } from "@/content/public/home";

export function HowMeridianWorksSection() {
  return (
    <section id="how-meridian-works" className="public-section public-process-section">
      <SectionIntro
        eyebrow="Relationship recovery workflow"
        title="From messy contact lists to a daily priority queue."
        text="Meridian does not replace the CRM. It sits above relationship systems, compresses the intelligence, and guides the operator to the next action."
      />
      <ol className="public-process-list">
        {howMeridianWorks.map((step) => (
          <li key={step.stage}>
            <span>{step.stage}</span>
            <strong>{step.title}</strong>
            <p>{step.text}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
