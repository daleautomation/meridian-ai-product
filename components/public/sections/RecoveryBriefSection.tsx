import {
  RECOVERY_SAMPLE_BRIEF_HREF,
  REQUEST_FIRST_BRIEF_HREF,
} from "@/content/public/home";

const briefDetails = [
  {
    title: "Who to reopen",
    text: "The relationships most likely to justify a founder's attention this week.",
  },
  {
    title: "Why now",
    text: "A grounded reason to revisit the relationship, or a clear note when the signal is weak.",
  },
  {
    title: "What to say",
    text: "A restrained opener the founder can edit before sending manually.",
  },
  {
    title: "Verified contact path",
    text: "The practical route back to the person without pretending the data is richer than it is.",
  },
] as const;

export function RecoveryBriefSection() {
  return (
    <section id="recovery-brief" className="public-section public-recovery-brief-section">
      <div className="public-recovery-brief-copy">
        <span className="public-eyebrow">The front-door offer</span>
        <h2>A weekly brief for founder-led relationship recovery.</h2>
        <p>
          Meridian turns a boutique firm&apos;s dormant relationship list into a
          founder-reviewed Recovery Brief. It is not a sending tool. It is a
          clear memo for deciding which relationships deserve a careful human
          follow-up.
        </p>
        <div className="public-hero-actions">
          <a className="public-primary-button" href={RECOVERY_SAMPLE_BRIEF_HREF}>
            See a sample brief
          </a>
          <a className="public-secondary-button" href={REQUEST_FIRST_BRIEF_HREF}>
            Request the first brief on your list
          </a>
        </div>
      </div>

      <div className="public-recovery-brief-grid" aria-label="Recovery Brief contents">
        {briefDetails.map((detail) => (
          <article key={detail.title}>
            <span>{detail.title}</span>
            <p>{detail.text}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
