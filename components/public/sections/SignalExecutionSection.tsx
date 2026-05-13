import { signalExecutionSteps } from "@/content/public/home";
import { SectionIntro } from "@/components/public/ui/SectionIntro";

export function SignalExecutionSection() {
  return (
    <section id="signal-to-execution" className="public-section public-signal-flow-section">
      <SectionIntro
        eyebrow="Signal to execution"
        title="Every valuable signal should know where it is going."
        text="Meridian creates the operating path between what the business learns and what the team does next."
      />
      <div className="public-signal-flow-shell" aria-label="Signal to execution flow">
        <div className="public-signal-flow-line" aria-hidden="true" />
        {signalExecutionSteps.map((step, index) => (
          <article key={step.stage} className="public-signal-flow-step">
            <div>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <strong>{step.stage}</strong>
            </div>
            <h3>{step.title}</h3>
            <p>{step.text}</p>
          </article>
        ))}
      </div>
      <div className="public-signal-flow-proof">
        <span className="public-live-dot" />
        Signal becomes workflow. Workflow becomes ownership. Ownership becomes movement.
      </div>
    </section>
  );
}
