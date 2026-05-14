import { SectionIntro } from "@/components/public/ui/SectionIntro";
import { howMeridianWorks } from "@/content/public/home";

export function HowMeridianWorksSection() {
  return (
    <section id="how-meridian-works" className="public-section public-process-section">
      <SectionIntro
        eyebrow="How Meridian works"
        title="A practical path from visible growth leaks to operator-grade execution."
        text="The ladder stays simple: find the useful signal, map the workflow, build the workspace, run the rhythm, and prove what moved."
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
