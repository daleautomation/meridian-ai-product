import { fieldFounderPoints } from "@/content/public/home";

export function BuiltFromFieldSection() {
  return (
    <section id="built-from-field" className="public-section public-split-section public-field-section">
      <div>
        <span className="public-eyebrow">Built from the field</span>
        <h2>The product started with construction pressure, not a slide deck.</h2>
        <p>
          Meridian comes from watching real operators carry the business in
          their head: jobs moving, estimates waiting, customers asking, crews
          shifting, and follow-up depending on whoever remembered it first.
        </p>
      </div>
      <div className="public-field-card-grid">
        {fieldFounderPoints.map((point) => (
          <article className="public-field-card" key={point.title}>
            <h3>{point.title}</h3>
            <p>{point.text}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
