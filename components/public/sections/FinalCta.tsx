import { REQUEST_DEMO_HREF, START_AUDIT_HREF } from "@/content/public/home";

export function FinalCta() {
  return (
    <section className="public-final-cta">
      <span className="public-eyebrow">Ready when the operation is</span>
      <h2>Start with an audit or request a custom workspace demo.</h2>
      <div className="public-hero-actions">
        <a className="public-primary-button" href={START_AUDIT_HREF}>
          Start with an Audit
        </a>
        <a className="public-secondary-button" href={REQUEST_DEMO_HREF}>
          Request Demo
        </a>
      </div>
    </section>
  );
}
