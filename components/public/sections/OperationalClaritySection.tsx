import { openingNarrative, operatorPrinciples } from "@/content/public/home";

export function OperationalClaritySection() {
  return (
    <section className="public-section public-clarity-section" aria-labelledby="operational-clarity-heading">
      <div className="public-clarity-statement">
        <span className="public-eyebrow">{openingNarrative.eyebrow}</span>
        <h2 id="operational-clarity-heading">{openingNarrative.title}</h2>
        <p>{openingNarrative.text}</p>
        <blockquote>{openingNarrative.quote}</blockquote>
      </div>
      <div className="public-narrative-arc" aria-label="Meridian narrative progression">
        {openingNarrative.arc.map((step, index) => (
          <div key={step}>
            <span>{String(index + 1).padStart(2, "0")}</span>
            <strong>{step}</strong>
          </div>
        ))}
      </div>
      <div className="public-philosophy-grid" aria-label="Operator philosophy">
        {operatorPrinciples.map((principle) => (
          <article key={principle.title}>
            <strong>{principle.title}</strong>
            <p>{principle.text}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
