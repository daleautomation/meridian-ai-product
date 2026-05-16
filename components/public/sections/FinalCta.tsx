import {
  RECOVERY_SAMPLE_BRIEF_HREF,
  REQUEST_FIRST_BRIEF_HREF,
} from "@/content/public/home";

export function FinalCta() {
  return (
    <section className="public-final-cta">
      <span className="public-eyebrow">Weekly, manual, founder-reviewed</span>
      <h2>Send a small list. Get back a Recovery Brief worth acting on.</h2>
      <p>
        Start with dormant relationships from a CSV you control. Meridian
        returns a clear weekly brief so the founder can decide who to reopen
        and send the outreach manually.
      </p>
      <div className="public-hero-actions">
        <a className="public-primary-button" href={RECOVERY_SAMPLE_BRIEF_HREF}>
          See a sample brief
        </a>
        <a className="public-secondary-button" href={REQUEST_FIRST_BRIEF_HREF}>
          Request the first brief on your list
        </a>
      </div>
    </section>
  );
}
